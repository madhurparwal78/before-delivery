import bcrypt from 'bcryptjs';
import type { Db } from './db.js';
import { MARKETS, ZONES, type Role } from '../domain/markets.js';
import { resolveGoLive, parseInstant, toInstantString, isoWeekOf, cphDateOf } from '../domain/dates.js';
import { id } from './startup.js';

export interface SeedLook { title: string; altText: string; palette: string[]; shape: number; }

interface SeedDrop {
  workspace: string;
  brand: string;
  name: string;
  slug: string;
  type: 'simultaneous' | 'rolling';
  status: 'draft' | 'scheduled' | 'live' | 'sold_out' | 'withdrawn';
  goLiveAt?: string;
  localGoLive?: string;
  pieces: number;
  cphClaims?: number;
  allClaimed?: boolean;
  holdSeconds: number;
  palette: string[];
  internalNote?: string;
  styles: { number: string; name: string; colour: string; edition: number; rrp: number }[];
  looks: SeedLook[];
  story?: string;
  waitlist?: { market: string; members: [string, string][] };
  restock?: { first: string; pieces: Record<string, number> };
}

const HARBOUR_STORY = `<h2>Knitted on the harbour</h2><p>Every piece in this edit was cut and finished within sight of the winter ferries. The wool comes from a single mill on the north coast, dyed in small batches, and the coats are lined with a brushed cotton that softens after a week of wear.</p><p>We are releasing the full edit in every market at once, on Copenhagen time. Pieces are held for fifteen minutes at go-live, then offered to the waitlist in join order.</p>`;

