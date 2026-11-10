import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ui } from '../i18n';
import { useLocale } from '../use-locale';
import {
  getServerImageMode, preloadServerImages, serverImageCacheStatus, serverImagePack,
  setServerImageMode, type ServerImageMode, type ServerImageProgress,
} from '../server-images';

export function ServerImageSetup({ onContinue, onCancel, entering = false }: {
  onContinue: () => void; onCancel: () => void; entering?: boolean;
}) {
  useLocale();
  const [mode, setMode] = useState<ServerImageMode>(() => getServerImageMode(entering ? 'local' : 'server'));
  const [cached, setCached] = useState<number | null>(null);
  const [progress, setProgress] = useState<ServerImageProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false;
    void serverImageCacheStatus().then(count => { if (!stopped) setCached(count); }).catch(() => {});
    return () => { stopped = true; controller.current?.abort(); };
  }, []);
  const ready = cached === serverImagePack.count;
  const choose = () => { setServerImageMode(mode); onContinue(); };
  async function download() {
    if (busy) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    try {
      const result = await preloadServerImages(setProgress, current.signal);
      setProgress(result);
      setCached(result.done);
    } finally { if (!current.signal.aborted) controller.current = null; setBusy(false); }
  }
  const percentage = progress ? Math.round(progress.bytes / progress.totalBytes * 100) : 0;
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#080610e6', zIndex: 4000, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="server-image-title"
        onKeyDown={event => {
          if (event.key === 'Escape' && !busy) onCancel();
          if (event.key === 'Tab') {
            const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
            if (!controls?.length) return;
            const first = controls[0]!, last = controls[controls.length - 1]!;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}
        style={{ width: 'min(580px, 100%)', maxHeight: '90vh', overflow: 'auto', background: '#1b1229', border: '1px solid #8b70a5', borderRadius: 12, padding: 24, boxSizing: 'border-box' }}>
        <h2 id="server-image-title" style={{ marginTop: 0 }}>{ui('Prepare images before playing')}</h2>
        <p style={note}>{ui('Server image setup explanation', { size: (serverImagePack.bytes / 1_000_000).toFixed(1) })}</p>
        <label style={option}>
          <input autoFocus type="radio" name="image-mode" value="local" checked={mode === 'local'} disabled={busy} onChange={() => setMode('local')} />
          <span><strong>{ui('Local images (recommended)')}</strong><span style={{ ...note, display: 'block' }}>{ui('Local images explanation')}</span></span>
        </label>
        <label style={option}>
          <input type="radio" name="image-mode" value="server" checked={mode === 'server'} disabled={busy} onChange={() => setMode('server')} />
          <span><strong>{ui('Server images')}</strong><span style={{ ...note, display: 'block' }}>{ui('Server images explanation')}</span></span>
        </label>
        <p style={note}>{ui('Local image storage note')}</p>
        {mode === 'local' && (
          <>
            {cached !== null && <p>{ui('Cached images: {done}/{total}', { done: cached, total: serverImagePack.count })}</p>}
            {progress && <div role="status" aria-live="polite">
              <progress max={progress.totalBytes} value={progress.bytes} aria-label={ui('Image download progress')} style={{ width: '100%', accentColor: '#b88bea' }} />
              <p style={note}>{ui('Image download status', { done: progress.done, total: progress.total, percent: percentage })}</p>
              {progress.failed > 0 && <p style={{ color: '#ffd09c' }}>{ui('Some images failed; retry resumes completed files', { count: progress.failed })}</p>}
              {progress.storageFailed && <p role="alert" style={{ color: '#ffd09c' }}>{ui('Local image storage unavailable')}</p>}
              {progress.cancelled && <p>{ui('Image download stopped')}</p>}
            </div>}
          </>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
          {busy ? (
            <button style={button} onClick={() => controller.current?.abort()}>{ui('Stop image download')}</button>
          ) : (
            <>
              {mode === 'server' || ready
                ? <button style={button} onClick={choose}>{ui(entering ? 'Continue into room' : 'Apply image settings')}</button>
                : <>
                  <button style={button} onClick={() => void download()}>{ui('Download images to this device')}</button>
                  <button style={secondary} onClick={choose}>{ui('Use available cache and continue')}</button>
                </>}
              <button style={secondary} onClick={onCancel}>{ui('Cancel')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
const note: CSSProperties = { color: '#ccc0da', fontSize: 13, lineHeight: 1.65 };
const option: CSSProperties = { display: 'flex', alignItems: 'start', gap: 10, border: '1px solid #684c80', borderRadius: 8, padding: 14, margin: '12px 0', cursor: 'pointer' };
const button: CSSProperties = { background: '#69428f', border: '1px solid #b68bdc', color: '#fff', borderRadius: 6, padding: '10px 14px', cursor: 'pointer' };
const secondary: CSSProperties = { ...button, background: '#251a35', borderColor: '#735888' };
