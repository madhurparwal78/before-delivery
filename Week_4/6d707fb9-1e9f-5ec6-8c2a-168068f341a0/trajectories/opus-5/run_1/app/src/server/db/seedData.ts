import type { FactorRow } from '../domain/factors';

export const LABEL_STRIP = [
  'Mar\u00e9 Alta',
  'Linho & Sal',
  'Atelier Noroeste',
  'Kade Studio',
  'Fio Norte',
  'Serra Knit',
  'Douro Denim',
  'Cais Workwear',
];

/** Edition 2027.1 exactly as the factor library prints it, for the seeded results. */
export const EDITION_2027_1: FactorRow[] = [
  { id: 'organic-cotton', kind: 'material', makingMjPerKg: '14.8', climate: '4.02', water: '2840', fossil: '36.5', land: '0.0412', toxicity: '318', microfibres: '52' },
  { id: 'cotton', kind: 'material', makingMjPerKg: '14.8', climate: '5.91', water: '6120', fossil: '48.2', land: '0.0386', toxicity: '742', microfibres: '52' },
  { id: 'recycled-cotton', kind: 'material', makingMjPerKg: '11.2', climate: '1.87', water: '410', fossil: '21.4', land: '0.0041', toxicity: '96', microfibres: '61' },
  { id: 'linen', kind: 'material', makingMjPerKg: '13.5', climate: '2.64', water: '1180', fossil: '29.7', land: '0.0295', toxicity: '204', microfibres: '38' },
  { id: 'wool', kind: 'material', makingMjPerKg: '17.6', climate: '18.4', water: '3120', fossil: '44.9', land: '0.214', toxicity: '512', microfibres: '44' },
  { id: 'recycled-wool', kind: 'material', makingMjPerKg: '12.3', climate: '3.12', water: '640', fossil: '24.1', land: '0.0063', toxicity: '118', microfibres: '47' },
  { id: 'polyester', kind: 'material', makingMjPerKg: '21.4', climate: '3.24', water: '58', fossil: '71.6', land: '0.0009', toxicity: '86', microfibres: '410' },
  { id: 'recycled-polyester', kind: 'material', makingMjPerKg: '19.8', climate: '1.95', water: '41', fossil: '39.3', land: '0.0005', toxicity: '64', microfibres: '430' },
  { id: 'viscose', kind: 'material', makingMjPerKg: '24.3', climate: '4.77', water: '1420', fossil: '58.8', land: '0.0172', toxicity: '377', microfibres: '29' },
  { id: 'lyocell', kind: 'material', makingMjPerKg: '19.1', climate: '2.83', water: '890', fossil: '41.2', land: '0.0154', toxicity: '142', microfibres: '24' },
  { id: 'nylon', kind: 'material', makingMjPerKg: '26.7', climate: '7.31', water: '96', fossil: '96.4', land: '0.0011', toxicity: '131', microfibres: '385' },
  { id: 'elastane', kind: 'material', makingMjPerKg: '31.2', climate: '12.6', water: '210', fossil: '142', land: '0.0018', toxicity: '268', microfibres: '96' },
  { id: 'PT', kind: 'grid', climate: '0.0412', water: '0.118', fossil: '0.74', land: '0.000041', toxicity: '0.021', microfibres: '0' },
  { id: 'TR', kind: 'grid', climate: '0.124', water: '0.215', fossil: '1.62', land: '0.000085', toxicity: '0.043', microfibres: '0' },
  { id: 'VN', kind: 'grid', climate: '0.158', water: '0.264', fossil: '1.93', land: '0.000102', toxicity: '0.057', microfibres: '0' },
  { id: 'EG', kind: 'grid', climate: '0.131', water: '0.302', fossil: '1.81', land: '0.000076', toxicity: '0.049', microfibres: '0' },
  { id: 'IN', kind: 'grid', climate: '0.196', water: '0.341', fossil: '2.24', land: '0.000118', toxicity: '0.072', microfibres: '0' },
  { id: 'BD', kind: 'grid', climate: '0.172', water: '0.288', fossil: '2.07', land: '0.000109', toxicity: '0.064', microfibres: '0' },
  { id: 'sea', kind: 'mode', climate: '0.0107', water: '0.0042', fossil: '0.148', land: '0.000012', toxicity: '0.0088', microfibres: '0' },
  { id: 'road', kind: 'mode', climate: '0.105', water: '0.038', fossil: '1.48', land: '0.00021', toxicity: '0.092', microfibres: '0' },
  { id: 'rail', kind: 'mode', climate: '0.0281', water: '0.0113', fossil: '0.392', land: '0.000064', toxicity: '0.021', microfibres: '0' },
  { id: 'air', kind: 'mode', climate: '0.602', water: '0.176', fossil: '8.41', land: '0.00097', toxicity: '0.33', microfibres: '0' },
  { id: 'wash', kind: 'use', climate: '0.0213', water: '14.2', fossil: '0.31', land: '0.000012', toxicity: '0.0064', microfibres: '3.8' },
  { id: 'disposal', kind: 'endOfLife', climate: '0.0512', water: '0.84', fossil: '0.19', land: '0.000034', toxicity: '1.27', microfibres: '1.6' },
];

/** Edition 2026.2's kept rows, the same table but for two climate figures. */
export const EDITION_2026_2: FactorRow[] = EDITION_2027_1.map((row) => {
  if (row.id === 'organic-cotton') return { ...row, climate: '3.96' };
  if (row.id === 'TR') return { ...row, climate: '0.131' };
  return { ...row };
});

export const SEED_PASSWORD = 'desk-pass-2027';