const SEED_DROPS: SeedDrop[] = [
  {
    workspace: 'Maren Vale', brand: 'Maren Vale', name: 'Harbour Wool Edit', slug: 'harbour-wool-edit',
    type: 'simultaneous', status: 'scheduled', goLiveAt: '2027-03-18T09:00:00Z', pieces: 50, holdSeconds: 900,
    palette: ['ink', 'vermilion', 'sand'], internalNote: 'Hold five coats for the flagship window.',
    styles: [
      { number: 'MV-2701', name: 'Harbour wool coat', colour: 'Ink', edition: 120, rrp: 279900 },
      { number: 'MV-2702', name: 'Harbour knit', colour: 'Sand', edition: 80, rrp: 149950 },
      { number: 'MV-2703', name: 'Dock trouser', colour: 'Fog', edition: 60, rrp: 109900 }
    ],
    looks: [
      { title: 'Harbour coat, ink', altText: 'A long ink-blue wool coat drawn with simple shapes.', palette: ['ink', 'fog', 'stone'], shape: 1 },
      { title: 'Harbour knit, sand', altText: 'A sand-coloured knit sweater drawn with simple shapes.', palette: ['sand', 'vermilion', 'stone'], shape: 2 },
      { title: 'Dock trouser, fog', altText: 'Fog-grey wide trousers drawn with simple shapes.', palette: ['fog', 'ink', 'stone'], shape: 3 }
    ],
    story: HARBOUR_STORY,
    waitlist: {
      market: 'copenhagen',
      members: [['Freja Dahl', 'freja.dahl@example.com'], ['Oskar Lind', 'oskar.lind@example.com'], ['Maja Holt', 'maja.holt@example.com']]
    }
  },
  {
    workspace: 'Maren Vale', brand: 'Maren Vale', name: 'New Year Studio', slug: 'new-year-studio',
    type: 'rolling', status: 'scheduled', localGoLive: '2027-01-01T12:00', pieces: 20, holdSeconds: 600,
    palette: ['night', 'stone', 'vermilion'],
    styles: [{ number: 'MV-2750', name: 'Studio overshirt', colour: 'Ink', edition: 70, rrp: 159900 }],
    looks: [
      { title: 'Studio overshirt', altText: 'An ink overshirt drawn with simple shapes.', palette: ['night', 'stone', 'vermilion'], shape: 4 },
      { title: 'Studio table', altText: 'A studio table with folded fabric drawn with simple shapes.', palette: ['stone', 'sand', 'ink'], shape: 5 }
    ],
    waitlist: { market: 'tokyo', members: [['Hana Mori', 'hana.mori@example.com'], ['Ren Sato', 'ren.sato@example.com']] }
  },
  {
    workspace: 'Maren Vale', brand: 'Maren Vale', name: 'Night Ferry Knits', slug: 'night-ferry-knits',
    type: 'rolling', status: 'live', localGoLive: '2026-10-01T10:00', pieces: 20, cphClaims: 5, holdSeconds: 900,
    palette: ['night', 'rust', 'stone'],
    styles: [
      { number: 'MV-2610', name: 'Night ferry cardigan', colour: 'Night', edition: 60, rrp: 189900 },
      { number: 'MV-2611', name: 'Ferry beanie', colour: 'Rust', edition: 100, rrp: 39900 }
    ],
    looks: [
      { title: 'Night ferry cardigan', altText: 'A deep night-blue cardigan drawn with simple shapes.', palette: ['night', 'rust', 'stone'], shape: 6 },
      { title: 'Ferry beanie', altText: 'A rust-orange beanie drawn with simple shapes.', palette: ['rust', 'sand', 'stone'], shape: 7 }
    ],
    story: '<p>Knitted for the last ferry home. The cardigan is heavy, the beanie is light, and both dry fast.</p>'
  },
  {
    workspace: 'Maren Vale', brand: 'Maren Vale', name: 'Salt Linen', slug: 'salt-linen',
    type: 'simultaneous', status: 'sold_out', goLiveAt: '2026-06-04T08:00:00Z', pieces: 10, allClaimed: true, holdSeconds: 900,
    palette: ['stone', 'fog', 'sand'],
    styles: [{ number: 'MV-2605', name: 'Salt linen shirt', colour: 'Fog', edition: 80, rrp: 99900 }],
    looks: [
      { title: 'Salt linen shirt', altText: 'A fog-grey linen shirt drawn with simple shapes.', palette: ['stone', 'fog', 'sand'], shape: 8 },
      { title: 'Salt marsh', altText: 'A salt marsh in pale tones drawn with simple shapes.', palette: ['sand', 'stone', 'fog'], shape: 9 }
    ]
  },
  {
    workspace: 'Maren Vale', brand: 'Maren Vale', name: 'Lantern Ceramics', slug: 'lantern-ceramics',
    type: 'simultaneous', status: 'withdrawn', goLiveAt: '2026-12-03T09:00:00Z', pieces: 30, holdSeconds: 900,
    palette: ['sand', 'ink', 'vermilion'],
    styles: [{ number: 'MV-2620', name: 'Lantern cup', colour: 'Sand', edition: 200, rrp: 24900 }],
    looks: [{ title: 'Lantern cup', altText: 'A sand-coloured ceramic cup drawn with simple shapes.', palette: ['sand', 'vermilion', 'ink'], shape: 10 }]
  },
  {
    workspace: 'Maren Vale', brand: 'Maren Vale', name: 'Midwinter Draft', slug: 'midwinter-draft',
    type: 'simultaneous', status: 'draft', pieces: 0, holdSeconds: 900,
    palette: ['vermilion', 'night', 'stone'],
    styles: [{ number: 'MV-2740', name: 'Midwinter scarf', colour: 'Vermilion', edition: 90, rrp: 59900 }],
    looks: [{ title: 'Midwinter scarf', altText: 'A vermilion scarf drawn with simple shapes.', palette: ['vermilion', 'night', 'stone'], shape: 11 }]
  },
  {
    workspace: 'Kestrel Row', brand: 'Kestrel Row', name: 'Field Jacket 01', slug: 'field-jacket-01',
    type: 'simultaneous', status: 'scheduled', goLiveAt: '2027-02-11T10:00:00Z', pieces: 25, holdSeconds: 900,
    palette: ['moss', 'stone', 'ink'],
    styles: [{ number: 'KR-1101', name: 'Field jacket', colour: 'Moss', edition: 100, rrp: 249900 }],
    looks: [
      { title: 'Field jacket, moss', altText: 'A moss-green field jacket drawn with simple shapes.', palette: ['moss', 'stone', 'ink'], shape: 12 },
      { title: 'Field jacket, worn', altText: 'A figure wearing a moss-green jacket drawn with simple shapes.', palette: ['moss', 'sand', 'night'], shape: 13 }
    ]
  },
  {
    workspace: 'Kestrel Row', brand: 'Kestrel Row', name: 'Kestrel Studio Draft', slug: 'kestrel-studio-draft',
    type: 'simultaneous', status: 'draft', pieces: 0, holdSeconds: 900,
    palette: ['sand', 'moss', 'stone'],
    styles: [{ number: 'KR-1150', name: 'Rope sandal', colour: 'Sand', edition: 80, rrp: 89900 }],
    looks: [{ title: 'Rope sandal', altText: 'A sand-coloured sandal drawn with simple shapes.', palette: ['sand', 'moss', 'stone'], shape: 14 }]
  }
];

