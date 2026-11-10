import {
  ConflictError,
  type SnapshotStore,
  type GameMeta,
  type SnapshotRow,
  type ChatMessage,
  type BugReportRow,
} from 'digital-boardgame-framework/server';

// 只保留当前局的最新状态；进程退出后不恢复，也不写入磁盘。
export class MemoryStore implements SnapshotStore {
  private games = new Map<string, GameMeta>();
  private snapshots = new Map<string, SnapshotRow>();
  private messages = new Map<string, ChatMessage[]>();

  async putGameMeta(meta: GameMeta): Promise<void> {
    this.games.set(meta.gameId, structuredClone(meta));
  }
  async getGameMeta(id: string): Promise<GameMeta | null> {
    return structuredClone(this.games.get(id) ?? null);
  }
  async listActiveGames(): Promise<GameMeta[]> {
    return structuredClone([...this.games.values()].filter(meta => !meta.resolved));
  }
  async putSnapshot(id: string, row: SnapshotRow): Promise<void> {
    const previous = this.snapshots.get(id);
    if (previous && row.turn <= previous.turn) throw new ConflictError('Snapshot already exists');
    this.snapshots.set(id, { ...row });
  }
  async getLatest(id: string): Promise<SnapshotRow | null> {
    const row = this.snapshots.get(id);
    return row ? { ...row } : null;
  }
  async getHistory(id: string): Promise<SnapshotRow[]> {
    const row = await this.getLatest(id);
    return row ? [row] : [];
  }
  async postMessage(id: string, message: ChatMessage): Promise<void> {
    const messages = this.messages.get(id) ?? [];
    messages.push({ ...message });
    this.messages.set(id, messages.slice(-100));
  }
  async listMessages(id: string, limit = 100): Promise<ChatMessage[]> {
    return structuredClone((this.messages.get(id) ?? []).slice(-limit));
  }
  async deleteGame(id: string): Promise<void> {
    this.games.delete(id);
    this.snapshots.delete(id);
    this.messages.delete(id);
  }
  async putReport(_report: BugReportRow): Promise<void> {
    throw new Error('Reports disabled');
  }
  async listReports(): Promise<BugReportRow[]> { return []; }
  async resolveReport(): Promise<void> { throw new Error('Reports disabled'); }
}
