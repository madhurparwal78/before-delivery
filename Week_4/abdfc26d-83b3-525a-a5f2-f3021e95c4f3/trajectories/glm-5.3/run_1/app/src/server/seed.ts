import { readFileSync } from 'node:fs';

import { saleShares, sha256Hex, VAT_RATES } from '../domain.js';
import type { Tx } from './db.js';

export const schemaSql = readFileSync(new URL('schema.sql', import.meta.url), 'utf8');

export interface SeedUser {
  username: string;
  display_name: string;
  email: string;
  roles: string[];
  password: string;
  seller_address: string | null;
}

export const SEED_USERS: SeedUser[] = [
  { username: 'wren.okafor', display_name: 'Wren Okafor', email: 'wren@brightmoss.example', roles: ['founder-operator'], password: 'Yard-Founder-2026', seller_address: null },
  { username: 'ilse.marrow', display_name: 'Ilse Marrow', email: 'ilse@studio-marrow.example', roles: ['creator'], password: 'Yard-Creator-2026', seller_address: 'Studio Marrow, 12 Lindenstraat, Utrecht, Netherlands' },
  { username: 'tobi.ansel', display_name: 'Tobi Ansel', email: 'tobi@ansel-loops.example', roles: ['creator'], password: 'Yard-Creator-2026', seller_address: 'Ansel Loops, 4 Hafenweg, Bremen, Germany' },
  { username: 'odile.renn', display_name: 'Odile Renn', email: 'odile@renn-signal.example', roles: ['creator'], password: 'Yard-Creator-2026', seller_address: 'Renn Signal, 9 Rue des Lampes, Lyon, France' },
  { username: 'june.halloway', display_name: 'June Halloway', email: 'june@collectors.example', roles: ['collector'], password: 'Yard-Collector-2026', seller_address: null },
  { username: 'pax.ferreira', display_name: 'Pax Ferreira', email: 'pax@collectors.example', roles: ['collector'], password: 'Yard-Collector-2026', seller_address: null },
  { username: 'nell.quist', display_name: 'Nell Quist', email: 'nell@collectors.example', roles: ['collector'], password: 'Yard-Collector-2026', seller_address: null }
];

export const USER_IDS: Record<string, string> = {
  wren: 'u_wren_okafor',
  ilse: 'u_ilse_marrow',
  tobi: 'u_tobi_ansel',
  odile: 'u_odile_renn',
  june: 'u_june_halloway',
  pax: 'u_pax_ferreira',
  nell: 'u_nell_quist'
};

