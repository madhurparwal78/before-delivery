import type { Role } from '../auth.ts';
import type { Market } from '../../domain/markets.ts';
import type { DropType } from '../../domain/golive.ts';
import type { DropStatus } from '../../domain/dropstate.ts';

export const SEED_PASSWORD = 'Hourline-Seed-2027';

export interface SeedWorkspace {
  key: string;
  name: string;
}

export const WORKSPACES: readonly SeedWorkspace[] = [
  { key: 'maren-vale', name: 'Maren Vale' },
  { key: 'kestrel-row', name: 'Kestrel Row' },
];

export interface SeedMember {
  workspace: string;
  name: string;
  email: string;
  role: Role;
  stockist?: string;
}

export const MEMBERS: readonly SeedMember[] = [
  { workspace: 'maren-vale', name: 'Ida Holm', email: 'ida.holm@marenvale.example', role: 'launch_producer' },
  { workspace: 'maren-vale', name: 'Jonas Berg', email: 'jonas.berg@marenvale.example', role: 'merchandiser' },
  { workspace: 'maren-vale', name: 'Sofie Lund', email: 'sofie.lund@marenvale.example', role: 'finance_lead' },
  { workspace: 'maren-vale', name: 'Amir Haddad', email: 'amir.haddad@marenvale.example', role: 'press_lead' },
  {
    workspace: 'maren-vale',
    name: 'Lea Krogh',
    email: 'lea.krogh@osterroom.example',
    role: 'stockist_buyer',
    stockist: 'oster-room',
  },
  { workspace: 'kestrel-row', name: 'Noor Vik', email: 'noor.vik@kestrelrow.example', role: 'launch_producer' },
  { workspace: 'kestrel-row', name: 'Emil Sand', email: 'emil.sand@kestrelrow.example', role: 'merchandiser' },
  { workspace: 'kestrel-row', name: 'Karin Ström', email: 'karin.strom@kestrelrow.example', role: 'finance_lead' },
  { workspace: 'kestrel-row', name: 'Theo Blom', email: 'theo.blom@kestrelrow.example', role: 'press_lead' },
  {
    workspace: 'kestrel-row',
    name: 'Mikkel Dahl',
    email: 'mikkel.dahl@bryggensupply.example',
    role: 'stockist_buyer',
    stockist: 'bryggen-supply',
  },
];

export interface SeedStockist {
  key: string;
  workspace: string;
  name: string;
  market: Market;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
}

export const STOCKISTS: readonly SeedStockist[] = [
  {
    key: 'atelier-lune',
    workspace: 'maren-vale',
    name: 'Atelier Lune',
    market: 'paris',
    contactName: 'Camille Roux',
    contactEmail: 'camille.roux@atelierlune.example',
    contactPhone: '+33 1 42 00 18 18',
    notes: 'Window display every drop',
  },
  {
    key: 'mori-select',
    workspace: 'maren-vale',
    name: 'Mori Select',
    market: 'tokyo',
    contactName: 'Yui Mori',
    contactEmail: 'yui.mori@moriselect.example',
    contactPhone: '+81 3 5555 0142',
    notes: 'Ships via Osaka hub',
  },
  {
    key: 'zinc-goods',
    workspace: 'maren-vale',
    name: 'Zinc Goods',
    market: 'london',
    contactName: 'Tom Hale',
    contactEmail: 'tom.hale@zincgoods.example',
    contactPhone: '+44 20 7946 0321',
    notes: 'Pays on 30 days',
  },
  {
    key: 'aero-supply',
    workspace: 'maren-vale',
    name: 'Ærø Supply',
    market: 'stockholm',
    contactName: 'Nils Ek',
    contactEmail: 'nils.ek@aerosupply.example',
    contactPhone: '+46 8 555 012 34',
    notes: 'Prefers knitwear',
  },
  {
    key: 'oster-room',
    workspace: 'maren-vale',
    name: 'Øster Room',
    market: 'copenhagen',
    contactName: 'Lea Krogh',
    contactEmail: 'lea.krogh@osterroom.example',
    contactPhone: '+45 33 12 45 67',
    notes: 'Flagship partner',
  },
  {
    key: 'aaby-hus',
    workspace: 'maren-vale',
    name: 'Aaby Hus',
    market: 'new_york',
    contactName: 'Dana Price',
    contactEmail: 'dana.price@aabyhus.example',
    contactPhone: '+1 212 555 0187',
    notes: 'Pays on delivery',
  },
  {
    key: 'bryggen-supply',
    workspace: 'kestrel-row',
    name: 'Bryggen Supply',
    market: 'copenhagen',
    contactName: 'Mikkel Dahl',
    contactEmail: 'mikkel.dahl@bryggensupply.example',
    contactPhone: '+45 32 55 10 20',
    notes: 'Harbour store',
  },
  {
    key: 'fjell-room',
    workspace: 'kestrel-row',
    name: 'Fjell Room',
    market: 'stockholm',
    contactName: 'Buyer',
    contactEmail: 'buyer@fjellroom.example',
    contactPhone: '+46 8 555 044 11',
    notes: '',
  },
  {
    key: 'maison-gris',
    workspace: 'kestrel-row',
    name: 'Maison Gris',
    market: 'paris',
    contactName: 'Buyer',
    contactEmail: 'buyer@maisongris.example',
    contactPhone: '+33 1 42 00 55 20',
    notes: '',
  },
  {
    key: 'thames-pine',
    workspace: 'kestrel-row',
    name: 'Thames & Pine',
    market: 'london',
    contactName: 'Buyer',
    contactEmail: 'buyer@thamespine.example',
    contactPhone: '+44 20 7946 0455',
    notes: '',
  },
  {
    key: 'hudson-loft',
    workspace: 'kestrel-row',
    name: 'Hudson Loft',
    market: 'new_york',
    contactName: 'Buyer',
    contactEmail: 'buyer@hudsonloft.example',
    contactPhone: '+1 212 555 0244',
    notes: '',
  },
  {
    key: 'kaze-store',
    workspace: 'kestrel-row',
    name: 'Kaze Store',
    market: 'tokyo',
    contactName: 'Buyer',
    contactEmail: 'buyer@kazestore.example',
    contactPhone: '+81 3 5555 0288',
    notes: '',
  },
];

