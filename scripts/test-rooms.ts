import assert from 'node:assert/strict';
import { RoomService, ApiError } from '../server/rooms';
import { MemoryStore } from '../server/memory-store';

// 使用可控时钟测试生命周期，不等待真实的五分钟空房时限。
let now = 0;
let memory = 1500;
const config = { maxRooms: 2, reserveMb: 300, idleMs: 300000, disconnectMs: 120000 };
const service = new RoomService(config, () => now, () => memory);
function rejectsCode(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof ApiError && err.code === code);
}
async function rejectsAsync(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (err: unknown) => err instanceof ApiError && err.code === code);
}
rejectsCode(() => service.create({ name: '禁止在线 AI', ai: { 1: 'hard' } }), 'ai_not_allowed');
assert.equal(service.rooms.size, 0, '拒绝在线 AI 时不能占用房间内存');
const owner = service.create({ name: '测试房主', capacity: 3 });
rejectsCode(() => service.join({ code: owner.code, name: '禁止 AI 加入', ai: 'random' }), 'ai_not_allowed');
assert.equal(service.status(owner.code, owner.token).members.length, 1);
assert.match(owner.code, /^\d{6}$/);
assert.equal(owner.phase, 'lobby');
assert.equal(owner.owner, owner.you);
await rejectsAsync(() => service.start(owner.code, owner.token), 'need_players');
const guest = service.join({ code: owner.code, name: '测试玩家' });
assert.equal(guest.members.length, 2);
assert.equal('token' in guest.members[0]!, false);
rejectsCode(() => service.status(owner.code, guest.token + 'invalid'), 'invalid_session');
await rejectsAsync(() => service.start(owner.code, guest.token), 'owner_only');
const started = await service.start(owner.code, owner.token);
assert.ok(started.gameId);
const other = service.status(owner.code, guest.token);
assert.notEqual(started.gameToken, other.gameToken);
const a = await service.server.fetch(started.gameId!, started.gameToken!);
const b = await service.server.fetch(started.gameId!, other.gameToken!);
assert.equal(a.you, '0');
assert.equal(service.health().ai, false, '本地 AI 开放不能启用在线 AI');
assert.deepEqual(Object.keys(a.view.G.players), ['0', '1'], '真人房间只包含已加入的两个人类席位');
assert.equal(b.you, '1');
assert.equal(a.view.G.players['0']!.hand.some(card => card.deck === '__hidden__'), false);
assert.ok(b.view.G.players['0']!.hand.every(card => card.deck === '__hidden__'));
rejectsCode(() => service.join({ code: owner.code, name: '开局迟到' }), 'game_started');
await rejectsAsync(() => service.game('POST', started.gameId!, 'submit', started.gameToken!, {
  action: { kind: 'forfeitSeat', seat: '1' },
}), 'invalid_action');
await rejectsAsync(() => service.game('POST', started.gameId!, 'submit', started.gameToken!, {
  action: { kind: 'concede' },
}), 'invalid_action');
const actorToken = a.yourTurn ? started.gameToken! : other.gameToken!;
const moves = await service.server.legalActions(started.gameId!, actorToken);
assert.ok(moves.length);
await service.game('POST', started.gameId!, 'submit', actorToken, { action: moves[0] });
await service.leave(owner.code, owner.token);
assert.equal(await service.store.getGameMeta(started.gameId!), null);
const newOwner = service.status(owner.code, guest.token);
assert.equal(newOwner.owner, guest.you);
assert.equal(newOwner.phase, 'lobby');
assert.equal(newOwner.notice, 'player_left');
const late = service.join({ code: owner.code, name: '新玩家' });
assert.equal(late.owner, guest.you);
assert.ok(late.you > guest.you);
await service.leave(owner.code, late.token);
await service.leave(owner.code, guest.token);
now += config.idleMs;
await service.reap();
assert.equal(service.rooms.size, 0);
memory = 299;
rejectsCode(() => service.create({ name: '内存保护' }), 'server_busy');
memory = 1500;
const timeoutRoom = service.create({ name: '掉线测试' });
const reconnect = service.join({ code: timeoutRoom.code, token: timeoutRoom.token });
assert.equal(reconnect.token, timeoutRoom.token);
service.create({ name: '上限测试' });
rejectsCode(() => service.create({ name: '不得创建' }), 'server_full');
now += config.disconnectMs;
await service.reap();
assert.equal(service.rooms.get(timeoutRoom.code)!.members.length, 0);
now += config.idleMs;
await service.reap();
assert.equal(service.rooms.size, 0);
const store = new MemoryStore();
await store.putSnapshot('race', { turn: 0, state: '{}' });
await assert.rejects(() => store.putSnapshot('race', { turn: 0, state: 'invalid' }));
await store.putSnapshot('race', { turn: 1, state: '{"latest":true}' });
assert.equal((await store.getHistory('race')).length, 1);
console.log('PASS rooms: authority, private views, owner transfer, start, no AI, memory/capacity limits, idle cleanup, reconnect, snapshot conflict');
