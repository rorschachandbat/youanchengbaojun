import assert from 'node:assert/strict';

const base = (process.env.SMOKE_BASE ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
async function call(path: string, data?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() as any };
}
const health = await call('/api/health');
assert.equal(health.status, 200);
assert.equal(health.body.persistence, false);
assert.equal(health.body.ai, false);
const owner = (await call('/api/rooms', { name: 'HTTP测试甲', capacity: 2 })).body;
const code = owner.code;
const sessions: string[] = [owner.token];
try {
  assert.match(code, /^\d{6}$/);
  const oneStart = await call(`/api/rooms/${code}/start?as=${owner.token}`, {});
  assert.equal(oneStart.status, 409);
  const guest = (await call('/api/rooms/join', { name: 'HTTP测试乙', code })).body;
  sessions.push(guest.token);
  assert.equal((await call(`/api/rooms/${code}/start?as=${guest.token}`, {})).status, 403);
  assert.equal((await call('/api/rooms/join', { name: '超员', code })).status, 409);
  const start = await call(`/api/rooms/${code}/start?as=${owner.token}`, {});
  assert.equal(start.status, 200);
  const other = (await call(`/api/rooms/${code}?as=${guest.token}`)).body;
  const gameId = start.body.gameId;
  const tokenA = start.body.gameToken;
  const tokenB = other.gameToken;
  const [stateA, stateB] = await Promise.all([
    call(`/api/games/${gameId}?as=${tokenA}`),
    call(`/api/games/${gameId}?as=${tokenB}`),
  ]);
  assert.equal(stateA.body.you, '0');
  assert.equal(stateB.body.you, '1');
  assert.equal((await call(`/api/games/${gameId}?as=forged`)).status, 401);
  assert.equal('tokens' in stateA.body, false);
  assert.ok(stateB.body.view.G.players['0'].hand.every((card: any) => card.deck === '__hidden__'));
  // 通过同一公网 HTTP 地址驱动两个独立席位，不使用本机游戏模拟器代替网络。
  const tokens: Record<string, string> = { '0': tokenA, '1': tokenB };
  let moved = 0;
  for (let step = 0; step < 16; step++) {
    let acted = false;
    for (const token of Object.values(tokens)) {
      const legal = await call(`/api/games/${gameId}/legal?as=${token}`);
      assert.equal(legal.status, 200);
      if (!legal.body.length) continue;
      const action = legal.body.find((move: any) => move.kind === 'deployStartingTroop')
        ?? (step % 3 === 2 ? legal.body.find((move: any) => move.kind === 'endTurn') : undefined)
        ?? legal.body.find((move: any) => move.kind === 'playCard') ?? legal.body[0];
      const result = await call(`/api/games/${gameId}/submit?as=${token}`, { action });
      assert.equal(result.status, 200, JSON.stringify({ step, action, result: result.body }));
      moved++; acted = true; break;
    }
    assert.ok(acted, '至少一个真人席位有合法操作');
  }
  assert.equal((await call(`/api/games/${gameId}/submit?as=${tokenA}`, { action: { kind: 'forfeitSeat', seat: '1' } })).status, 422);
  const chat = await call(`/api/games/${gameId}/chat?as=${tokenA}`, { body: '公网双人测试' });
  assert.equal(chat.status, 200);
  assert.ok((await call(`/api/games/${gameId}/chat?as=${tokenB}`)).body.some((item: any) => item.body === '公网双人测试'));
  await call(`/api/rooms/${code}/leave?as=${owner.token}`, {});
  const transferred = (await call(`/api/rooms/${code}?as=${guest.token}`)).body;
  assert.equal(transferred.owner, guest.you);
  assert.equal(transferred.phase, 'lobby');
  assert.equal((await call(`/api/games/${gameId}?as=${tokenB}`)).status, 404);
  assert.equal((await call('/api/games', { numPlayers: 2, ai: { '1': 'random' } })).status, 404);
  assert.equal((await call('/api/reports')).status, 404);
  const traversal = await fetch(`${base}/server/standalone.ts`);
  assert.equal(traversal.status, 404);
  const malformed = await fetch(`${base}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  const crossOrigin = await fetch(`${base}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://untrusted.invalid' },
    body: JSON.stringify({ name: '跨站' }),
  });
  assert.equal(crossOrigin.status, 403);
  console.log(`PASS HTTP: ${base}, two authenticated players, ${moved} legal moves, hidden hands, owner-only start, owner transfer, chat, no AI/persistence routes`);
} finally {
  for (const token of sessions) await call(`/api/rooms/${code}/leave?as=${token}`, {}).catch(() => {});
}