export interface SeedStyle {
  styleNumber: string;
  name: string;
  colour: string;
  wholesaleEdition: number;
  rrpDkkMinor: number;
}

export interface SeedLook {
  title: string;
  altText: string;
}

export interface SeedDrop {
  key: string;
  workspace: string;
  name: string;
  slug: string;
  type: DropType;
  goLiveAt: string | null;
  localGoLive: string | null;
  status: DropStatus;
  storePieces: number;
  holdSeconds: number;
  palette: [string, string, string];
  internalNote: string;
  styles: readonly SeedStyle[];
  looks: readonly SeedLook[];
  /** Seeded claims as `[market, count]` pairs. */
  claims: readonly (readonly [Market, number])[];
}

export const DROPS: readonly SeedDrop[] = [
  {
    key: 'harbour-wool-edit',
    workspace: 'maren-vale',
    name: 'Harbour Wool Edit',
    slug: 'harbour-wool-edit',
    type: 'simultaneous',
    goLiveAt: '2027-03-18T09:00:00Z',
    localGoLive: null,
    status: 'scheduled',
    storePieces: 50,
    holdSeconds: 900,
    palette: ['ink', 'vermilion', 'sand'],
    internalNote: 'Hold five coats for the flagship window.',
    styles: [
      { styleNumber: 'MV-2701', name: 'Harbour wool coat', colour: 'Ink', wholesaleEdition: 120, rrpDkkMinor: 279900 },
      { styleNumber: 'MV-2702', name: 'Harbour knit', colour: 'Sand', wholesaleEdition: 80, rrpDkkMinor: 149950 },
      { styleNumber: 'MV-2703', name: 'Dock trouser', colour: 'Fog', wholesaleEdition: 60, rrpDkkMinor: 109900 },
    ],
    looks: [
      { title: 'Harbour wool coat, open', altText: 'A long wool coat in ink, shown open over a sand knit.' },
      { title: 'Harbour knit, close', altText: 'A sand-coloured knit photographed close, showing its rib.' },
      { title: 'Dock trouser, full length', altText: 'A wide fog-grey trouser falling to the ankle.' },
    ],
    claims: [],
  },
  {
    key: 'new-year-studio',
    workspace: 'maren-vale',
    name: 'New Year Studio',
    slug: 'new-year-studio',
    type: 'rolling',
    goLiveAt: null,
    localGoLive: '2027-01-01T12:00',
    status: 'scheduled',
    storePieces: 20,
    holdSeconds: 600,
    palette: ['stone', 'ink', 'vermilion'],
    internalNote: 'Studio reopens on the second.',
    styles: [
      { styleNumber: 'MV-2750', name: 'Studio overshirt', colour: 'Ink', wholesaleEdition: 70, rrpDkkMinor: 159900 },
    ],
    looks: [
      { title: 'Studio overshirt, front', altText: 'An ink overshirt buttoned to the collar.' },
      { title: 'Studio overshirt, sleeve', altText: 'The cuff of an ink overshirt, turned back once.' },
    ],
    claims: [],
  },
  {
    key: 'night-ferry-knits',
    workspace: 'maren-vale',
    name: 'Night Ferry Knits',
    slug: 'night-ferry-knits',
    type: 'rolling',
    goLiveAt: null,
    localGoLive: '2026-10-01T10:00',
    status: 'live',
    storePieces: 20,
    holdSeconds: 900,
    palette: ['night', 'rust', 'fog'],
    internalNote: 'Ferry crossing shoot, second cabin.',
    styles: [
      { styleNumber: 'MV-2610', name: 'Night ferry cardigan', colour: 'Night', wholesaleEdition: 60, rrpDkkMinor: 189900 },
      { styleNumber: 'MV-2611', name: 'Ferry beanie', colour: 'Rust', wholesaleEdition: 100, rrpDkkMinor: 39900 },
    ],
    looks: [
      { title: 'Night ferry cardigan', altText: 'A deep blue-black cardigan with a shawl collar.' },
      { title: 'Ferry beanie', altText: 'A ribbed beanie in burnt orange-brown.' },
    ],
    claims: [['copenhagen', 5]],
  },
  {
    key: 'salt-linen',
    workspace: 'maren-vale',
    name: 'Salt Linen',
    slug: 'salt-linen',
    type: 'simultaneous',
    goLiveAt: '2026-06-04T08:00:00Z',
    localGoLive: null,
    status: 'sold_out',
    storePieces: 10,
    holdSeconds: 900,
    palette: ['fog', 'stone', 'moss'],
    internalNote: 'Sold through in eleven minutes.',
    styles: [
      { styleNumber: 'MV-2605', name: 'Salt linen shirt', colour: 'Fog', wholesaleEdition: 80, rrpDkkMinor: 99900 },
    ],
    looks: [
      { title: 'Salt linen shirt, front', altText: 'A loose linen shirt in fog grey.' },
      { title: 'Salt linen shirt, back', altText: 'The back yoke of a fog-grey linen shirt.' },
    ],
    claims: [
      ['copenhagen', 10],
      ['stockholm', 10],
      ['paris', 10],
      ['london', 10],
      ['new_york', 10],
      ['tokyo', 10],
    ],
  },
  {
    key: 'lantern-ceramics',
    workspace: 'maren-vale',
    name: 'Lantern Ceramics',
    slug: 'lantern-ceramics',
    type: 'simultaneous',
    goLiveAt: '2026-12-03T09:00:00Z',
    localGoLive: null,
    status: 'withdrawn',
    storePieces: 30,
    holdSeconds: 900,
    palette: ['sand', 'rust', 'ink'],
    internalNote: 'Kiln delay at the supplier.',
    styles: [
      { styleNumber: 'MV-2620', name: 'Lantern cup', colour: 'Sand', wholesaleEdition: 200, rrpDkkMinor: 24900 },
    ],
    looks: [{ title: 'Lantern cup', altText: 'A sand-glazed cup with a narrow foot.' }],
    claims: [],
  },
  {
    key: 'midwinter-draft',
    workspace: 'maren-vale',
    name: 'Midwinter Draft',
    slug: 'midwinter-draft',
    type: 'simultaneous',
    goLiveAt: null,
    localGoLive: null,
    status: 'draft',
    storePieces: 0,
    holdSeconds: 900,
    palette: ['vermilion', 'stone', 'ink'],
    internalNote: 'Waiting on the yarn mill.',
    styles: [
      { styleNumber: 'MV-2740', name: 'Midwinter scarf', colour: 'Vermilion', wholesaleEdition: 90, rrpDkkMinor: 59900 },
    ],
    looks: [{ title: 'Midwinter scarf', altText: 'A long scarf in deep warm red.' }],
    claims: [],
  },
  {
    key: 'field-jacket-01',
    workspace: 'kestrel-row',
    name: 'Field Jacket 01',
    slug: 'field-jacket-01',
    type: 'simultaneous',
    goLiveAt: '2027-02-11T10:00:00Z',
    localGoLive: null,
    status: 'scheduled',
    storePieces: 25,
    holdSeconds: 900,
    palette: ['moss', 'sand', 'ink'],
    internalNote: 'First Kestrel Row drop of the year.',
    styles: [
      { styleNumber: 'KR-1101', name: 'Field jacket', colour: 'Moss', wholesaleEdition: 100, rrpDkkMinor: 249900 },
    ],
    looks: [
      { title: 'Field jacket, front', altText: 'A dark olive field jacket with four pockets.' },
      { title: 'Field jacket, collar', altText: 'The stand collar of a dark olive field jacket.' },
    ],
    claims: [],
  },
  {
    key: 'kestrel-studio-draft',
    workspace: 'kestrel-row',
    name: 'Kestrel Studio Draft',
    slug: 'kestrel-studio-draft',
    type: 'simultaneous',
    goLiveAt: null,
    localGoLive: null,
    status: 'draft',
    storePieces: 0,
    holdSeconds: 900,
    palette: ['sand', 'fog', 'ink'],
    internalNote: 'Sandal sampling.',
    styles: [
      { styleNumber: 'KR-1150', name: 'Rope sandal', colour: 'Sand', wholesaleEdition: 80, rrpDkkMinor: 89900 },
    ],
    looks: [{ title: 'Rope sandal', altText: 'A flat sandal with light tan rope straps.' }],
    claims: [],
  },
];

