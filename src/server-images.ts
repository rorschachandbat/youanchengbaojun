import { useSyncExternalStore } from 'react';
import manifest from './server-image-manifest.json';

export type ServerImageMode = 'local' | 'server';
interface ImageFile { file: string; bytes: number }
const images: Record<string, ImageFile> = manifest.images;
const files = [...new Map(Object.values(images).map(image => [image.file, image])).values()];
const preferenceKey = 'totu.server-image-mode.v1';
const listeners = new Set<() => void>();
let preference: ServerImageMode | undefined;

export function getServerImageMode(fallback: ServerImageMode = 'server'): ServerImageMode {
  if (preference) return preference;
  try {
    const saved = localStorage.getItem(preferenceKey);
    return saved === 'local' || saved === 'server' ? saved : fallback;
  } catch { return fallback; }
}
export function setServerImageMode(mode: ServerImageMode) {
  preference = mode;
  try { localStorage.setItem(preferenceKey, mode); } catch { /* 存储禁用时，本页仍可切换。 */ }
  for (const notify of listeners) notify();
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}
export function useServerImageMode() {
  return useSyncExternalStore(subscribe, getServerImageMode, () => 'server' as const);
}
export function serverImageUrl(source: string): string {
  const image = images[source];
  return `${import.meta.env.BASE_URL ?? '/'}${image?.file ?? source.replace(/^assets\//, '')}`;
}
export const serverImagePack = { count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('totu.server-images.v1', 1);
    // 隐私模式或被阻塞的数据库不能让进房流程无限等待。
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('image_storage_timeout')); }, 3000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images');
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { clearTimeout(timer); reject(request.error ?? new Error('image_storage_unavailable')); };
  });
  database = pending;
  pending.catch(() => { if (database === pending) database = undefined; });
  return pending;
}
async function storeRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('images', mode);
    const request = action(transaction.objectStore('images'));
    const timer = setTimeout(() => { transaction.abort(); }, 5000);
    transaction.oncomplete = () => { clearTimeout(timer); resolve(request.result); };
    transaction.onerror = transaction.onabort = () => {
      clearTimeout(timer); reject(request.error ?? transaction.error ?? new Error('image_storage_failed'));
    };
  });
}
async function readFile(image: ImageFile) {
  const blob = await storeRequest<Blob | undefined>('readonly', store => store.get(image.file));
  // 内容哈希文件名隔离各个版本，大小和 MIME 校验拒绝旧错误页或截断缓存。
  return blob instanceof Blob && blob.size === image.bytes && blob.type === 'image/webp' ? blob : undefined;
}
export async function evictServerImage(source: string) {
  const image = images[source];
  if (image) await storeRequest('readwrite', store => store.delete(image.file));
}
export async function serverImageCacheStatus(): Promise<number> {
  const keys = new Set(await storeRequest<IDBValidKey[]>('readonly', store => store.getAllKeys()));
  return files.filter(file => keys.has(file.file)).length;
}

const downloads = new Map<string, Promise<Blob>>();
function download(image: ImageFile, signal?: AbortSignal): Promise<Blob> {
  // 预下载允许取消；不与对局中的按需请求共享可取消任务。
  const key = signal ? undefined : image.file;
  if (key && downloads.has(key)) return downloads.get(key)!;
  const pending = (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL ?? '/'}${image.file}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    });
    if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== 'image/webp') throw new Error('image_download_failed');
    const blob = await response.blob();
    if (blob.size !== image.bytes) throw new Error('image_download_incomplete');
    return blob;
  })();
  if (key) {
    downloads.set(key, pending);
    void pending.finally(() => { if (downloads.get(key) === pending) downloads.delete(key); }).catch(() => {});
  }
  return pending;
}
export async function loadServerImage(source: string): Promise<Blob> {
  const image = images[source];
  if (!image) throw new Error('image_not_in_manifest');
  try {
    const cached = await readFile(image);
    if (cached) return cached;
  } catch { /* 禁用本地存储时仍可显示服务器图片。 */ }
  const blob = await download(image);
  try { await storeRequest('readwrite', store => store.put(blob, image.file)); }
  catch { /* 不能持久化时，当前页面仍可显示已经下载的图片。 */ }
  return blob;
}

export interface ServerImageProgress {
  total: number; done: number; failed: number; bytes: number; totalBytes: number;
  storageFailed: boolean; cancelled: boolean;
}
export async function preloadServerImages(onProgress: (progress: ServerImageProgress) => void, signal?: AbortSignal) {
  const progress: ServerImageProgress = {
    total: files.length, done: 0, failed: 0, bytes: 0, totalBytes: serverImagePack.bytes, storageFailed: false, cancelled: false,
  };
  onProgress({ ...progress });
  // 先验证存储；无法保存时立即提示，不浪费整包下载流量。
  try {
    await storeRequest('readwrite', store => store.put('probe', '__probe__'));
    await storeRequest('readwrite', store => store.delete('__probe__'));
  } catch {
    progress.storageFailed = true;
    onProgress({ ...progress });
    return progress;
  }
  let next = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < files.length && !signal?.aborted && !progress.storageFailed) {
      const image = files[next++]!;
      try {
        let blob = await readFile(image);
        if (!blob) {
          let lastError: unknown;
          // 短暂断网只重试失败文件，已写入的文件在下一次继续下载时直接复用。
          for (let attempt = 0; attempt < 2 && !signal?.aborted; attempt++) {
            try { blob = await download(image, signal); break; } catch (error) { lastError = error; }
          }
          if (!blob) throw lastError ?? new Error('image_download_cancelled');
          if (signal?.aborted) break;
          try { await storeRequest('readwrite', store => store.put(blob, image.file)); }
          catch { progress.storageFailed = true; throw new Error('image_storage_failed'); }
        }
        progress.done++;
        progress.bytes += image.bytes;
      } catch { if (!signal?.aborted) progress.failed++; }
      onProgress({ ...progress });
    }
  }));
  progress.cancelled = signal?.aborted ?? false;
  onProgress({ ...progress });
  return progress;
}