interface SeedStockist {
  name: string; market: string; contactName?: string; contactEmail?: string; contactPhone?: string; notes?: string;
}

const SEED_STOCKISTS: Record<string, SeedStockist[]> = {
  'Maren Vale': [
    { name: 'Atelier Lune', market: 'paris', contactName: 'Camille Roux', contactEmail: 'camille.roux@atelierlune.example', contactPhone: '+33 1 42 00 18 18', notes: 'Window display every drop' },
    { name: 'Mori Select', market: 'tokyo', contactName: 'Yui Mori', contactEmail: 'yui.mori@moriselect.example', contactPhone: '+81 3 5555 0142', notes: 'Ships via Osaka hub' },
    { name: 'Zinc Goods', market: 'london', contactName: 'Tom Hale', contactEmail: 'tom.hale@zincgoods.example', contactPhone: '+44 20 7946 0321', notes: 'Pays on 30 days' },
    { name: 'Ærø Supply', market: 'stockholm', contactName: 'Nils Ek', contactEmail: 'nils.ek@aerosupply.example', contactPhone: '+46 8 555 012 34', notes: 'Prefers knitwear' },
    { name: 'Øster Room', market: 'copenhagen', contactName: 'Lea Krogh', contactEmail: 'lea.krogh@osterroom.example', contactPhone: '+45 33 12 45 67', notes: 'Flagship partner' },
    { name: 'Aaby Hus', market: 'new_york', contactName: 'Dana Price', contactEmail: 'dana.price@aabyhus.example', contactPhone: '+1 212 555 0187', notes: 'Pays on delivery' }
  ],
  'Kestrel Row': [
    { name: 'Bryggen Supply', market: 'copenhagen', contactName: 'Mikkel Dahl', contactEmail: 'mikkel.dahl@bryggensupply.example' },
    { name: 'Fjell Room', market: 'stockholm', contactName: 'Buyer', contactEmail: 'buyer@fjellroom.example' },
    { name: 'Maison Gris', market: 'paris', contactName: 'Buyer', contactEmail: 'buyer@maisingris.example' },
    { name: 'Thames & Pine', market: 'london', contactName: 'Buyer', contactEmail: 'buyer@thamespine.example' },
    { name: 'Hudson Loft', market: 'new_york', contactName: 'Buyer', contactEmail: 'buyer@hudsonloft.example' },
    { name: 'Kaze Store', market: 'tokyo', contactName: 'Buyer', contactEmail: 'buyer@kazestore.example' }
  ]
};

const SEED_MEMBERS: { workspace: string; name: string; email: string; role: Role; stockistName?: string }[] = [
  { workspace: 'Maren Vale', name: 'Ida Holm', email: 'ida.holm@marenvale.example', role: 'launch_producer' },
  { workspace: 'Maren Vale', name: 'Jonas Berg', email: 'jonas.berg@marenvale.example', role: 'merchandiser' },
  { workspace: 'Maren Vale', name: 'Sofie Lund', email: 'sofie.lund@marenvale.example', role: 'finance_lead' },
  { workspace: 'Maren Vale', name: 'Amir Haddad', email: 'amir.haddad@marenvale.example', role: 'press_lead' },
  { workspace: 'Maren Vale', name: 'Lea Krogh', email: 'lea.krogh@osterroom.example', role: 'stockist_buyer', stockistName: 'Øster Room' },
  { workspace: 'Kestrel Row', name: 'Noor Vik', email: 'noor.vik@kestrelrow.example', role: 'launch_producer' },
  { workspace: 'Kestrel Row', name: 'Emil Sand', email: 'emil.sand@kestrelrow.example', role: 'merchandiser' },
  { workspace: 'Kestrel Row', name: 'Karin Ström', email: 'karin.strom@kestrelrow.example', role: 'finance_lead' },
  { workspace: 'Kestrel Row', name: 'Theo Blom', email: 'theo.blom@kestrelrow.example', role: 'press_lead' },
  { workspace: 'Kestrel Row', name: 'Mikkel Dahl', email: 'mikkel.dahl@bryggensupply.example', role: 'stockist_buyer', stockistName: 'Bryggen Supply' }
];

