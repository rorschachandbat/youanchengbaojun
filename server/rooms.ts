import { randomInt, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { getHeapStatistics } from 'node:v8';
import { GameServer } from 'digital-boardgame-framework/server';
import { initialBgioState, tyrantsAdapter, type BgioState, type TyrantsAction, type PlayerId } from '../src/adapter/tyrantsAdapter';
import { isHalfDeck, type HalfDeck } from '../src/half-decks';
import { snapshotCodec } from '../src/online/snapshotCodec';
import { MemoryStore } from './memory-store';

export interface RoomConfig {
  maxRooms: number;
  reserveMb: number;
  idleMs: number;
  disconnectMs: number;
}
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
interface Member {
  token: string;
  slot: number;
  name: string;
  seen: number;
  gameToken?: string;
}
interface Room {
  code: string;
  capacity: number;
  decks: HalfDeck[];
  members: Member[];
  nextSlot: number;
  emptySince?: number;
  gameId?: string;
  notice?: string;
}
const newToken = () => randomBytes(24).toString('hex');
const fail = (status: number, code: string): never => { throw new ApiError(status, code); };
const ACTIONS = new Set([
  'deployStartingTroop', 'playCard', 'recruitFromMarket', 'recruitFromAuxStack',
  'deployTroop', 'assassinateTroop', 'returnEnemySpy', 'resolveChoice', 'endTurn',
]);

export function availableMb(): number {
  try {
    const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m);
    if (match) return Number(match[1]) / 1024;
  } catch { /* 非 Linux 测试环境使用系统空闲内存。 */ }
  return freemem() / 1024 / 1024;
}

