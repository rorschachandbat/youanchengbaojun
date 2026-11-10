import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardRef } from '../game';
import { lookupCard } from '../card-data';
import { cardName, cardStrings, ui } from '../i18n';
import { useLocale } from '../use-locale';

export function CardHoverPreview({ card, anchor, imageUrl, onImageError }: {
  card: CardRef;
  anchor: DOMRect;
  imageUrl?: string;
  onImageError: () => void;
}) {
  const locale = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const data = lookupCard(card.deck, card.slot);
  const strings = data ? cardStrings(data) : null;

  // 按浮层实际尺寸定位，中文说明的高度也计入边缘避让。
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + gap;
    if (left + width > vw - gap) {
      left = anchor.left - gap - width;
    }
    if (left < gap) {
      left = anchor.left + (anchor.width - width) / 2;
    }
    setPosition({
      left: Math.max(gap, Math.min(left, vw - width - gap)),
      top: Math.max(gap, Math.min(anchor.top + (anchor.height - height) / 2, vh - height - gap)),
    });
  }, [anchor, imageUrl, locale]);

  return createPortal(
    <div ref={panelRef} data-card-preview role="tooltip" style={{
      position: 'fixed', ...position, zIndex: 1000,
      width: imageUrl ? 'min(580px, calc(100vw - 24px))' : 'min(320px, calc(100vw - 24px))',
      maxHeight: 'calc(100vh - 24px)', boxSizing: 'border-box',
      display: 'flex', alignItems: 'flex-start', gap: 18, padding: 12,
      background: '#181122', color: '#f4efff',
      border: '1px solid #796098', borderRadius: 14,
      boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
      pointerEvents: 'none', overflow: 'hidden',
      fontFamily: 'system-ui, sans-serif', textAlign: 'left',
    }}>
      {imageUrl && (
        <img src={imageUrl} alt={cardName(card.name)} onError={onImageError} style={{
          display: 'block', width: 'min(48%, calc((100vh - 50px) * 749 / 1046))',
          height: 'auto', aspectRatio: '749 / 1046', objectFit: 'contain',
          flexShrink: 0, borderRadius: 8,
        }} />
      )}
      {/* 中文使用独立文本区和实色底，不随卡图缩放，也不与底层文字叠加。 */}
      <div style={{ flex: 1, minWidth: 0, padding: '5px 3px', overflowWrap: 'anywhere' }}>
        <div style={{ fontSize: 22, fontWeight: 750, lineHeight: 1.4 }}>
          {strings?.name ?? cardName(card.name)}
        </div>
        {data && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 8, fontSize: 12, color: '#c9b8e1' }}>
            <span>{ui(data.aspect)}</span>
            <span>{ui('Cost: {cost} Influence', { cost: data.cost })}</span>
          </div>
        )}
        <div style={{ borderTop: '1px solid #493456', margin: '16px 0' }} />
        <div style={{ display: 'grid', gap: 12, fontSize: 16, lineHeight: 1.8 }}>
          {strings?.benefits.length
            ? strings.benefits.map((benefit, index) => <div key={index}>{benefit}</div>)
            : <div>{ui('No effect text')}</div>}
        </div>
        {data && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 20,
            paddingTop: 12, borderTop: '1px solid #493456', fontSize: 12, color: '#c9b8e1',
          }}>
            <span>{ui('Deck VP')}: {data.deckVp}</span>
            <span>{ui('Inner Circle VP')}: {data.innerCircleVp}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
