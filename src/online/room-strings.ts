import { isChinese } from '../i18n';

// 联机界面和服务端错误码的玩家文案统一走 StringTable。
const ROOM_STRING_TABLE = {
  title: ['幽暗地域暴君 · 好友联机', 'Tyrants of the Underdark · Friends'],
  intro: ['2–4 位真人通过同一台公网服务器联机，无需注册账号。', '2–4 human players on one public server. No account required.'],
  temporary: ['本局仅存于服务器内存，不提供存档；重启服务会结束所有对局。', 'Games live only in server memory. Restarting the server ends all games.'],
  http: ['当前为明文 HTTP，请勿使用敏感信息作昵称，也不要分享浏览器会话凭证。', 'Plain HTTP: do not use sensitive names or share your session credentials.'],
  name: ['昵称', 'Nickname'],
  capacity: ['房间人数上限', 'Room capacity'],
  decks: ['选择两个牌组', 'Choose two half-decks'],
  create: ['创建房间', 'Create room'],
  code: ['6 位房号', '6-digit room code'],
  join: ['加入房间', 'Join room'],
  busy: ['正在处理…', 'Working…'],
  owner: ['房主', 'Owner'],
  you: ['你', 'You'],
  start: ['开始游戏（房主）', 'Start game (owner)'],
  waiting: ['等待房主开始', 'Waiting for the owner'],
  need_players: ['至少需要 2 位玩家才能开始。', 'At least 2 players are required.'],
  ai_not_allowed: ['联机房间仅限真人，请使用本地 AI 对战。', 'Online rooms are for humans. Use local play for AI opponents.'],
  leave: ['离开房间', 'Leave room'],
  leaving: ['离开会结束本局，其他玩家将返回房间。确定离开？', 'Leaving ends this game and returns everyone to the room. Leave?'],
  player_left: ['有玩家离开或断线超过宽限时间，本局已结束；房主可以重新开始。', 'A player left or timed out. The game ended; the owner can start again.'],
  copy: ['复制房号', 'Copy code'],
  copied: ['已复制', 'Copied'],
  manual_copy: ['当前浏览器不支持直接复制，请选中房号后手动复制。', 'Select the room code and copy it manually.'],
  reconnect: ['正在连接房间…', 'Connecting to room…'],
  connection: ['连接暂时中断，正在重试；请保持此页面打开。', 'Connection interrupted. Retrying; keep this page open.'],
  error: ['请求失败，请重试。', 'Request failed. Please retry.'],
  invalid_name: ['昵称需为 1–24 个字符。', 'Use a nickname of 1–24 characters.'],
  invalid_capacity: ['房间人数必须为 2–4 人。', 'Room capacity must be 2–4.'],
  invalid_decks: ['请选择两个不同的牌组。', 'Choose two different half-decks.'],
  invalid_code: ['请输入 6 位数字房号。', 'Enter a 6-digit room code.'],
  room_not_found: ['房间已关闭或服务器已重启，请重新创建或加入。', 'Room closed or server restarted. Create or join again.'],
  invalid_session: ['会话已过期，请重新加入房间。', 'Session expired. Please join again.'],
  game_started: ['本局已经开始，不能加入新玩家。', 'This game has started. New players cannot join.'],
  room_full: ['房间已满。', 'Room is full.'],
  owner_only: ['只有房主能开始游戏。', 'Only the owner can start.'],
  server_full: ['房间数量已达保护上限，请稍后重试。', 'Room safety limit reached. Try later.'],
  server_busy: ['服务器资源不足，请稍后重试。', 'Server resources are low. Try later.'],
  rate_limited: ['操作过于频繁，请稍等一分钟。', 'Too many requests. Wait one minute.'],
  invalid_action: ['当前不能执行此操作，请等待状态同步后重试。', 'Action unavailable. Wait for the state to sync and retry.'],
  not_your_turn: ['尚未轮到你操作。', 'It is not your turn.'],
  stale_state: ['状态已更新，请等待同步后重试。', 'State changed. Wait for synchronization and retry.'],
  server_error: ['服务器暂时出错，请稍后重试。', 'Temporary server error. Try again later.'],
  invalid_message: ['聊天内容需为 1–500 个字符。', 'Chat messages must contain 1–500 characters.'],
} satisfies Record<string, [string, string]>;

export function roomText(key: string): string {
  const entry = ROOM_STRING_TABLE[key as keyof typeof ROOM_STRING_TABLE];
  return entry ? entry[isChinese() ? 0 : 1] : ROOM_STRING_TABLE.error[isChinese() ? 0 : 1];
}
