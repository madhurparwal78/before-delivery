import { api, guard } from './api';
import { clear, el, play, reducedMotion, shortSha } from './dom';
import { announce } from './state';

export type Car = { iid: number; position: number; sha: string; pipeline_id: number | null; pipeline_status: string };

export function carItem(car: Car): HTMLElement {
  const kicker = el('span', { class: 'mono kicker', 'aria-label': `Testing ${shortSha(car.sha)}` }, [
    '[ ',
    el('span', { class: 'sha', text: shortSha(car.sha) }),
    ' ]',
  ]);
  const item = el(
    'li',
    {
      role: 'listitem',
      'aria-label': `Position ${car.position}, !${car.iid}, testing ${shortSha(car.sha)}, pipeline ${car.pipeline_status}`,
      'data-position': String(car.position),
      'data-iid': String(car.iid),
      'data-sha': car.sha,
      class: 'car',
      tabindex: '-1',
      style: `--step: ${(car.position - 1) % 3}`,
    },
    [
      el('p', { class: 'mono id', text: `!${car.iid}` }),
      kicker,
      el('p', { class: 'status', text: car.pipeline_status }),
    ],
  );
  return item;
}

export function resolveKicker(item: HTMLElement): void {
  const sha = item.dataset.sha ?? '';
  const target = shortSha(sha);
  const node = item.querySelector<HTMLElement>('.sha');
  if (node === null) return;
  if (reducedMotion()) {
    node.textContent = target;
    return;
  }
  const glyphs = '0123456789abcdef';
  let locked = 0;
  node.textContent = target;
  const scramble = window.setInterval(() => {
    const characters = target
      .split('')
      .map((character, index) => (index < locked ? character : glyphs[Math.floor(Math.random() * glyphs.length)]));
    node.textContent = characters.join('');
  }, 40);
  window.setTimeout(() => {
    const lock = window.setInterval(() => {
      locked += 1;
      if (locked >= target.length) {
        window.clearInterval(lock);
        window.clearInterval(scramble);
        node.textContent = target;
      }
    }, 50);
  }, 100);
}

export function renderTrainList(host: HTMLElement, cars: Car[], previous: Map<number, Car>): void {
  clear(host);
  host.setAttribute('role', 'list');
  host.setAttribute('aria-label', 'Merge train');
  host.classList.add('train');
  if (cars.length === 0) {
    host.append(el('li', { class: 'empty-car', text: 'The train is empty' }));
    return;
  }
  let moved = 0;
  for (const car of cars) {
    const item = carItem(car);
    host.append(item);
    const before = previous.get(car.iid);
    const changed = before === undefined || before.sha !== car.sha;
    if (before === undefined) {
      play(item, 'train-step');
    } else if (before.position !== car.position) {
      play(item, 'train-step', { delay: moved * 80, rising: before.position > car.position });
      moved += 1;
    }
    if (changed) resolveKicker(item);
    else {
      const node = item.querySelector<HTMLElement>('.sha');
      if (node !== null) node.textContent = shortSha(car.sha);
    }
  }
}

export async function loadTrain(projectId: number, target: string): Promise<Car[]> {
  const result = await guard(() =>
    api.get<{ cars: Car[] }>(`/api/projects/${projectId}/train?target=${encodeURIComponent(target)}`),
  );
  return result?.cars ?? [];
}

export function announceCar(car: Car): void {
  announce(`!${car.iid} is now position ${car.position}, testing ${shortSha(car.sha)}`);
}
