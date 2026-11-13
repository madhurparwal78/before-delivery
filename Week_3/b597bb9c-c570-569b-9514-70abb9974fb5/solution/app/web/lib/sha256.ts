const primes: number[] = [];
for (let candidate = 2; primes.length < 64; candidate += 1) {
  if (primes.every((prime) => candidate % prime !== 0)) primes.push(candidate);
}

const fraction = (value: number): number => Math.floor((value - Math.floor(value)) * 2 ** 32) >>> 0;
const K = Uint32Array.from(primes.map((prime) => fraction(Math.cbrt(prime))));
const INITIAL = Uint32Array.from(primes.slice(0, 8).map((prime) => fraction(Math.sqrt(prime))));

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

/** Incremental SHA-256, so a file of any size is hashed one chunk at a time. */
class Sha256 {
  private readonly state = Uint32Array.from(INITIAL);
  private readonly block = new Uint8Array(64);
  private held = 0;
  private length = 0;
  private readonly words = new Uint32Array(64);

  update(data: Uint8Array): void {
    this.length += data.length;
    let offset = 0;
    while (offset < data.length) {
      const take = Math.min(64 - this.held, data.length - offset);
      this.block.set(data.subarray(offset, offset + take), this.held);
      this.held += take;
      offset += take;
      if (this.held === 64) {
        this.compress();
        this.held = 0;
      }
    }
  }

  private compress(): void {
    const w = this.words;
    for (let i = 0; i < 16; i += 1) {
      w[i] = ((this.block[i * 4] ?? 0) << 24) | ((this.block[i * 4 + 1] ?? 0) << 16) | ((this.block[i * 4 + 2] ?? 0) << 8) | (this.block[i * 4 + 3] ?? 0);
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = Array.from(this.state) as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + (K[i] ?? 0) + (w[i] ?? 0)) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i += 1) this.state[i] = ((this.state[i] ?? 0) + (next[i] ?? 0)) | 0;
  }

  hex(): string {
    const bits = this.length * 8;
    const pad = new Uint8Array(((this.held < 56 ? 56 : 120) - this.held) + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, Math.floor(bits / 2 ** 32));
    view.setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    return [...this.state].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
  }
}

/** SHA-256 of a file, read in slices so memory stays flat. */
export async function hashFile(file: File, sliceBytes = 4 * 1024 * 1024): Promise<string> {
  const hash = new Sha256();
  for (let offset = 0; offset < file.size; offset += sliceBytes) {
    hash.update(new Uint8Array(await file.slice(offset, offset + sliceBytes).arrayBuffer()));
  }
  return hash.hex();
}
