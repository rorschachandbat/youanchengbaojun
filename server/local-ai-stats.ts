import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const RECENT_LIMIT = 2048;
const DAY_LIMIT = 31;
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
interface StoredStats {
  version: 1;
  total: number;
  firstStart: string | null;
  lastStart: string | null;
  days: Record<string, number>;
  recentIds: string[];
}
const emptyStats = (): StoredStats => ({
  version: 1, total: 0, firstStart: null, lastStart: null, days: {}, recentIds: [],
});
function validState(value: unknown): value is StoredStats {
  if (!value || typeof value !== 'object') return false;
  const data = value as StoredStats;
  return data.version === 1 && Number.isSafeInteger(data.total) && data.total >= 0
    && [data.firstStart, data.lastStart].every(date => date === null
      || (typeof date === 'string' && Number.isFinite(Date.parse(date))))
    && !!data.days && typeof data.days === 'object' && !Array.isArray(data.days)
    && Object.keys(data.days).length <= DAY_LIMIT
    && Object.entries(data.days).every(([day, count]) => /^\d{4}-\d{2}-\d{2}$/.test(day)
      && Number.isSafeInteger(count) && count >= 0)
    && Array.isArray(data.recentIds) && data.recentIds.length <= RECENT_LIMIT
    && data.recentIds.every(isStartId);
}
export function isStartId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

// 只保存固定大小的聚合及最近去重标识，不保存棋局、昵称、IP 或玩家身份。
export class LocalAiStats {
  private state: StoredStats | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(private file: string, private now = Date.now) {}

  private async load() {
    if (this.state) return this.state;
    try {
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!validState(data)) throw new Error('local_ai_stats_invalid_file');
      this.state = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = emptyStats();
    }
    return this.state;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    if (this.pending >= 32) return Promise.reject(new Error('local_ai_stats_busy'));
    this.pending++;
    const result = this.tail.then(action);
    this.tail = result.catch(() => {}).finally(() => { this.pending--; });
    return result;
  }
  record(id: string) {
    return this.serial(async () => {
      if (!isStartId(id)) throw new Error('local_ai_stats_invalid_id');
      const current = await this.load();
      if (current.recentIds.includes(id)) return { ok: true, duplicate: true };
      if (current.total >= Number.MAX_SAFE_INTEGER) throw new Error('local_ai_stats_overflow');
      const timestamp = new Date(this.now()).toISOString();
      const day = dayFormatter.format(new Date(timestamp));
      const days = { ...current.days, [day]: (current.days[day] ?? 0) + 1 };
      for (const old of Object.keys(days).sort().slice(0, -DAY_LIMIT)) delete days[old];
      const next: StoredStats = {
        version: 1, total: current.total + 1,
        firstStart: current.firstStart ?? timestamp, lastStart: timestamp,
        days, recentIds: [...current.recentIds, id].slice(-RECENT_LIMIT),
      };
      // 落盘成功才更新内存并确认收件，失败不会把零值覆盖到旧统计。
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      try {
        const handle = await open(temporary, 'w', 0o600);
        try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, this.file);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      this.state = next;
      console.info('[LOCAL_AI] started', timestamp);
      return { ok: true, duplicate: false };
    });
  }
  summary() {
    return this.serial(async () => {
      const state = await this.load();
      const now = this.now();
      const today = dayFormatter.format(new Date(now));
      const week = new Set(Array.from({ length: 7 }, (_, index) =>
        dayFormatter.format(new Date(now - index * 86400000))));
      return {
        available: true, total: state.total, today: state.days[today] ?? 0,
        last_7_days: Object.entries(state.days).reduce((sum, [day, count]) => sum + (week.has(day) ? count : 0), 0),
        first_start: state.firstStart, last_start: state.lastStart, timezone: 'Asia/Shanghai',
      };
    });
  }
}
