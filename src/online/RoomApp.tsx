import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { HALF_DECKS, type HalfDeck } from '../half-decks';
import { ui } from '../i18n';
import { useLocale } from '../use-locale';
import { LanguageTools } from '../components/LanguageTools';
import { OnlinePlay } from './OnlinePlay';
import { roomText as t } from './room-strings';
import { ServerImageSetup } from '../components/ServerImageSetup';
import { usesServerImages } from '../image-cache';
import { useServerImageMode } from '../server-images';

interface Session { code: string; token: string }
interface RoomView {
  code: string;
  capacity: number;
  decks: HalfDeck[];
  phase: 'lobby' | 'playing';
  owner: number;
  you: number;
  notice?: string;
  members: Array<{ slot: number; name: string }>;
  gameId?: string;
  gameToken?: string;
  token?: string;
}
class RoomError extends Error {
  constructor(readonly code: string) { super(t(code)); }
}
const KEY = 'totu.live-room.v1';
function restore(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Session | null;
    return value && /^\d{6}$/.test(value.code) && /^[a-f0-9]{48}$/.test(value.token) ? value : null;
  } catch { return null; }
}
function remember(session: Session | null) {
  // 只记当前标签页的连接凭证，不保存棋盘、手牌或对局进度。
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch { /* 禁用存储时仍可联机，但刷新后需要重新加入。 */ }
}
async function request(path: string, data?: unknown, signal?: AbortSignal): Promise<RoomView> {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    signal: signal ?? AbortSignal.timeout(15000), cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new RoomError(result.error ?? 'error');
  return result as RoomView;
}
export function RoomApp() {
  useLocale();
  const [session, setSession] = useState<Session | null>(restore);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [decks, setDecks] = useState<HalfDeck[]>(['drow', 'dragons']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [imageSetup, setImageSetup] = useState<'create' | 'join' | 'settings' | null>(null);
  const [imagesReady, setImagesReady] = useState(() => !usesServerImages());
  const imageMode = useServerImageMode();
  const codeInput = useRef<HTMLInputElement>(null);
  const save = (next: Session | null) => { remember(next); setSession(next); };

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const view = await request(`/api/rooms/${session.code}?as=${session.token}`, undefined, controller.signal);
        if (!stopped) { setRoom(view); setError(''); }
      } catch (err) {
        if (!stopped) {
          if (err instanceof RoomError && ['room_not_found', 'invalid_session'].includes(err.code)) {
            remember(null); setSession(null); setRoom(null); setError(err.code);
          } else setError('connection');
        }
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [session]);

  async function enter(create: boolean, imagesChosen = false) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!name.trim() || name.trim().length > 24) throw new RoomError('invalid_name');
      if (!create && !/^\d{6}$/.test(code)) throw new RoomError('invalid_code');
      // 在创建席位前准备图片，慢速下载不会占用失联宽限或阻塞其他玩家。
      if (usesServerImages() && !imagesChosen) { setImageSetup(create ? 'create' : 'join'); return; }
      const view = await request(create ? '/api/rooms' : '/api/rooms/join',
        create ? { name, capacity, decks } : { name, code });
      setRoom(view);
      save({ code: view.code, token: view.token! });
    } catch (err) { setError(err instanceof RoomError ? err.code : 'connection'); }
    finally { setBusy(false); }
  }
  async function action(kind: 'start' | 'leave') {
    if (!session || busy) return;
    if (kind === 'leave' && room?.phase === 'playing' && !confirm(t('leaving'))) return;
    setBusy(true); setError('');
    try {
      const view = await request(`/api/rooms/${session.code}/${kind}?as=${session.token}`, {});
      if (kind === 'leave') {
        save(null); setRoom(null);
      } else setRoom(view);
    } catch (err) { setError(err instanceof RoomError ? err.code : 'connection'); }
    finally { setBusy(false); }
  }
  const playing = room?.phase === 'playing' && room.gameId && room.gameToken;
  return (
    <>
      <LanguageTools />
      <main style={{ maxWidth: playing ? undefined : 760, margin: 'auto', padding: playing ? 12 : 24 }}>
        <h1 style={{ fontSize: 26 }}>{t('title')}</h1>
        {usesServerImages() && <button style={button} onClick={() => setImageSetup('settings')}>
          {ui('Image settings')} · {ui(imageMode === 'local' ? 'Local images' : 'No images')}
        </button>}
        {!playing && <><p>{t('intro')}</p><p style={muted}>{t('temporary')}</p><p style={muted}>{t('http')}</p></>}
        {error && <p role="alert" style={{ color: '#ffb3b3' }}>{t(error)}</p>}
        {!session && (
          <>
          <section style={panel}>
            <h2>{ui('Local AI game')}</h2>
            <p style={muted}>{ui('Local AI explanation')}</p>
            <a href="/solo" style={{ ...button, display: 'inline-block', textDecoration: 'none' }}>{ui('Play against AI')}</a>
          </section>
          <section style={panel}>
            <label style={label}>{t('name')}
              <input value={name} onChange={event => setName(event.target.value)} maxLength={24} autoComplete="nickname" style={input} />
            </label>
            <label style={label}>{t('capacity')}
              <select value={capacity} onChange={event => setCapacity(Number(event.target.value))} style={input}>
                {[2, 3, 4].map(count => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <fieldset style={{ border: '1px solid #66507d', margin: '12px 0' }}>
              <legend>{t('decks')}</legend>
              {HALF_DECKS.map(deck => <label key={deck} style={{ display: 'inline-flex', padding: 10, gap: 6 }}>
                <input type="checkbox" checked={decks.includes(deck)} onChange={() => setDecks(current =>
                  current.includes(deck) ? current.filter(item => item !== deck) : [...current, deck].slice(-2))} />
                {ui(deck)}
              </label>)}
            </fieldset>
            <button style={button} disabled={busy || decks.length !== 2} onClick={() => void enter(true)}>{t(busy ? 'busy' : 'create')}</button>
            <hr style={{ borderColor: '#493459', margin: '24px 0' }} />
            <label style={label}>{t('code')}
              <input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} style={input} />
            </label>
            <button style={button} disabled={busy || code.length !== 6} onClick={() => void enter(false)}>{t(busy ? 'busy' : 'join')}</button>
          </section>
          </>
        )}
        {session && !room && <p>{t('reconnect')}</p>}
        {session && room && (
          <section style={panel}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <label>{t('code')} <input ref={codeInput} readOnly value={room.code} style={{ ...input, width: 108, fontSize: 24, letterSpacing: 3 }} /></label>
              <button style={button} onClick={async () => {
                try {
                  if (!navigator.clipboard) throw new Error();
                  await navigator.clipboard.writeText(room.code); setCopyStatus('copied');
                } catch { codeInput.current?.select(); setCopyStatus('manual_copy'); }
              }}>{t('copy')}</button>
              <button style={button} disabled={busy} onClick={() => void action('leave')}>{t('leave')}</button>
            </div>
            {copyStatus && <p role="status">{t(copyStatus)}</p>}
            <ul style={{ lineHeight: 2 }}>
              {room.members.map(member => <li key={member.slot}>
                {member.name}{member.slot === room.owner ? ` · ${t('owner')}` : ''}{member.slot === room.you ? ` · ${t('you')}` : ''}
              </li>)}
            </ul>
            {!playing && <>
              {room.notice && <p role="status">{t(room.notice)}</p>}
              {room.owner === room.you
                ? <button style={button} disabled={busy || room.members.length < 2} onClick={() => void action('start')}>{t('start')}</button>
                : <p>{t('waiting')}</p>}
              {room.members.length < 2 && <p>{t('need_players')}</p>}
            </>}
          </section>
        )}
        {playing && imagesReady && <OnlinePlay key={room.gameId} gameId={room.gameId!} token={room.gameToken!} friendsOnly />}
      </main>
      {playing && !imagesReady && !imageSetup && <ServerImageSetup entering
        onContinue={() => setImagesReady(true)} onCancel={() => void action('leave')} />}
      {imageSetup && <ServerImageSetup entering={imageSetup !== 'settings'} onCancel={() => setImageSetup(null)}
        onContinue={() => {
          const pending = imageSetup;
          setImagesReady(true);
          setImageSetup(null);
          if (pending !== 'settings') void enter(pending === 'create', true);
        }} />}
    </>
  );
}
const muted: CSSProperties = { color: '#bbb0c9', fontSize: 14, lineHeight: 1.6 };
const panel: CSSProperties = { background: '#1b1229', border: '1px solid #63477c', borderRadius: 10, padding: 20, marginBottom: 16 };
const label: CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap' };
const input: CSSProperties = { background: '#100b1b', color: '#f5efff', border: '1px solid #8b70a5', borderRadius: 5, padding: 10, fontSize: 16 };
const button: CSSProperties = { background: '#65418b', color: '#fff', border: '1px solid #a284bf', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 15 };
