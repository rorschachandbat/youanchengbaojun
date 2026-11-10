const KEY = 'totu.local-ai-starts.v1';
const LIMIT = 20;
let flushing = false;
let pending: string[] | undefined;

function queue(): string[] {
  if (pending) return pending;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    pending = Array.isArray(saved) ? saved.filter((id): id is string =>
      typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)).slice(-LIMIT) : [];
  } catch { pending = []; }
  return pending;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(queue())); }
  catch { /* 禁用或写满存储时，仅保留本页的少量待发记录。 */ }
}
export async function flushLocalAiStarts(): Promise<void> {
  if (import.meta.env.VITE_FRIENDS_ONLY !== 'true' || flushing) return;
  flushing = true;
  try {
    // 每次访问或新开局最多补报少量记录，失败后等待下次进入，不持续轮询。
    for (let sent = 0; sent < LIMIT && queue().length; sent++) {
      const eventId = queue()[0]!;
      const response = await fetch('/api/local-ai/starts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }), keepalive: true, signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) break;
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || (result as { ok?: unknown }).ok !== true) break;
      pending = queue().filter(id => id !== eventId);
      save();
    }
  } catch { /* 统计失败不阻止本地对局，稍后进入页面时补报。 */ }
  finally { flushing = false; }
}
export function recordLocalAiStart() {
  if (import.meta.env.VITE_FRIENDS_ONLY !== 'true') return;
  try {
    // 不依赖 HTTP 页面中不可用的 crypto.randomUUID，也不使用跨对局玩家标识。
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    pending = [...queue(), id].slice(-LIMIT);
    save();
    void flushLocalAiStarts();
  } catch { /* 浏览器能力不足时放弃统计，不能中断开局。 */ }
}
