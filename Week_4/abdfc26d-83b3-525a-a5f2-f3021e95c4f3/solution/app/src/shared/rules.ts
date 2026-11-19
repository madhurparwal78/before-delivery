// Domain rules the server and the browser both apply. Each is decided here and nowhere else.

export const ROLES = ["creator", "collector", "founder-operator"] as const;
export type Role = (typeof ROLES)[number];

/** The published VAT rate table, in whole percent. */
export const VAT_RATES = { US: 0, GB: 20, DE: 19, FR: 20, NL: 21, IE: 23, SE: 25 } as const;
type Country = keyof typeof VAT_RATES;

export const BILLING_COUNTRIES: readonly { code: Country | "OTHER"; label: string }[] = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "NL", label: "Netherlands" },
  { code: "IE", label: "Ireland" },
  { code: "SE", label: "Sweden" },
  { code: "OTHER", label: "Other country" },
];

export function isCountry(code: string): code is Country {
  return Object.hasOwn(VAT_RATES, code);
}

/** The sheet prices an unsupported country at 0%; the server refuses it. */
export function vatRate(code: string): number {
  return isCountry(code) ? VAT_RATES[code] : 0;
}

/** VAT = net × rate, rounded half up to the cent, in integers only. */
export function vatCents(netCents: number, ratePercent: number): number {
  return Math.floor((netCents * ratePercent + 50) / 100);
}

export const RESOLUTIONS = ["720p", "1080p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const FORMATS = ["mp4", "webm"] as const;
export type Format = (typeof FORMATS)[number];
export const RENDER_SECONDS = { min: 5, max: 60 } as const;

/** One credit per second at 720p, two at 1080p, for either format. */
export function renderCost(durationSeconds: number, resolution: Resolution): number {
  return durationSeconds * (resolution === "1080p" ? 2 : 1);
}

/** Monthly plans: price per month and the credits each Kill Bill-confirmed subscription invoice grants. */
export const PLANS = {
  "studio-monthly": { name: "Studio", credits: 300, priceCents: 1200 },
  "pro-monthly": { name: "Pro", credits: 1500, priceCents: 3600 },
} as const;
export type PlanCode = keyof typeof PLANS;

export const CREDIT_PACK = { code: "pack-500", credits: 500, priceCents: 1900, description: "Credit pack — 500 credits" } as const;

export const EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;
export type Easing = (typeof EASINGS)[number];

/** Dollars with two decimals and thousands commas, from integer cents. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** `2026-10` → `October 2026`. */
export function monthName(period: string): string {
  const [year, month] = period.split("-");
  return `${MONTHS[Number(month) - 1] ?? ""} ${year ?? ""}`;
}

// SHA-256 of a UTF-8 string, so the browser and the server derive edition seeds the same way.
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const length = Math.ceil((data.length + 9) / 64) * 64;
  const bytes = new Uint8Array(length);
  bytes.set(data);
  bytes[data.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(length - 4, data.length * 8);
  view.setUint32(length - 8, Math.floor((data.length * 8) / 0x100000000));
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0] ?? 0, h[1] ?? 0, h[2] ?? 0, h[3] ?? 0, h[4] ?? 0, h[5] ?? 0, h[6] ?? 0, h[7] ?? 0];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => (h[i] = ((h[i] ?? 0) + value) >>> 0));
  }
  return Array.from(h, (value) => value.toString(16).padStart(8, "0")).join("");
}

/** Edition N's seed hash: the first 16 hex characters of SHA-256 of `<slug>:<N>`. */
export function seedHash(slug: string, edition: number): string {
  return sha256Hex(`${slug}:${edition}`).slice(0, 16);
}

/** The shader's `uSeed`: the hash's first 8 hex characters as an unsigned integer ÷ 4294967295. */
export function seedUniform(hash: string): number {
  return parseInt(hash.slice(0, 8), 16) / 4294967295;
}
