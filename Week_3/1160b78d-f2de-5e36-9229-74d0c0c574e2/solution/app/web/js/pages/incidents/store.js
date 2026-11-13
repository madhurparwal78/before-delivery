// The incident list's state and the rules that keep it steady while incidents arrive and leave:
// rows on view never move for an arrival, a row that leaves hands focus to its heir, the total follows the server.
import { api } from '../../lib/api.js';
import { covers, listQuery, newer, PAGE_SIZE, PAST } from './model.js';

const TOTAL_DELAY_MS = 80;

export class ListStore {
  constructor(filter, focusIsInList) {
    this.focusIsInList = focusIsInList;
    this.listeners = new Set();
    this.known = new Set();
    this.baseline = null;
    this.onFirst = true;
    this.token = 0;
    this.totalToken = 0;
    this.totalTimer = null;
    this.focusSeq = 0;
    this.acting = 0;
    this.focusOnDrop = false;
    this.s = {
      filter, loaded: false, failed: false, items: [], total: null, next: null, prev: null,
      pending: [], selected: new Set(), cursor: null, focusReq: null, results: [],
    };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch) {
    this.s = { ...this.s, ...patch };
    for (const fn of this.listeners) fn();
  }

  // cursor is the row that holds the one tab stop: the last row focused, else the first.
  cursorId() {
    const { items, cursor } = this.s;
    return items.some((i) => i.id === cursor) ? cursor : items[0]?.id ?? null;
  }

  setCursor(id) {
    if (this.s.cursor !== id) this.set({ cursor: id });
  }

  requestFocus(target) {
    this.set({ focusReq: { target, n: ++this.focusSeq } });
  }

  focusDone(n) {
    if (this.s.focusReq && this.s.focusReq.n === n) this.s = { ...this.s, focusReq: null };
  }

  // setFilter shows another filter; rows stay until its first page arrives.
  setFilter(filter) {
    this.set({ filter });
    return this.load(filter, { focus: 'none' });
  }

  // load reads a page. With no cursor it is the first page: arrivals are folded in and the view starts afresh.
  async load(filter, { after, before, focus = 'none', fresh = true } = {}) {
    const token = ++this.token;
    const extra = { limit: PAGE_SIZE };
    if (after) extra.after = after;
    if (before) extra.before = before;
    const res = await api.get(listQuery(filter, extra));
    if (token !== this.token) return;
    if (!res.ok) {
      this.set({ loaded: true, failed: true });
      return;
    }
    const { items, total, next_cursor: next, prev_cursor: prev } = res.data;
    const first = !after && !before;
    if (first) {
      this.known = new Set();
      this.baseline = items[0] ?? null;
    }
    this.onFirst = first;
    for (const item of items) this.known.add(item.id);
    const here = new Set(items.map((i) => i.id));
    const patch = {
      loaded: true, failed: false, items, total, next, prev,
      pending: first ? [] : this.s.pending.filter((i) => !here.has(i.id)),
      selected: fresh ? new Set() : new Set([...this.s.selected].filter((id) => here.has(id))),
      cursor: here.has(this.s.cursor) && focus === 'keep' ? this.s.cursor : null,
    };
    if (focus === 'first' && items.length) patch.cursor = items[0].id;
    const target = patch.cursor ?? items[0]?.id;
    this.set(patch);
    if (focus !== 'none' && target) this.requestFocus(target);
  }

  older() {
    if (this.s.next) return this.load(this.s.filter, { after: this.s.next, fresh: false });
    return undefined;
  }

  newer() {
    if (this.s.prev) return this.load(this.s.filter, { before: this.s.prev, fresh: false });
    return undefined;
  }

  // showNew moves to the first page with the arrivals on top; focus stays on its row if that row is still on view.
  showNew() {
    return this.load(this.s.filter, { focus: 'keep', fresh: false });
  }

  toggle(id) {
    const selected = new Set(this.s.selected);
    if (!selected.delete(id)) selected.add(id);
    this.set({ selected });
  }

  // chosen is what A and R act on: the selected rows in row order, else the focused row.
  chosen() {
    const { items, selected } = this.s;
    const rows = items.filter((i) => selected.has(i.id));
    if (rows.length) return rows;
    const id = this.cursorId();
    return items.filter((i) => i.id === id);
  }

