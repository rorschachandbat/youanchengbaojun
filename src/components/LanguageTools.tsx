import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { allCards } from '../card-data';
import { cardStrings, getLocale, setLocale, ui } from '../i18n';
import { useLocale } from '../use-locale';

export function LanguageTools() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const feedbackDialog = useRef<HTMLDialogElement>(null);
  const feedbackOpener = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const cards = [...new Map(allCards().map(card => [card.effectKey, card])).values()];
  const query = search.trim().toLocaleLowerCase();
  const filtered = cards.filter(card => {
    const strings = cardStrings(card);
    return [card.name, strings.name, card.deck, ui(card.deck), ...strings.benefits, ...card.benefits]
      .join(' ').toLocaleLowerCase().includes(query);
  });

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    searchInput.current?.focus();
    return () => { dialog.current?.close(); opener.current?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!feedbackOpen) return;
    const modal = feedbackDialog.current;
    const trigger = feedbackOpener.current;
    modal?.showModal();
    return () => { modal?.close(); trigger?.focus(); };
  }, [feedbackOpen]);

  return (
    <>
      <nav aria-label={ui('Language')} style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        padding: '8px 16px', background: '#1a1228', borderBottom: '1px solid #5a3380',
      }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          {ui('Language')}
          <select value={locale} onChange={event => setLocale(event.target.value === 'en' ? 'en' : 'zh-CN')}>
            <option value="zh-CN">{ui('Simplified Chinese')}</option>
            <option value="en">{ui('English')}</option>
          </select>
        </label>
        <button ref={opener} onClick={() => setOpen(true)} style={{
          padding: '6px 12px', background: '#5a3380', color: '#fff',
          border: '1px solid #8f6bb8', borderRadius: 5, cursor: 'pointer',
        }}>{ui('Card reference / help')}</button>
        <button ref={feedbackOpener} type="button" onClick={() => setFeedbackOpen(true)}
          style={{
            padding: '6px 12px', background: '#1d493d', color: '#fff',
            border: '1px solid #4b9b7e', borderRadius: 5, cursor: 'pointer',
          }}>{ui('Report a bug / suggest an improvement')}</button>
      </nav>
      {feedbackOpen && createPortal(
        <dialog ref={feedbackDialog} onCancel={() => setFeedbackOpen(false)}
          onClick={event => { if (event.target === event.currentTarget) setFeedbackOpen(false); }}
          aria-labelledby="feedback-title"
          aria-describedby="feedback-description"
          style={{
            width: 440, maxWidth: '94vw', boxSizing: 'border-box', padding: 24,
            background: '#100b1c', color: '#e6e1f2', border: '1px solid #8f6bb8',
            borderRadius: 10,
          }}>
          <h2 id="feedback-title" style={{ margin: '0 0 16px', fontSize: 20 }}>
            {ui('Report a bug / suggest an improvement')}
          </h2>
          <p id="feedback-description" style={{ lineHeight: 1.7 }}>
            {ui('Feedback email instructions')}
          </p>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', marginBottom: 8 }}>{ui('Feedback email')}</span>
            <input readOnly value="1174751102@qq.com"
              onFocus={event => event.currentTarget.select()}
              onClick={event => event.currentTarget.select()}
              style={{
                width: '100%', boxSizing: 'border-box', padding: 12, fontSize: 18,
                background: '#241636', color: '#fff', border: '1px solid #8f6bb8',
                borderRadius: 5,
              }} />
          </label>
          <div style={{ marginTop: 20, textAlign: 'right' }}>
            <button type="button" autoFocus onClick={() => setFeedbackOpen(false)}>{ui('Close')}</button>
          </div>
        </dialog>, document.body)}
      {open && createPortal(
        <dialog ref={dialog} onCancel={() => setOpen(false)}
          onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}
          aria-labelledby="card-reference-title"
          style={{
            width: 1060, maxWidth: '94vw', maxHeight: '90vh', boxSizing: 'border-box',
            padding: 0, background: '#100b1c', color: '#e6e1f2', border: '1px solid #8f6bb8',
            borderRadius: 10,
          }}>
          <header style={{
            position: 'sticky', top: 0, zIndex: 1, display: 'flex',
            alignItems: 'center', justifyContent: 'space-between', gap: 12,
            background: '#241636', padding: 16,
          }}>
            <h2 id="card-reference-title" style={{ margin: 0, fontSize: 20 }}>{ui('Card reference / help')}</h2>
            <button onClick={() => setOpen(false)}>{ui('Close')}</button>
          </header>
          <section style={{ padding: '0 20px 20px' }}>
            <h3>{ui('Quick start')}</h3>
            <ol style={{ paddingLeft: 24, lineHeight: 1.8, fontSize: 14 }}>
              {['Help setup', 'Help turn', 'Help targets', 'Help keywords', 'Help focus', 'Help end', 'Help images']
                .map(key => <li key={key}>{ui(key)}</li>)}
            </ol>
            {getLocale() === 'zh-CN' && <p style={{ fontSize: 12, color: '#cdb6ff' }}>{ui('Chinese edition note')}</p>}
            <label style={{ display: 'block', margin: '20px 0' }}>
              <span style={{ display: 'block', marginBottom: 8 }}>{ui('Search cards')} ({filtered.length}/{cards.length})</span>
              <input ref={searchInput} value={search} onChange={event => setSearch(event.target.value)}
                placeholder={ui('Search cards')} style={{
                  width: '100%', boxSizing: 'border-box', padding: 10, background: '#241636',
                  color: '#fff', border: '1px solid #8f6bb8', borderRadius: 5,
                }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 12 }}>
              {filtered.map(card => {
                const strings = cardStrings(card);
                return (
                  <article key={card.effectKey} style={{ padding: 16, background: '#241636', border: '1px solid #5a3380', borderRadius: 8 }}>
                    <h3 style={{ margin: '0 0 4px', color: '#e5d4ff' }}>{strings.name}</h3>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{card.name} · {ui(card.deck)}</div>
                    <p style={{ fontSize: 13 }}>{ui('Cost: {cost} Influence', { cost: card.cost })} · {ui(card.aspect)} · {ui(card.type)}</p>
                    <ul style={{ paddingLeft: 18, lineHeight: 1.65, fontSize: 14 }}>
                      {strings.benefits.map((benefit, i) => <li key={i}>{benefit}</li>)}
                    </ul>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {ui('Deck VP')}: {card.deckVp} · {ui('Inner Circle VP')}: {card.innerCircleVp}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </dialog>, document.body)}
    </>
  );
}