export class RoomService {
  readonly store = new MemoryStore();
  readonly rooms = new Map<string, Room>();
  readonly server: GameServer<BgioState, TyrantsAction, PlayerId>;
  constructor(
    readonly config: RoomConfig,
    private now = Date.now,
    private memory = availableMb,
  ) {
    this.server = new GameServer({
      // 真人房间不注册 AI，也不启用弃席自动接管、外部账号或排行榜。
      adapter: { ...tyrantsAdapter, serverDrivenSeats: undefined },
      codec: snapshotCodec(),
      store: this.store,
      snapshotHistory: 1,
      gameUrl: (id, token) => `/play/${id}?as=${token}`,
    });
  }
  health() {
    return {
      ok: true, rooms: this.rooms.size, max_rooms: this.config.maxRooms,
      available_mb: Math.floor(this.memory()), reserve_mb: this.config.reserveMb,
      transport: 'http', persistence: false, ai: false,
      players_per_room: 4, min_players: 2,
      room_idle_seconds: this.config.idleMs / 1000,
      disconnect_seconds: this.config.disconnectMs / 1000,
    };
  }
  async reap() {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      const remaining = room.members.filter(member => now - member.seen < this.config.disconnectMs);
      if (remaining.length !== room.members.length) {
        await this.endGame(room);
        room.members = remaining;
      }
      if (room.members.length) room.emptySince = undefined;
      else {
        room.emptySince ??= now;
        if (now - room.emptySince >= this.config.idleMs) {
          await this.endGame(room);
          this.rooms.delete(code);
          console.info('[ROOM] reclaimed', code);
        }
      }
    }
  }
  private name(value: unknown): string {
    if (typeof value !== 'string') return fail(422, 'invalid_name');
    const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
    if (!name || name.length > 24) return fail(422, 'invalid_name');
    return name;
  }
  create(body: Record<string, unknown>) {
    const name = this.name(body.name);
    const capacity = body.capacity ?? 4;
    if (!Number.isInteger(capacity) || Number(capacity) < 2 || Number(capacity) > 4) fail(422, 'invalid_capacity');
    const decks = body.decks ?? ['drow', 'dragons'];
    if (!Array.isArray(decks) || decks.length !== 2 || !decks.every(isHalfDeck) || decks[0] === decks[1]) fail(422, 'invalid_decks');
    if (this.rooms.size >= this.config.maxRooms) fail(503, 'server_full');
    if (this.memory() < this.config.reserveMb
      || process.memoryUsage().heapUsed > getHeapStatistics().heap_size_limit * 0.7) fail(503, 'server_busy');
    let code: string;
    do { code = String(randomInt(100000, 1000000)); } while (this.rooms.has(code));
    const room: Room = { code, capacity: Number(capacity), decks: decks as HalfDeck[], members: [], nextSlot: 1 };
    this.rooms.set(code, room);
    const member: Member = { token: newToken(), slot: 0, name, seen: this.now() };
    room.members.push(member);
    console.info('[ROOM] created', code);
    return { ...this.view(room, member), token: member.token };
  }
  join(body: Record<string, unknown>) {
    const room = this.room(String(body.code ?? ''));
    const resumed = typeof body.token === 'string' && room.members.find(member => member.token === body.token);
    if (resumed) {
      resumed.seen = this.now();
      return { ...this.view(room, resumed), token: resumed.token };
    }
    if (room.gameId) fail(409, 'game_started');
    if (room.members.length >= room.capacity) fail(409, 'room_full');
    const name = this.name(body.name);
    const member: Member = { token: newToken(), slot: room.nextSlot++, name, seen: this.now() };
    room.members.push(member);
    room.emptySince = undefined;
    return { ...this.view(room, member), token: member.token };
  }
  private room(code: string): Room {
    if (!/^\d{6}$/.test(code)) return fail(422, 'invalid_code');
    return this.rooms.get(code) ?? fail(404, 'room_not_found');
  }
  private auth(code: string, token: string) {
    const room = this.room(code);
    const member = room.members.find(item => item.token === token) ?? fail(401, 'invalid_session');
    member.seen = this.now();
    return { room, member };
  }
  private view(room: Room, member: Member) {
    const owner = [...room.members].sort((a, b) => a.slot - b.slot)[0];
    return {
      ok: true, code: room.code, capacity: room.capacity, decks: room.decks,
      phase: room.gameId ? 'playing' : 'lobby',
      owner: owner?.slot, you: member.slot, notice: room.notice,
      members: room.members.map(item => ({ slot: item.slot, name: item.name })),
      // 只返回当前玩家自己的席位凭证，绝不下发其他玩家的 token。
      ...(room.gameId ? { gameId: room.gameId, gameToken: member.gameToken } : {}),
    };
  }
  status(code: string, token: string) {
    const { room, member } = this.auth(code, token);
    return this.view(room, member);
  }
  async start(code: string, token: string) {
    const { room, member } = this.auth(code, token);
    const ordered = [...room.members].sort((a, b) => a.slot - b.slot);
    if (ordered[0] !== member) fail(403, 'owner_only');
    if (room.gameId) fail(409, 'game_started');
    if (ordered.length < 2) fail(409, 'need_players');
    if (this.memory() < this.config.reserveMb) fail(503, 'server_busy');
    const players = ordered.map((_, index) => String(index));
    const sections: Array<'left' | 'center' | 'right'> = ordered.length === 2
      ? ['center'] : ordered.length === 3 ? ['center', 'left'] : ['left', 'center', 'right'];
    const game = await this.server.createGame({
      initialState: initialBgioState(players.length, { halfDecks: room.decks, activeSections: sections }),
      players,
    });
    room.gameId = game.gameId;
    room.notice = undefined;
    ordered.forEach((item, index) => {
      item.gameToken = new URL(game.invites[String(index)]!, 'http://localhost').searchParams.get('as')!;
    });
    console.info('[ROOM] started', code, ordered.length);
    return this.view(room, member);
  }
  private async endGame(room: Room) {
    if (!room.gameId) return;
    await this.store.deleteGame(room.gameId);
    room.gameId = undefined;
    room.notice = 'player_left';
    room.members.forEach(member => { member.gameToken = undefined; });
  }
  async leave(code: string, token: string) {
    const { room, member } = this.auth(code, token);
    await this.endGame(room);
    room.members = room.members.filter(item => item !== member);
    if (!room.members.length) room.emptySince = this.now();
    return { ok: true };
  }
  async game(method: string, id: string, route: string | undefined, token: string, body: Record<string, unknown>) {
    const room = [...this.rooms.values()].find(item => item.gameId === id) ?? fail(404, 'room_not_found');
    const member = room.members.find(item => item.gameToken === token) ?? fail(401, 'invalid_session');
    member.seen = this.now();
    if (!route && method === 'GET') return this.server.fetch(id, token);
    if (route === 'legal' && method === 'GET') return this.server.legalActions(id, token);
    if (route === 'submit' && method === 'POST') {
      const action = body.action as TyrantsAction | undefined;
      if (!action || typeof action !== 'object' || !ACTIONS.has(action.kind)) fail(422, 'invalid_action');
      return this.server.submit(id, token, action as TyrantsAction);
    }
    if (route === 'chat' && method === 'GET') return this.server.listMessages(id, token);
    if (route === 'chat' && method === 'POST') {
      if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 500) fail(422, 'invalid_message');
      return this.server.postMessage(id, token, body.body as string);
    }
    return fail(404, 'not_found');
  }
}