const shader = (kind: 'tide' | 'salt' | 'lantern' | 'halo' | 'loom'): string => {
  const bodies: Record<string, string> = {
    tide: `uniform vec2 uResolution; uniform float uTime; uniform float uSeed; uniform float uHue; uniform float uFilm; uniform float uDrift;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 91.7) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h(i), b = h(i + vec2(1.0, 0.0)), c = h(i + vec2(0.0, 1.0)), d = h(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
vec3 pal(float t){ vec3 a = vec3(0.16, 0.10, 0.06), b = vec3(0.94, 0.72, 0.24), c = vec3(0.09, 0.55, 0.62), d = vec3(0.05, 0.05, 0.08);
  return a + b * cos(6.28318 * (c * t + d)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution; float t = uTime * uDrift * 0.22;
  float bands = sin((uv.y + n(uv * 3.0 + t) * uFilm * 2.4) * (14.0 + uFilm * 18.0));
  float sheen = pow(0.5 + 0.5 * bands, 3.0);
  float drift = n(uv * vec2(2.0, 5.0) + vec2(t, -t));
  float thick = smoothstep(0.0, 1.2, uv.y + uFilm * 0.6);
  vec3 col = pal(uHue + sheen * 0.35 + drift * 0.22) * (0.28 + sheen * 1.15) * thick;
  col += vec3(0.10, 0.09, 0.07) * (1.0 - thick) * 0.7;
  gl_FragColor = vec4(col, 1.0);
}`,
    salt: `uniform vec2 uResolution; uniform float uTime; uniform float uSeed; uniform float uHue; uniform float uFilm; uniform float uDrift;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution; vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * 2.6;
  float t = uTime * 0.18 * uDrift; float r = length(p);
  float halo = sin(r * (7.0 + uFilm * 9.0) - t * 2.2 + uSeed * 12.0);
  float ring = pow(max(halo, 0.0), 6.0);
  vec3 base = vec3(0.03, 0.04, 0.06);
  vec3 warm = vec3(0.99, 0.83, 0.44) * ring;
  vec3 cool = vec3(0.36, 0.66, 0.72) * pow(max(-halo, 0.0), 3.0) * 0.5;
  float grain = fract(sin(dot(uv, vec2(12.9898, 78.233)) + uSeed * 43.7) * 43758.5453) * 0.06;
  vec3 col = base + warm + cool + grain;
  gl_FragColor = vec4(col, 1.0);
}`,
    lantern: `uniform vec2 uResolution; uniform float uTime; uniform float uSeed; uniform float uHue; uniform float uFilm; uniform float uDrift;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1)) + uSeed * 17.3) * 24634.6345); }
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution; float t = uTime * uDrift;
  vec2 g = uv * vec2(38.0, 38.0 * (uResolution.y / uResolution.x));
  vec2 cell = floor(g); vec2 f = fract(g);
  float flick = h(cell) * 0.6 + 0.4 * sin(t * (2.0 + h(cell * 1.7) * 6.0));
  float d = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
  float edge = smoothstep(0.42, 0.5, d);
  vec3 on = vec3(0.98, 0.86, 0.52) * (0.25 + flick * 0.9);
  vec3 off = vec3(0.04, 0.045, 0.06);
  vec3 col = mix(on, off, edge) * (0.55 + uFilm * 0.7);
  col *= smoothstep(1.25, 0.35, length(uv - 0.5) * 2.0);
  gl_FragColor = vec4(col, 1.0);
}`,
    halo: `uniform vec2 uResolution; uniform float uTime; uniform float uSeed; uniform float uHue; uniform float uFilm; uniform float uDrift;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution; vec2 p = (uv - 0.5) * 2.0;
  float t = uTime * 0.25 * uDrift;
  float ang = atan(p.y, p.x) + uSeed * 6.28;
  float r = length(p);
  float under = sin(ang * 5.0 + sin(t * 1.4) * 1.6) * 0.5 + 0.5;
  float swell = smoothstep(1.0, 0.15, r + under * 0.28 * uFilm);
  vec3 deep = vec3(0.05, 0.07, 0.11);
  vec3 glow = mix(vec3(0.20, 0.65, 0.68), vec3(0.92, 0.80, 0.38), under) * swell;
  vec3 col = deep + glow * (0.75 + 0.45 * sin(t * 0.8));
  gl_FragColor = vec4(col, 1.0);
}`,
    loom: `uniform vec2 uResolution; uniform float uTime; uniform float uSeed; uniform float uHue; uniform float uFilm; uniform float uDrift;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float t = uTime * uDrift * 0.3;
  float warp = sin(uv.y * 9.0 + t * 2.0) * 0.5 + sin(uv.x * 6.0 - t) * 0.5;
  float weave = sin((uv.x + warp * 0.08 * uFilm) * 60.0) * sin((uv.y - warp * 0.06) * 46.0 + t);
  float glow = pow(0.5 + 0.5 * weave, 4.0);
  vec3 col = mix(vec3(0.04, 0.04, 0.07), vec3(0.85, 0.66, 0.30), glow) * (0.6 + 0.4 * sin(t));
  col += vec3(0.10, 0.12, 0.16) * (1.0 - uv.y) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}`
  };
  return bodies[kind];
};

export interface SeedPiece {
  slug: string;
  title: string;
  creatorId: string;
  state: 'published' | 'draft';
  kind: 'tide' | 'salt' | 'lantern' | 'halo' | 'loom';
  edition_count: number | null;
  price_cents: number | null;
  remix_of: string | null;
  featured: boolean;
  uniforms: { name: string; label: string; min: number; max: number; value: number }[];
}

export const SEED_PIECES: SeedPiece[] = [
  { slug: 'tidewater-bloom', title: 'Tidewire Bloom', creatorId: USER_IDS.ilse, state: 'published', kind: 'tide', edition_count: 40, price_cents: 2400, remix_of: null, featured: true,
    uniforms: [
      { name: 'uHue', label: 'Hue', min: 0, max: 1, value: 0.42 },
      { name: 'uFilm', label: 'Film thickness', min: 0, max: 1, value: 0.35 },
      { name: 'uDrift', label: 'Drift', min: 0, max: 2, value: 0.9 }
    ] },
  { slug: 'salt-halo', title: 'Salt Halo', creatorId: USER_IDS.ilse, state: 'published', kind: 'salt', edition_count: 12, price_cents: 999, remix_of: null, featured: false,
    uniforms: [
      { name: 'uHue', label: 'Hue', min: 0, max: 1, value: 0.55 },
      { name: 'uFilm', label: 'Film thickness', min: 0, max: 1, value: 0.3 },
      { name: 'uDrift', label: 'Drift', min: 0, max: 2, value: 0.7 }
    ] },
  { slug: 'lantern-static', title: 'Lantern Static', creatorId: USER_IDS.tobi, state: 'published', kind: 'lantern', edition_count: 3, price_cents: 1200, remix_of: null, featured: false,
    uniforms: [
      { name: 'uHue', label: 'Hue', min: 0, max: 1, value: 0.5 },
      { name: 'uFilm', label: 'Film thickness', min: 0, max: 1, value: 0.55 },
      { name: 'uDrift', label: 'Drift', min: 0, max: 2, value: 1.1 }
    ] },
  { slug: 'halo-undertow', title: 'Halo Undertow', creatorId: USER_IDS.tobi, state: 'published', kind: 'halo', edition_count: 25, price_cents: 1999, remix_of: 'salt-halo', featured: false,
    uniforms: [
      { name: 'uHue', label: 'Hue', min: 0, max: 1, value: 0.48 },
      { name: 'uFilm', label: 'Film thickness', min: 0, max: 1, value: 0.4 },
      { name: 'uDrift', label: 'Drift', min: 0, max: 2, value: 0.8 }
    ] },
  { slug: 'night-loom', title: 'Night Loom', creatorId: USER_IDS.ilse, state: 'draft', kind: 'loom', edition_count: null, price_cents: null, remix_of: null, featured: false,
    uniforms: [
      { name: 'uHue', label: 'Hue', min: 0, max: 1, value: 0.12 },
      { name: 'uFilm', label: 'Film thickness', min: 0, max: 1, value: 0.7 },
      { name: 'uDrift', label: 'Drift', min: 0, max: 2, value: 0.5 }
    ] }
];