  // drop takes rows out of the view. When the focused row goes, focus moves to the row that took its place,
  // else the new last row, else the empty sentence.
  drop(ids) {
    const gone = new Set(ids);
    const { items, selected } = this.s;
    for (const id of gone) this.known.delete(id);
    const kept = items.filter((i) => !gone.has(i.id));
    const patch = { items: kept, selected: new Set([...selected].filter((id) => !gone.has(id))), total: this.counted(-(items.length - kept.length)) };
    const at = items.findIndex((i) => i.id === this.cursorId());
    if (at >= 0 && gone.has(items[at].id)) {
      const heir = items.slice(at + 1).find((i) => !gone.has(i.id)) ?? kept[kept.length - 1] ?? null;
      patch.cursor = heir ? heir.id : null;
      const move = this.focusOnDrop || this.focusIsInList();
      this.set(patch);
      if (move) this.requestFocus(heir ? heir.id : 'empty');
      return;
    }
    this.set(patch);
  }

  // onIncident applies one live message: in place for a row on view, otherwise as an arrival or a departure.
  onIncident(data) {
    const item = data.item;
    this.refreshTotal();
    if (!item || !this.s.loaded) return;
    const { filter, items, pending, next } = this.s;
    const inView = items.some((i) => i.id === item.id);
    if (!covers(filter, item)) {
      this.known.delete(item.id);
      if (inView) this.drop([item.id]);
      else if (pending.some((i) => i.id === item.id)) this.set({ pending: pending.filter((i) => i.id !== item.id), total: this.counted(-1) });
      return;
    }
    if (inView) {
      this.set({ items: items.map((i) => (i.id === item.id ? item : i)) });
      return;
    }
    if (pending.some((i) => i.id === item.id)) {
      this.set({ pending: pending.map((i) => (i.id === item.id ? item : i)) });
      return;
    }
    if (this.known.has(item.id)) return;
    const last = items[items.length - 1];
    const above = this.onFirst ? !next || !last || newer(item, last) : !this.baseline || newer(item, this.baseline);
    if (!above) return;
    if (this.onFirst && !items.length) this.load(filter, { fresh: false });
    else this.set({ pending: [...pending, item], total: this.counted(1) });
  }

  // counted is the total after a change this page has seen for itself; it holds until the server's count arrives.
  counted(change) {
    this.totalToken += 1;
    return this.s.total === null ? null : Math.max(0, this.s.total + change);
  }

  // refreshTotal re-reads the exact total shortly after anything changed.
  refreshTotal() {
    clearTimeout(this.totalTimer);
    this.totalTimer = setTimeout(async () => {
      const filter = this.s.filter;
      const mine = ++this.totalToken;
      const res = await api.get(listQuery(filter, { limit: 1 }));
      if (res.ok && mine === this.totalToken && filter === this.s.filter) this.set({ total: res.data.total });
    }, TOTAL_DELAY_MS);
  }

  // bulk decides the chosen rows, reports each row's own result in row order and updates the rows at once.
  async bulk(action, rows, { moveFocus }) {
    this.acting += 1;
    this.focusOnDrop = moveFocus;
    try {
      const res = await api.post('/api/incidents/bulk', { action, ids: rows.map((r) => r.id) });
      if (!res.ok) return;
      const byId = new Map(res.data.results.map((r) => [r.id, r]));
      const results = [];
      const leaving = [];
      const statuses = new Map();
      for (const row of rows) {
        const result = byId.get(row.id);
        if (!result) continue;
        const number = result.number ?? row.number;
        if (result.status === 'ok') {
          results.push(`#${number} ${PAST[action]}.`);
          statuses.set(row.id, PAST[action]);
        } else {
          const decision = result.decision ?? PAST[action];
          results.push(`#${number}: Already ${decision}${result.decided_by ? ` by ${result.decided_by}` : ''}.`);
          if (result.decision) statuses.set(row.id, result.decision);
        }
      }
      const items = this.s.items.map((i) => (statuses.has(i.id) ? { ...i, status: statuses.get(i.id) } : i));
      for (const i of items) if (statuses.has(i.id) && !covers(this.s.filter, i)) leaving.push(i.id);
      this.set({ items, results, selected: new Set() });
      if (leaving.length) this.drop(leaving);
    } finally {
      this.acting -= 1;
      this.focusOnDrop = false;
      this.refreshTotal();
    }
  }
}