const SEED_PRICE_LISTS: { workspace: string; name: string; effectiveDate: string; prices: [string, string, number][] }[] = [
  { workspace: 'Maren Vale', name: 'Spring 2026', effectiveDate: '2026-01-01', prices: [['MV-2701', 'DKK', 119900], ['MV-2701', 'JPY', 25900]] },
  {
    workspace: 'Maren Vale', name: 'Autumn 2026', effectiveDate: '2026-08-01',
    prices: [
      ['MV-2701', 'DKK', 123450], ['MV-2701', 'SEK', 182000], ['MV-2701', 'EUR', 16550], ['MV-2701', 'GBP', 14200], ['MV-2701', 'USD', 17900], ['MV-2701', 'JPY', 26800],
      ['MV-2702', 'DKK', 64900], ['MV-2702', 'SEK', 95000], ['MV-2702', 'EUR', 8700], ['MV-2702', 'GBP', 7500], ['MV-2702', 'USD', 9400], ['MV-2702', 'JPY', 14100],
      ['MV-2703', 'DKK', 49950], ['MV-2703', 'SEK', 73000], ['MV-2703', 'EUR', 6700], ['MV-2703', 'GBP', 5800], ['MV-2703', 'USD', 7200], ['MV-2703', 'JPY', 10850],
      ['MV-2610', 'DKK', 84900], ['MV-2610', 'JPY', 18200],
      ['MV-2605', 'DKK', 44900]
    ]
  },
  { workspace: 'Maren Vale', name: 'Spring 2027', effectiveDate: '2027-02-01', prices: [['MV-2701', 'DKK', 135795], ['MV-2701', 'JPY', 29480], ['MV-2702', 'DKK', 71390]] },
  {
    workspace: 'Kestrel Row', name: 'Autumn 2026', effectiveDate: '2026-08-01',
    prices: [['KR-1101', 'DKK', 112450], ['KR-1101', 'SEK', 165000], ['KR-1101', 'EUR', 15100], ['KR-1101', 'GBP', 12900], ['KR-1101', 'USD', 16300], ['KR-1101', 'JPY', 24500]]
  }
];

const HARBOUR_REQUESTS: { stockist: string; lines: [string, number][]; offsetSeconds: number }[] = [
  { stockist: 'Øster Room', lines: [['MV-2701', 40], ['MV-2702', 30]], offsetSeconds: 3600 },
  { stockist: 'Atelier Lune', lines: [['MV-2701', 50], ['MV-2702', 20]], offsetSeconds: 2400 },
  { stockist: 'Mori Select', lines: [['MV-2701', 70], ['MV-2702', 40]], offsetSeconds: 1200 }
];

