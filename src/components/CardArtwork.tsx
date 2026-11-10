import type { CardRef } from '../game';
import { lookupCard } from '../card-data';
import { cardName, cardStrings, isChinese } from '../i18n';
import { useLocale } from '../use-locale';

// 保留完整原版卡图，中文译文放在图片下方，避免遮住美术或丢失规则说明。
export function CardArtwork({ card, url, onError, onLoad }: {
  card: CardRef;
  url: string;
  onError?: () => void;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
}) {
  useLocale();
  const data = lookupCard(card.deck, card.slot);
  const strings = data ? cardStrings(data) : null;
  return (
    <div>
      <img src={url} alt={cardName(card.name)} onError={onError} onLoad={onLoad}
        style={{
          width: '100%', aspectRatio: '749 / 1046', objectFit: 'contain',
          display: 'block', borderRadius: 8, pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }} />
      {isChinese() && strings && (
        <div style={{ padding: '6px 7px', fontSize: 10, lineHeight: 1.45, color: '#e6e1f2' }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{strings.name}</div>
          {strings.benefits.map((benefit, index) => <div key={index}>{benefit}</div>)}
        </div>
      )}
    </div>
  );
}