export const SEED_TIMELINES: Record<string, unknown> = {
  default: { duration_s: 10, tracks: [], audio_asset_id: null },
  nightLoom: {
    duration_s: 10,
    tracks: [{ uniform: 'uHue', keyframes: [
      { time_s: 0.0, value: 0.12, easing: 'ease-in-out' },
      { time_s: 5.0, value: 0.4, easing: 'ease-in-out' }
    ] }],
    audio_asset_id: null
  }
};

export interface SeedOrder {
  invoice: string;
  paid_day: string;
  piece: string;
  edition: number;
  buyerId: string;
  country: string;
  net: number;
  vat: number;
  gross: number;
}

export const SEED_ORDERS: SeedOrder[] = [
  { invoice: 'PY-2026-000001', paid_day: '2026-10-02', piece: 'tidewater-bloom', edition: 1, buyerId: USER_IDS.june, country: 'US', net: 2400, vat: 0, gross: 2400 },
  { invoice: 'PY-2026-000002', paid_day: '2026-10-02', piece: 'lantern-static', edition: 1, buyerId: USER_IDS.pax, country: 'FR', net: 1200, vat: 240, gross: 1440 },
  { invoice: 'PY-2026-000003', paid_day: '2026-10-03', piece: 'halo-undertow', edition: 4, buyerId: USER_IDS.june, country: 'DE', net: 1999, vat: 380, gross: 2379 },
  { invoice: 'PY-2026-000004', paid_day: '2026-10-04', piece: 'lantern-static', edition: 2, buyerId: USER_IDS.june, country: 'US', net: 1200, vat: 0, gross: 1200 },
  { invoice: 'PY-2026-000005', paid_day: '2026-10-05', piece: 'tidewater-bloom', edition: 5, buyerId: USER_IDS.pax, country: 'FR', net: 2400, vat: 480, gross: 2880 }
];

export const SEED_CREDITS: { userId: string; amount: number }[] = [
  { userId: USER_IDS.ilse, amount: 600 },
  { userId: USER_IDS.tobi, amount: 40 },
  { userId: USER_IDS.odile, amount: 0 }
];