export const HARBOUR_STORY_HTML = [
  '<h2>Knitted beside the harbour</h2>',
  '<p>The Harbour Wool Edit began on a grey morning at the quay, where the mills still send their wool out by boat. Ten pieces, cut from one run of long-staple lambswool, carry the weight of a working coat and the ease of a studio layer.</p>',
  '<p>Each piece is finished by hand in Copenhagen. The coat takes a full day to press; the knit is washed twice so it softens before it ever reaches a shoulder. We release the edit in six cities at one shared instant.</p>',
].join('');

export interface SeedWaitlistMember {
  market: Market;
  name: string;
  email: string;
}

export const HARBOUR_WAITLIST: readonly SeedWaitlistMember[] = [
  { market: 'copenhagen', name: 'Freja Dahl', email: 'freja.dahl@example.com' },
  { market: 'copenhagen', name: 'Oskar Lind', email: 'oskar.lind@example.com' },
  { market: 'copenhagen', name: 'Maja Holt', email: 'maja.holt@example.com' },
  { market: 'tokyo', name: 'Hana Mori', email: 'hana.mori@example.com' },
  { market: 'tokyo', name: 'Ren Sato', email: 'ren.sato@example.com' },
];

export interface SeedRequest {
  stockist: string;
  lines: readonly (readonly [string, number])[];
}

