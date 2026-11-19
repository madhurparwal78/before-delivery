import { copy, filmText } from '../shared/copy.js';
import { islandName } from '../shared/islands.js';
import { announce, api, byId } from './dom.js';
import { connectLive } from './live.js';

type Album = {
  island: number;
  island_name: string;
  pages: { creature: string; creature_name: string; filled: boolean; total: number | null }[];
  pages_filled: number;
};

export function startTextWorld(): void {
  const content = byId('text-world-content') ?? byId('play-text-world');
  if (!content) return;

  for (const button of content.querySelectorAll<HTMLElement>('.text-sail'))
    button.addEventListener('click', () => void sail(Number(button.dataset.island)));
  byId('text-refill')?.addEventListener('click', () => void refill());

  async function sail(island: number): Promise<void> {
    const answer = await api('/api/me/position', {
      method: 'PUT',
      body: { island, tile: [3, 12], heading: 'E' },
    });
    if (!answer.ok) {
      announce('text-world-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    await refresh(island, [3, 12]);
  }

  async function refill(): Promise<void> {
    const answer = await api<{ film: number }>('/api/me/refill', { method: 'POST', body: {} });
    if (!answer.ok) {
      announce('text-world-status', answer.body.message ?? copy.photoNetwork);
      return;
    }
    setLine('film', `Film: ${filmText(answer.body.film)}`);
    announce('text-world-status', copy.filmRefilled);
  }

  function setLine(name: string, text: string): void {
    const node = content!.querySelector<HTMLElement>(`[data-text="${name}"]`);
    if (node && node.textContent !== text) node.textContent = text;
  }

  async function refresh(island?: number, tile?: [number, number]): Promise<void> {
    const me = await api<{
      position: { island: number; tile: [number, number] };
      film: number;
      stamps: number;
      lighthouse: 'open' | 'closed';
    }>('/api/me');
    if (!me.ok) return;
    const albums = await api<{ albums: Album[] }>('/api/me/albums');
    if (albums.ok)
      for (const album of albums.body.albums) {
        const section = content!.querySelector<HTMLElement>(`[data-island="${album.island}"] [data-text="pages"]`);
        const text = `${album.pages_filled} of 4 album pages`;
        if (section && section.textContent !== text) section.textContent = text;
      }
    const place = island ?? me.body.position.island;
    const at = tile ?? me.body.position.tile;
    setLine('stamps', `Stamps: ${me.body.stamps}`);
    setLine('lighthouse', `Lighthouse: ${me.body.lighthouse}`);
    setLine('film', `Film: ${filmText(me.body.film)}`);
    const location = copy.textLocation(islandName(place), at[0], at[1]);
    const node = content!.querySelector<HTMLElement>('[data-text="location"]');
    if (node && node.textContent !== location) {
      node.textContent = location;
      announce('text-world-status', location);
    }
    const refillButton = byId<HTMLButtonElement>('text-refill');
    if (refillButton) refillButton.disabled = !(place === 1 && me.body.film < 36);
    for (const button of content!.querySelectorAll<HTMLElement>('.text-sail'))
      button.hidden = Number(button.dataset.island) === place;
  }

  connectLive((message) => {
    if (message.kind === 'position' && message.host !== true) {
      const tile = message.tile as [number, number];
      void refresh(Number(message.island), tile);
      return;
    }
    if (message.kind === 'progress') void refresh();
  });
}
