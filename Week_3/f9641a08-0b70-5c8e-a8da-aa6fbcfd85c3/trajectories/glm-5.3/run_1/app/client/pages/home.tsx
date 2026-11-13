import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { LoadingPanel, ErrorPanel } from '../app.js';

type Collection = { slug: string; name: string; designs: number; units: number };

const BAND_COLOURS: Record<string, string> = {
  luggage: 'red', backpacks: 'blue', totes: 'teal', wallets: 'yellow', accessories: 'red',
};

/** The masthead mosaic: six columns by two rows of greyscale studies and flat tiles. */
export function Masthead(): JSX.Element {
  const studies = [
    <svg viewBox="0 0 300 300" class="mast-study" aria-hidden="true"><rect x="70" y="70" width="160" height="170" rx="10" fill="#5a5f63" /><rect x="70" y="70" width="160" height="44" fill="#7d8286" /><rect x="120" y="48" width="60" height="26" rx="6" fill="#3b3f42" /><rect x="110" y="240" width="26" height="10" fill="#1c1e20" /><rect x="164" y="240" width="26" height="10" fill="#1c1e20" /></svg>,
    <svg viewBox="0 0 300 300" class="mast-study" aria-hidden="true"><rect x="100" y="80" width="100" height="150" rx="10" fill="#6b7074" /><rect x="100" y="80" width="100" height="36" fill="#8d9296" /><rect x="130" y="56" width="40" height="28" rx="6" fill="#3b3f42" /></svg>,
    <svg viewBox="0 0 300 300" class="mast-study" aria-hidden="true"><path d="M60 220 L60 120 Q60 90 90 90 L210 90 Q240 90 240 120 L240 220 Z" fill="#7d8286" /><rect x="120" y="60" width="60" height="30" rx="6" fill="#3b3f42" /></svg>,
    <svg viewBox="0 0 300 300" class="mast-study" aria-hidden="true"><rect x="90" y="100" width="120" height="140" rx="8" fill="#8d9296" /><rect x="120" y="80" width="60" height="24" rx="6" fill="#3b3f42" /></svg>,
  ];
  return (
    <div class="masthead" aria-hidden="true">
      <div class="mast-grid">
        <div class="mast-cell study">{studies[0]}</div>
        <div class="mast-cell tile red"></div>
        <div class="mast-cell study span-two">{studies[1]}</div>
        <div class="mast-cell tile yellow"></div>
        <div class="mast-cell study">{studies[2]}</div>
        <div class="mast-cell tile blue span-rows"></div>
        <div class="mast-cell study">{studies[3]}</div>
        <div class="mast-cell tile yellow"></div>
        <div class="mast-cell tile red"></div>
        <div class="mast-cell study">{studies[1]}</div>
      </div>
    </div>
  );
}

export function Home(): JSX.Element {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api.get<Collection[]>('/api/collections')
      .then(setCollections)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <ErrorPanel message="Something went wrong on our side. Try again." />;
  if (collections === null) return <LoadingPanel />;

  return (
    <div class="home">
      <Masthead />
      <div class="standfirst">
        <h1>Carry what the trip needs</h1>
        <p>Cases, packs and small goods, measured against the cabin frame before they reach the gate.</p>
      </div>
      <nav class="collection-pages" aria-label="Collections">
        {collections.filter((c) => c.slug !== 'all').map((c, i) => (
          <section key={c.slug} class={`collection-page ${i % 2 === 0 ? 'charcoal' : BAND_COLOURS[c.slug] ?? 'red'}`}>
            <div class="band">
              <p class="band-numeral">{c.units}</p>
              <p class="band-caption">units ready to ship</p>
              <p class="band-caption">{c.designs} {c.designs === 1 ? 'design' : 'designs'}</p>
            </div>
            <div class="band-title">
              <h2><a href={`/collections/${c.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/collections/${c.slug}`); }}>{c.name}</a></h2>
            </div>
          </section>
        ))}
      </nav>
    </div>
  );
}
