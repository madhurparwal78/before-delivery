import { announce, jsonScript, qs, qsa } from './core.js';
import { GateGauge } from './gauge.js';

type CompareItem = {
  sku: string;
  product: string;
  slug: string;
  category: string;
  height_cm: number;
  width_cm: number;
  depth_cm: number;
  weight_kg: number;
};

export function setupCompare(): void {
  const items = jsonScript<CompareItem[]>('compare-data', []);
  const fittable = items.filter((item) => ['luggage', 'backpacks', 'totes'].includes(item.category));

  const root = qs<HTMLElement>('[data-gauge]');
  if (root !== null && fittable.length > 0) {
    const gauge = new GateGauge(
      root,
      fittable.map((item) => ({
        sku: item.sku,
        height_cm: item.height_cm,
        width_cm: item.width_cm,
        depth_cm: item.depth_cm,
        weight_kg: item.weight_kg
      }))
    );
    gauge.setupTouchDrag();
  }

  for (const button of qsa<HTMLElement>('[data-remove-compare]')) {
    button.addEventListener('click', () => {
      const sku = button.dataset.removeCompare ?? '';
      const params = new URLSearchParams(window.location.search);
      const current = (params.get('compare') ?? '').split(',').filter((value) => value !== '');
      const next = current.filter((value) => value !== sku);
      if (next.length === 0) params.delete('compare');
      else params.set('compare', next.join(','));
      const item = items.find((entry) => entry.sku === sku);
      announce('compare-updates', `Removed ${item?.product ?? sku} from comparison.`);
      const query = params.toString();
      window.location.href = query === '' ? '/compare' : `/compare?${query}`;
    });
  }
}
