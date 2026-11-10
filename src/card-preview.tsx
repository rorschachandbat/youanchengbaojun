import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { allCards } from './card-data';
import { cardName, ui } from './i18n';
import { CardArtwork } from './components/CardArtwork';
import { CardHoverPreview } from './components/CardHoverPreview';

// 本地效果页复用正式预览组件，打开即可比较短效果与长效果，不需要开始对局。
const cards = ['advocate', 'inquisitor', 'green-dragon', 'wyrmspeaker', 'red-dragon', 'house-guard', 'priestess-of-lolth']
  .map(key => allCards().find(card => card.effectKey === key)!);

function PreviewPage() {
  const [selected, setSelected] = useState(3);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const cardElements = useRef<Array<HTMLButtonElement | null>>([]);
  const card = cards[selected];
  const imageUrl = `/${card.image}`;

  useLayoutEffect(() => {
    document.title = ui('Card reference / help');
    const update = () => setAnchor(cardElements.current[selected]?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [selected]);

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 24 }}>{ui('Card reference / help')}</h1>
      <h2 style={{ fontSize: 18, marginTop: 28 }}>{ui('Market')}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {cards.map((item, index) => (
          <button key={item.effectKey} ref={el => { cardElements.current[index] = el; }}
            onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)}
            onClick={() => setSelected(index)}
            title={cardName(item.name)}
            style={{
              width: 120, padding: 0, borderRadius: 8, textAlign: 'left', font: 'inherit',
              border: selected === index ? '1px solid #b894ee' : '1px solid transparent',
              background: '#1a1228', color: '#e6e1f2', cursor: 'pointer',
            }}>
            <CardArtwork card={item} url={`/${item.image}`} />
          </button>
        ))}
      </div>
      {anchor && <CardHoverPreview card={card} anchor={anchor}
        imageUrl={failedImages.has(imageUrl) ? undefined : imageUrl}
        onImageError={() => setFailedImages(previous => new Set(previous).add(imageUrl))} />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<PreviewPage />);
