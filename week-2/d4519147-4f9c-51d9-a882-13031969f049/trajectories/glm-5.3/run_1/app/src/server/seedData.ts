// Seed data: Harbor Lane CDE scope and Kestrel Pay processing scope.

import type { PageDocument, Derived } from '../shared/types.js';
import { derivePage } from '../shared/geometry.js';

export const DIAGRAM_HARBOR = '5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01';
export const PAGE_NETWORK = '5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e11';
export const PAGE_FLOWS = '5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12';
export const DIAGRAM_KESTREL = '9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b702';
export const PAGE_KESTREL = '9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b712';

const networkPage: PageDocument = {
  id: PAGE_NETWORK,
  name: 'Network diagram',
  version: 1,
  zones: [
    { id: 'net-cde', kind: 'cde', name: 'Cardholder Data Environment', note: 'Segmented by <b>VLAN 20</b>', x: 480, y: 96, width: 576, height: 432 },
  ],
  shapes: [
    { id: 'net-firewall', kind: 'firewall', label: 'Edge firewall', x: 168, y: 264, width: 144, height: 72, z: 1, groupId: null },
    { id: 'net-switch', kind: 'router', label: 'CDE core switch', x: 600, y: 264, width: 144, height: 72, z: 2, groupId: null },
  ],
  connectors: [
    { id: 'net-trunk', label: 'VLAN 20 trunk', from: { shapeId: 'net-firewall', port: 'e' }, to: { shapeId: 'net-switch', port: 'w' }, points: [[312, 300], [600, 300]] },
  ],
};

const flowsPage: PageDocument = {
  id: PAGE_FLOWS,
  name: 'Account data flows',
  version: 1,
  zones: [
    { id: 'zone-connected', kind: 'connected', name: 'Connected-to systems', note: '', x: 48, y: 96, width: 384, height: 432 },
    { id: 'zone-cde', kind: 'cde', name: 'Cardholder Data Environment', note: 'Reviewed with assessor<br>September 2026', x: 480, y: 96, width: 576, height: 432 },
    { id: 'zone-out', kind: 'out_of_scope', name: 'Out of scope', note: '', x: 1104, y: 96, width: 384, height: 432 },
  ],
  shapes: [
    { id: 'shp-checkout', kind: 'web_app', label: 'Checkout web app', x: 168, y: 168, width: 144, height: 72, z: 1, groupId: null },
    { id: 'shp-admin', kind: 'workstation', label: 'Admin workstation', x: 168, y: 360, width: 144, height: 72, z: 2, groupId: null },
    { id: 'shp-payapi', kind: 'api_service', label: 'Payment API', x: 600, y: 168, width: 144, height: 72, z: 3, groupId: null },
    { id: 'shp-vault', kind: 'database', label: 'Card vault', x: 600, y: 360, width: 144, height: 72, z: 4, groupId: null },
    { id: 'shp-settle', kind: 'server', label: 'Settlement batch', x: 840, y: 360, width: 144, height: 72, z: 5, groupId: null },
    { id: 'shp-analytics', kind: 'cloud_service', label: 'Analytics', x: 1224, y: 168, width: 144, height: 72, z: 6, groupId: null },
    { id: 'shp-acquirer', kind: 'third_party', label: 'Acquirer gateway', x: 1224, y: 600, width: 144, height: 72, z: 7, groupId: null },
    { id: 'shp-fraud', kind: 'api_service', label: 'Fraud screening', x: 600, y: 600, width: 144, height: 72, z: 8, groupId: null },
  ],
  connectors: [
    { id: 'con-checkout-pay', label: 'Card data <b>(TLS)</b>', from: { shapeId: 'shp-checkout', port: 'e' }, to: { shapeId: 'shp-payapi', port: 'w' }, points: [[312, 204], [600, 204]] },
    { id: 'con-pay-vault', label: 'Token lookup', from: { shapeId: 'shp-payapi', port: 's' }, to: { shapeId: 'shp-vault', port: 'n' }, points: [[672, 240], [672, 360]] },
    { id: 'con-vault-settle', label: 'Batch records', from: { shapeId: 'shp-vault', port: 'e' }, to: { shapeId: 'shp-settle', port: 'w' }, points: [[744, 396], [840, 396]] },
    { id: 'con-settle-acq', label: 'Settlement file', from: { shapeId: 'shp-settle', port: 'e' }, to: { shapeId: 'shp-acquirer', port: 'n' }, points: [[984, 396], [1080, 396], [1080, 576], [1296, 576], [1296, 600]] },
    { id: 'con-admin-pay', label: 'Admin console', from: { shapeId: 'shp-admin', port: 'e' }, to: { shapeId: 'shp-vault', port: 'w' }, points: [[312, 396], [600, 396]] },
    { id: 'con-pay-analytics', label: 'Order events (no card data)', from: { shapeId: 'shp-payapi', port: 'n' }, to: { shapeId: 'shp-analytics', port: 'n' }, points: [[672, 168], [672, 144], [1296, 144], [1296, 168]] },
    { id: 'con-fraud-settle', label: 'Risk score', from: { shapeId: 'shp-fraud', port: 'e' }, to: { shapeId: 'shp-settle', port: 's' }, points: [[744, 636], [912, 636], [912, 432]] },
  ],
};

const kestrelPage: PageDocument = {
  id: PAGE_KESTREL,
  name: 'Processing scope',
  version: 1,
  zones: [
    { id: 'ks-cde', kind: 'cde', name: 'Cardholder Data Environment', note: '', x: 0, y: 0, width: 480, height: 360 },
  ],
  shapes: [
    { id: 'ks-switch', kind: 'server', label: 'Kestrel switch', x: 96, y: 96, width: 144, height: 72, z: 1, groupId: null },
  ],
  connectors: [],
};

export interface SeedPage {
  doc: PageDocument;
  derived: Derived;
}

export const SEED_PAGES: Record<string, SeedPage> = {
  [PAGE_NETWORK]: { doc: networkPage, derived: derivePage(networkPage) },
  [PAGE_FLOWS]: { doc: flowsPage, derived: derivePage(flowsPage) },
  [PAGE_KESTREL]: { doc: kestrelPage, derived: derivePage(kestrelPage) },
};

export interface SeedShare {
  email: string;
  role: 'editor' | 'viewer';
}

export const SEED_SHARES: Record<string, SeedShare[]> = {
  [DIAGRAM_HARBOR]: [
    { email: 'ravi.sato@harborlane.test', role: 'editor' },
    { email: 'jo.mendes@harborlane.test', role: 'editor' },
    { email: 'lee.varga@northgate-qsa.test', role: 'viewer' },
  ],
};