export const HARBOUR_REQUESTS: readonly SeedRequest[] = [
  { stockist: 'oster-room', lines: [['MV-2701', 40], ['MV-2702', 30]] },
  { stockist: 'atelier-lune', lines: [['MV-2701', 50], ['MV-2702', 20]] },
  { stockist: 'mori-select', lines: [['MV-2701', 70], ['MV-2702', 40]] },
];

export interface SeedPriceList {
  key: string;
  workspace: string;
  name: string;
  effectiveDate: string;
  prices: readonly (readonly [string, string, number])[];
}

export const PRICE_LISTS: readonly SeedPriceList[] = [
  {
    key: 'mv-spring-2026',
    workspace: 'maren-vale',
    name: 'Spring 2026',
    effectiveDate: '2026-01-01',
    prices: [
      ['MV-2701', 'DKK', 119900],
      ['MV-2701', 'JPY', 25900],
    ],
  },
  {
    key: 'mv-autumn-2026',
    workspace: 'maren-vale',
    name: 'Autumn 2026',
    effectiveDate: '2026-08-01',
    prices: [
      ['MV-2701', 'DKK', 123450],
      ['MV-2701', 'SEK', 182000],
      ['MV-2701', 'EUR', 16550],
      ['MV-2701', 'GBP', 14200],
      ['MV-2701', 'USD', 17900],
      ['MV-2701', 'JPY', 26800],
      ['MV-2702', 'DKK', 64900],
      ['MV-2702', 'SEK', 95000],
      ['MV-2702', 'EUR', 8700],
      ['MV-2702', 'GBP', 7500],
      ['MV-2702', 'USD', 9400],
      ['MV-2702', 'JPY', 14100],
      ['MV-2703', 'DKK', 49950],
      ['MV-2703', 'SEK', 73000],
      ['MV-2703', 'EUR', 6700],
      ['MV-2703', 'GBP', 5800],
      ['MV-2703', 'USD', 7200],
      ['MV-2703', 'JPY', 10850],
      ['MV-2610', 'DKK', 84900],
      ['MV-2610', 'JPY', 18200],
      ['MV-2605', 'DKK', 44900],
    ],
  },
  {
    key: 'mv-spring-2027',
    workspace: 'maren-vale',
    name: 'Spring 2027',
    effectiveDate: '2027-02-01',
    prices: [
      ['MV-2701', 'DKK', 135795],
      ['MV-2701', 'JPY', 29480],
      ['MV-2702', 'DKK', 71390],
    ],
  },
  {
    key: 'kr-autumn-2026',
    workspace: 'kestrel-row',
    name: 'Autumn 2026',
    effectiveDate: '2026-08-01',
    prices: [
      ['KR-1101', 'DKK', 112450],
      ['KR-1101', 'SEK', 165000],
      ['KR-1101', 'EUR', 15100],
      ['KR-1101', 'GBP', 12900],
      ['KR-1101', 'USD', 16300],
      ['KR-1101', 'JPY', 24500],
    ],
  },
];