/** Applies the schema and the seed, both idempotently, inside one boot. */
export async function applySchemaAndSeed(tx: Tx, opts: { storage: { put: (key: string, bytes: Buffer, contentType: string) => Promise<void> } }): Promise<void> {
  await tx.query(schemaSql);
  const empty = await tx.one<{ count: string }>('SELECT count(*)::text AS count FROM users');
  if (empty?.count !== '0') return;
  for (const user of SEED_USERS) {
    await tx.query(
      `INSERT INTO users (id, username, display_name, email, roles, seller_address) VALUES ($1,$2,$3,$4,string_to_array($5, ','),$6)
       ON CONFLICT (id) DO NOTHING`,
      [USER_IDS[user.username.split('.')[0]], user.username, user.display_name, user.email, user.roles.join(','), user.seller_address]
    );
  }
  for (const piece of SEED_PIECES) {
    await tx.query(
      `INSERT INTO pieces (slug, title, state, version, engine, creator_id, fragment_source, uniforms, timeline, remix_of_slug, edition_count, price_cents, featured, published_at)
       VALUES ($1,$2,$3,1,'GLSL',$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12) ON CONFLICT (slug) DO NOTHING`,
      [
        piece.slug, piece.title, piece.state, piece.creatorId, shader(piece.kind),
        JSON.stringify(piece.uniforms),
        JSON.stringify(piece.slug === 'night-loom' ? SEED_TIMELINES.nightLoom : SEED_TIMELINES.default),
        piece.remix_of, piece.edition_count, piece.price_cents, piece.featured,
        piece.state === 'published' ? new Date('2026-10-01T12:00:00Z') : null
      ]
    );
    if (piece.state === 'published') {
      const renderId = `rn_seed_${piece.slug.replace(/-/g, '_')}`;
      const content = Buffer.from(`export ${piece.slug} 1080p 16:9 10s mp4\n`);
      await tx.query(
        `INSERT INTO renders (id, piece_slug, state, cost_credits, attempts, format, resolution, duration_s, aspect, sha256, history)
         VALUES ($1,$2,'ready',20,1,'mp4','1080p',10,'16:9',$3,$4::jsonb) ON CONFLICT (id) DO NOTHING`,
        [renderId, piece.slug, sha256Hex(content), JSON.stringify([
          { state: 'accepted', at: '2026-10-01T10:00:00Z' },
          { state: 'queued', at: '2026-10-01T10:00:01Z' },
          { state: 'rendering', at: '2026-10-01T10:00:02Z' },
          { state: 'stored', at: '2026-10-01T10:00:20Z' },
          { state: 'ready', at: '2026-10-01T10:00:21Z' }
        ])]
      );
      await tx.query(`UPDATE pieces SET export_render_id = $1 WHERE slug = $2 AND export_render_id IS NULL`, [renderId, piece.slug]);
      await opts.storage.put(`renders/${renderId}/export.mp4`, content, 'video/mp4');
    }
  }
  for (const grant of SEED_CREDITS) {
    if (grant.amount === 0) continue;
    const entry = await tx.one<{ id: string }>(
      `INSERT INTO credit_entries (kind, render_id) VALUES ('grant', NULL) RETURNING id::text`
    );
    if (!entry) continue;
    await tx.query(`INSERT INTO credit_rows (entry_id, account, amount) VALUES ($1,'platform:issued',$2), ($1,$3,$4)`,
      [entry.id, -grant.amount, `creator:${grant.userId}:available`, grant.amount]);
  }
  let seq = 0;
  for (const order of SEED_ORDERS) {
    seq += 1;
    const paidAt = new Date(`${order.paid_day}T12:00:00Z`);
    const id = `order_seed_${seq}`;
    const piece = SEED_PIECES.find((p) => p.slug === order.piece);
    const isRemix = piece?.remix_of != null;
    await tx.query(
      `INSERT INTO orders (id, piece_slug, collector_id, edition, state, billing_name, email, billing_country, net_cents, vat_rate_percent, vat_cents, gross_cents, invoice_number, invoice_status, receipt_status, paid_at, created_at)
       VALUES ($1,$2,$3,$4,'receipted',$5,$6,$7,$8,$9,$10,$11,$12,'pending','sent',$13,$13) ON CONFLICT (id) DO NOTHING`,
      [id, order.piece, order.buyerId, order.edition, buyerName(order.buyerId), buyerEmail(order.buyerId), order.country,
        order.net, vatRateOf(order.country), order.vat, order.gross, order.invoice, paidAt]
    );
    const creatorId = piece?.creatorId ?? '';
    const remixer = isRemix ? creatorId : null;
    const originalId = isRemix ? SEED_PIECES.find((p) => p.slug === piece?.remix_of)?.creatorId ?? '' : null;
    const shares = saleShares(order.net, isRemix);
    for (const share of shares) {
      let holderId: string;
      if (share.party === 'platform') holderId = 'platform';
      else if (share.party === 'remixer') holderId = remixer ?? creatorId;
      else if (share.party === 'royalty') holderId = originalId ?? creatorId;
      else holderId = creatorId;
      await tx.query(
        `INSERT INTO split_rows (order_id, party, holder_id, kind, amount_cents) VALUES ($1,$2,$3,'sale',$4)`,
        [id, share.party, holderId, share.amount_cents]
      );
    }
  }
  await tx.query(`INSERT INTO invoice_sequences (year, last_invoice, last_credit_note) VALUES (2026, 5, 0) ON CONFLICT (year) DO NOTHING`);
  await tx.query(`INSERT INTO statements (period, status) VALUES ('2026-10','open') ON CONFLICT (period) DO NOTHING`);
}

function buyerName(id: string): string {
  return SEED_USERS.find((u) => USER_IDS[u.username.split('.')[0]] === id)?.display_name ?? 'Collector';
}

function buyerEmail(id: string): string {
  return SEED_USERS.find((u) => USER_IDS[u.username.split('.')[0]] === id)?.email ?? 'collector@example.com';
}

function vatRateOf(code: string): number {
  return VAT_RATES[code] ?? 0;
}

export const SEED_FEATURED_SLUG = 'tidewater-bloom';