export async function seed(db: Db): Promise<void> {
  const passwordHash = await bcrypt.hash('Hourline-Seed-2027', 10);
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(902200)');
    const wsIds = new Map<string, string>();
    for (const name of ['Maren Vale', 'Kestrel Row']) {
      const existing = await db.query('SELECT id FROM workspaces WHERE name = $1', [name]);
      if (existing.rowCount && existing.rowCount > 0) { wsIds.set(name, existing.rows[0].id); continue; }
      const wid = id('ws');
      await db.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [wid, name]);
      wsIds.set(name, wid);
    }

    const stockistIds = new Map<string, string>();
    for (const [ws, list] of Object.entries(SEED_STOCKISTS)) {
      const wid = wsIds.get(ws)!;
      for (const s of list) {
        const existing = await db.query('SELECT id, name FROM stockists WHERE workspace_id = $1 AND lower(name) = lower($2)', [wid, s.name]);
        if (existing.rowCount && existing.rowCount > 0) { stockistIds.set(`${ws}|${s.name}`, existing.rows[0].id); continue; }
        const sid = id('stk');
        const currency = MARKETS.find(m => m.market === s.market)!.currency;
        await db.query(
          'INSERT INTO stockists (id, workspace_id, name, market, currency, contact_name, contact_email, contact_phone, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [sid, wid, s.name, s.market, currency, s.contactName ?? null, s.contactEmail ?? null, s.contactPhone ?? null, s.notes ?? '']
        );
        stockistIds.set(`${ws}|${s.name}`, sid);
      }
    }

    const memberIds = new Map<string, string>();
    for (const m of SEED_MEMBERS) {
      const wid = wsIds.get(m.workspace)!;
      const existing = await db.query('SELECT id FROM members WHERE workspace_id = $1 AND lower(email) = lower($2)', [wid, m.email]);
      if (existing.rowCount && existing.rowCount > 0) { memberIds.set(m.email, existing.rows[0].id); continue; }
      const mid = id('mem');
      await db.query(
        'INSERT INTO members (id, workspace_id, name, email, password_hash, role, stockist_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [mid, wid, m.name, m.email, passwordHash, m.role, m.stockistName ? stockistIds.get(`${m.workspace}|${m.stockistName}`) ?? null : null]
      );
      memberIds.set(m.email, mid);
    }

    for (const pl of SEED_PRICE_LISTS) {
      const wid = wsIds.get(pl.workspace)!;
      const existing = await db.query('SELECT id FROM price_lists WHERE workspace_id = $1 AND name = $2', [wid, pl.name]);
      let plid: string;
      if (existing.rowCount && existing.rowCount > 0) { plid = existing.rows[0].id; } else {
        plid = id('pl');
        await db.query('INSERT INTO price_lists (id, workspace_id, name, effective_date) VALUES ($1,$2,$3,$4)', [plid, wid, pl.name, pl.effectiveDate]);
      }
      for (const [styleNumber, currency, unit] of pl.prices) {
        await db.query(
          'INSERT INTO prices (price_list_id, style_number, currency, unit_price_minor) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [plid, styleNumber, currency, unit]
        );
      }
    }

    const dropIds = new Map<string, string>();
    for (const d of SEED_DROPS) {
      const wid = wsIds.get(d.workspace)!;
      const existing = await db.query('SELECT id FROM drops WHERE workspace_id = $1 AND slug = $2', [wid, d.slug]);
      if (existing.rowCount && existing.rowCount > 0) { dropIds.set(d.slug, existing.rows[0].id); continue; }
      const did = id('drop');
      const resolved = d.goLiveAt || d.localGoLive
        ? resolveGoLive({ type: d.type, goLiveAt: d.goLiveAt, localGoLive: d.localGoLive }, ZONES)
        : null;
      const marketInstants = resolved && !('date' in (resolved as object)) ? (resolved as { market: string; goLiveAt: Date }[]) : null;
      const earliest = marketInstants ? new Date(Math.min(...marketInstants.map(m => m.goLiveAt.getTime()))) : null;
      const createdAt = d.status === 'scheduled' || d.status === 'live' || d.status === 'sold_out' || d.status === 'withdrawn'
        ? (d.goLiveAt ? new Date(new Date(d.goLiveAt).getTime() - 90 * 86400 * 1000) : new Date(Date.now() - 90 * 86400 * 1000))
        : new Date();
      const withdrawnAt = d.status === 'withdrawn' ? new Date(Date.now() - 5 * 86400 * 1000) : null;
      await db.query(
        `INSERT INTO drops (id, workspace_id, slug, name, brand, type, status, hold_seconds, palette, internal_note,
          go_live_at, earliest_go_live_at, copenhagen_go_live, local_go_live, created_at, withdrawn_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [did, wid, d.slug, d.name, d.brand, d.type, d.status, d.holdSeconds, JSON.stringify(d.palette), d.internalNote ?? '',
          earliest, earliest, d.goLiveAt ? d.goLiveAt.slice(0, 16) : null, d.localGoLive ?? null, createdAt, withdrawnAt]
      );
      dropIds.set(d.slug, did);
      for (const info of ZONES) {
        const gl = marketInstants?.find(m => m.market === info.market)?.goLiveAt ?? null;
        await db.query('INSERT INTO drop_markets (drop_id, market, go_live_at, store_pieces) VALUES ($1,$2,$3,$4)', [did, info.market, gl, d.pieces]);
      }
      let pos = 0;
      for (const st of d.styles) {
        pos += 1;
        await db.query(
          'INSERT INTO styles (id, drop_id, style_number, name, colour, wholesale_edition, rrp_dkk_minor, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [id('sty'), did, st.number, st.name, st.colour, st.edition, st.rrp, pos]
        );
      }
      pos = 0;
      for (const look of d.looks) {
        pos += 1;
        await db.query(
          'INSERT INTO looks (id, drop_id, position, title, alt_text, width, height, content_type, size_bytes, ext, order_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [id('look'), did, pos, look.title, look.altText, 800, 1000, 'image/png', 0, 'png', 1]
        );
      }
      if (d.story) {
        await db.query(
          'INSERT INTO stories (drop_id, html, version, published_html, published_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (drop_id) DO NOTHING',
          [did, d.story, 1, d.status === 'scheduled' || d.status === 'live' || d.status === 'sold_out' ? d.story : null, d.story ? createdAt : null]
        );
      } else {
        await db.query('INSERT INTO stories (drop_id) VALUES ($1) ON CONFLICT (drop_id) DO NOTHING', [did]);
      }
      // Claims
      let claimed = 0;
      if (d.allClaimed) {
        for (const info of ZONES) {
          for (let i = 0; i < d.pieces; i++) {
            await addClaim(db, did, info.market, i, d.slug);
            claimed += 1;
          }
        }
      } else if (d.cphClaims) {
        for (let i = 0; i < d.cphClaims; i++) {
          await addClaim(db, did, 'copenhagen', i, d.slug);
          claimed += 1;
        }
      }
      void claimed;
      // Waitlist
      if (d.waitlist) {
        const members = d.waitlist.members;
        let position = 0;
        for (const [name, email] of members) {
          position += 1;
          await db.query(
            'INSERT INTO waitlist (id, drop_id, market, name, email, status, position, joined_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
            [id('wl'), did, d.waitlist.market, name, email, 'confirmed', position, new Date(Date.now() - (members.length - position) * 60000)]
          );
        }
      }
    }

    // Harbour requests
    const harbourId = dropIds.get('harbour-wool-edit')!;
    const jonasId = memberIds.get('jonas.berg@marenvale.example')!;
    let n = 0;
    for (const req of HARBOUR_REQUESTS) {
      n += 1;
      const sid = stockistIds.get(`Maren Vale|${req.stockist}`)!;
      const existing = await db.query('SELECT id FROM allocations WHERE drop_id = $1 AND stockist_id = $2', [harbourId, sid]);
      if (existing.rowCount && existing.rowCount > 0) continue;
      const aid = id('alloc');
      const requestedAt = new Date(Date.now() - req.offsetSeconds * (HARBOUR_REQUESTS.length - n + 1) * 10);
      await db.query(
        'INSERT INTO allocations (id, workspace_id, drop_id, stockist_id, status, version, requested_at, internal_note, saved_by, saved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [aid, wsIds.get('Maren Vale')!, harbourId, sid, 'requested', 1, requestedAt, '', jonasId, requestedAt]
      );
      for (const [styleNumber, quantity] of req.lines) {
        const style = await db.query('SELECT name FROM styles WHERE drop_id = $1 AND lower(style_number) = lower($2)', [harbourId, styleNumber]);
        await db.query(
          'INSERT INTO allocation_lines (allocation_id, style_number, style_name, requested_quantity, allocated_quantity) VALUES ($1,$2,$3,$4,$5)',
          [aid, styleNumber, style.rows[0]?.name ?? '', quantity, 0]
        );
      }
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

async function addClaim(db: Db, dropId: string, market: string, index: number, slug: string): Promise<void> {
  // Seeded claims belong to the addresses shopper01@example.com upward, one per
  // drop and market.
  const n = index + 1;
  await db.query(
    'INSERT INTO claims (id, drop_id, market, reference, name, email, claimed_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
    [id('clm'), dropId, market, claimReference(`${slug}|${market}`, n), `Shopper ${n}`, `shopper${String(n).padStart(2, '0')}-${market}@example.com`, new Date(Date.now() - 86400 * 1000)]
  );
}

function claimReference(key: string, index: number): string {
  // A deterministic, collision-free encoding of (drop, market, index):
  // four characters mixing the key with two for the index.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 9173327;
  const a = alphabet[h % 31];
  const b = alphabet[(h / 31 | 0) % 31];
  const c = alphabet[index % 31];
  const d = alphabet[(index / 31 | 0) % 31];
  const e = alphabet[(h + index) % 31];
  const f = alphabet[(h * 3 + index * 7 + 11) % 31];
  return 'HL-' + a + b + c + d + e + f;
}

export function weekLabelOfDrop(goLiveAt: string): string {
  return isoWeekOf(cphDateOf(parseInstant(goLiveAt)!)).label;
}
