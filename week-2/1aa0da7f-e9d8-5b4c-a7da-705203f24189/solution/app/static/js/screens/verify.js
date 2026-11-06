// The Breaks rule and the browser's own memory of the chain, shared by the walk and the lattice.

import { api, ConnectionLost } from '../core.js';
import { linkDigest, ZERO_DIGEST } from '../chain.js';

const PAGE_SIZE = 500;
const RETRY_MS = 3000;
const MEMORY_KEY = 'wardline-chain-memory';
const MISSING_DIGEST = '-'.repeat(64);
const ANCHOR = /^wardline-anchor:v1:([1-9][0-9]*):([0-9a-f]{64})$/;

function readMemory() {
  try {
    return { high: null, anchors: [], ...JSON.parse(localStorage.getItem(MEMORY_KEY)) };
  } catch {
    return { high: null, anchors: [] };
  }
}

function writeMemory(memory) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // A browser refusing storage only loses the memory, and the walk still verifies.
  }
}

export function rememberHighWater(link, digest) {
  const memory = readMemory();
  if (memory.high && memory.high.link >= link) return;
  writeMemory({ ...memory, high: { link, digest } });
}

export function anchorText(link, digest) {
  return `wardline-anchor:v1:${link}:${digest}`;
}

export function parseAnchor(text) {
  const found = ANCHOR.exec(text.trim());
  return found && { link: Number(found[1]), name: found[1], digest: found[2] };
}

// One reading of the chain: rows fetched so far, digests the browser computed, and the first fault.
export class ChainCheck {
  constructor(signal) {
    this.signal = signal;
    this.rows = [];
    this.count = 0;
    this.digests = [ZERO_DIGEST];
    this.verified = 0;
    this.fault = null;
    this.remembered = new Map();
    this.reading = null;
  }

  // Keeps asking until the first page answers. False when the screen left first.
  async open() {
    for (;;) {
      try {
        if (await this.read()) return true;
      } catch (error) {
        if (error.name === 'AbortError') return false;
        if (!(error instanceof ConnectionLost)) throw error;
      }
      await new Promise((resolve) => { setTimeout(resolve, RETRY_MS); });
    }
  }

  // Reads the next page. Requests carry only `after` and `limit`.
  read({ background = false } = {}) {
    this.reading ??= this.readPage(background).finally(() => { this.reading = null; });
    return this.reading;
  }

  async readPage(background) {
    const after = this.rows.at(-1)?.seq ?? 0;
    const answer = await api('GET', `/api/ledger?after=${after}&limit=${PAGE_SIZE}`, { background, signal: this.signal });
    if (!answer.ok) return false;
    this.rows.push(...answer.data.entries);
    this.count = answer.data.count;
    return true;
  }

  loadMemory() {
    const { high, anchors } = readMemory();
    this.remembered = new Map();
    for (const { link, digest } of [...anchors, ...(high ? [high] : [])]) {
      this.remembered.set(link, [...(this.remembered.get(link) ?? []), digest]);
    }
  }

  addAnchor({ link, digest }) {
    const memory = readMemory();
    writeMemory({ ...memory, anchors: [...memory.anchors, { link, digest }] });
    this.loadMemory();
  }

  // Tests the next link. True when it verified, false at a fault or when no further row is at hand.
  async next() {
    if (this.fault) return false;
    if (this.verified === this.rows.length && this.rows.length < this.count) await this.read();
    const row = this.rows[this.verified];
    if (!row) return false;
    const link = this.verified + 1;
    if (row.seq !== link) return this.fail(link, MISSING_DIGEST, null);
    const previous = this.digests[this.verified];
    const computed = await linkDigest(previous, row);
    if (this.fault) return false;
    if (row.digest !== computed) return this.fail(link, computed, row.digest);
    if (row.prev_digest !== previous) return this.fail(link, previous, row.prev_digest);
    const differing = this.remembered.get(link)?.find((digest) => digest !== computed);
    if (differing) return this.fail(link, computed, differing);
    this.digests[link] = computed;
    this.verified = link;
    return true;
  }

  fail(link, shown, compared) {
    this.fault = { link, shown, compared };
    this.verified = link - 1;
    return false;
  }

  // An anchor at or below the verified link is tested at once. True when it matches.
  testAnchor({ link, digest }) {
    if (this.digests[link] === digest) return true;
    this.fail(link, this.digests[link], digest);
    return false;
  }

  // The chain's end is a break only when a link beyond it is remembered.
  checkEnd() {
    if (this.fault || this.verified < this.count || this.verified < this.rows.length) return;
    if ([...this.remembered.keys()].some((link) => link > this.verified)) {
      this.fail(this.verified + 1, MISSING_DIGEST, null);
    }
  }

  stateOf(link) {
    if (this.fault && link === this.fault.link) return 'break';
    if (this.fault && link > this.fault.link) return 'fault';
    return link <= this.verified ? 'verified' : 'unverified';
  }
}
