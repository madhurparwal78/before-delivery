import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../api';
import { useShell } from '../shell';
import type { GalleryItem } from '../types';
import { AwardMarker, GridLines } from '../ui';

const AWARD_OPTIONS = [
  ['winner', 'Winner'],
  ['finalist', 'Finalist'],
  ['honourable_mention', 'Honourable mention'],
];

export function Gallery(): JSX.Element {
  useShell('Gallery', null);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [all, setAll] = useState<GalleryItem[]>([]);
  const [year, setYear] = useState('');
  const [category, setCategory] = useState('');
  const [award, setAward] = useState('');

  useEffect(() => {
    void api<{ items: GalleryItem[] }>('GET', '/api/public/gallery').then((body) => setAll(body.items));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams();
    if (year !== '') query.set('year', year);
    if (category !== '') query.set('category', category);
    if (award !== '') query.set('award', award);
    const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
    void api<{ items: GalleryItem[] }>('GET', `/api/public/gallery${suffix}`).then((body) =>
      setItems(body.items),
    );
  }, [year, category, award]);

  const years = useMemo(() => [...new Set(all.map((item) => String(item.year)))].sort().reverse(), [all]);
  const categories = useMemo(() => [...new Set(all.map((item) => item.category))].sort(), [all]);

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>Gallery</h1>
      </div>
      <div class="span-12 row-flex">
        <div>
          <label for="gallery-year">Year</label>
          <select
            id="gallery-year"
            aria-label="Year"
            value={year}
            onChange={(event) => setYear((event.target as HTMLSelectElement).value)}
          >
            <option value="">All</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label for="gallery-category">Category</label>
          <select
            id="gallery-category"
            aria-label="Category"
            value={category}
            onChange={(event) => setCategory((event.target as HTMLSelectElement).value)}
          >
            <option value="">All</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label for="gallery-award">Award level</label>
          <select
            id="gallery-award"
            aria-label="Award level"
            value={award}
            onChange={(event) => setAward((event.target as HTMLSelectElement).value)}
          >
            <option value="">All</option>
            {AWARD_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div class="span-12">
        <ul class="cards" aria-label="Winners">
          {items.map((item) => (
            <li key={`${item.programName}-${item.entryNumber}`}>
              <article class="card">
                <img src={item.images[0]} alt={`${item.title} by ${item.studioName}`} />
                <h3>{item.title}</h3>
                <p class="hint">
                  {item.studioName} · {item.year} · {item.category}
                </p>
                <p>
                  <AwardMarker award={item.award} />
                </p>
                <p class="mono">{item.score ?? '—'}</p>
              </article>
            </li>
          ))}
        </ul>
        {items.length === 0 ? <p class="hint">No winners match those filters yet.</p> : null}
      </div>
    </div>
  );
}
