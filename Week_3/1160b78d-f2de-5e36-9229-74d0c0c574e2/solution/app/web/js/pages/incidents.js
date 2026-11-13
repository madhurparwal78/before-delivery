// /incidents: the exact total, the filters in the address, the table with its keyboard model, paging under arrivals.
import { html, useState, useEffect, useRef } from '../lib/html.js';
import { api } from '../lib/api.js';
import { boot } from '../lib/boot.js';
import { live } from '../lib/live.js';
import { Bar, Button } from '../lib/ui.js';
import { openDialog } from '../lib/dialog.js';
import { ListStore } from './incidents/store.js';
import { readFilter, filterAddress, STATUS_OPTIONS } from './incidents/model.js';
import { IncidentTable } from './incidents/table.js';
import { Filters, SavedFilters } from './incidents/filters.js';
import { ResolveDialog, BulkResults, ActionBar } from './incidents/bulk.js';

// Every decided incident event is announced, on any incident; the library keeps each line once and in order.
export function announce() {
  return true;
}

function useStore(store) {
  const [, redraw] = useState(0);
  useEffect(() => store.subscribe(() => redraw((n) => n + 1)), [store]);
  return store.s;
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'password', 'number', 'tel', 'url']);

function typesText(el) {
  if (!(el instanceof Element)) return false;
  if (el.closest('textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  return el.tagName === 'INPUT' && TEXT_INPUTS.has((el.getAttribute('type') ?? 'text').toLowerCase());
}

function rowElement(region, id) {
  return region ? region.querySelector(`[data-id="${id}"]`) : null;
}

const EDGE = 16;

// bringIntoView scrolls just far enough that the whole row shows, clear of the fixed action bar on a phone.
function bringIntoView(el) {
  const bar = document.querySelector('.list-bar');
  const barTop = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : window.innerHeight;
  const box = el.getBoundingClientRect();
  if (box.bottom > barTop - EDGE) window.scrollBy(0, box.bottom - (barTop - EDGE));
  else if (box.top < EDGE) window.scrollBy(0, box.top - EDGE);
}

export default function Incidents() {
  const zone = boot.user?.timezone;
  const region = useRef(null);
  const dialogOpen = useRef(false);
  const [store] = useState(() => new ListStore(readFilter(location.search),
    () => dialogOpen.current || (region.current?.contains(document.activeElement) ?? false)));
  const s = useStore(store);
  const [services, setServices] = useState([]);
  const dialogEl = useRef(null);
  const dialogHandle = useRef(null);
  const [asking, setAsking] = useState({ rows: [], opener: null });
  const [dialog, setDialog] = useState(false);

  const focusRow = (id) => {
    const el = rowElement(region.current, id);
    if (!el) return;
    el.focus({ preventScroll: true });
    bringIntoView(el);
  };

  const goTo = (filter) => {
    history.pushState({}, '', filterAddress(filter));
    store.setFilter(filter);
  };

  const acknowledge = (moveFocus) => {
    const rows = store.chosen();
    if (!rows.length || store.acting) return Promise.resolve();
    return store.bulk('acknowledge', rows, { moveFocus });
  };

  const askResolve = (opener) => {
    const rows = store.chosen();
    if (!rows.length) return;
    setAsking({ rows, opener });
    dialogOpen.current = true;
    setDialog(true);
    dialogHandle.current = openDialog(dialogEl.current, opener, () => {
      dialogOpen.current = false;
      setDialog(false);
    });
  };

  const resolve = async () => {
    await store.bulk('resolve', asking.rows, { moveFocus: asking.opener?.matches?.('[data-incident]') ?? false });
    dialogHandle.current.close();
  };

  useEffect(() => {
    store.load(store.s.filter, { focus: 'first' });
    api.get('/api/services').then((res) => {
      if (!res.ok) return;
      const list = res.data.items ?? res.data;
      setServices(list.map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)));
    });
    const off = live.on('incident', (data) => store.onIncident(data));
    const back = () => store.setFilter(readFilter(location.search));
    const noticed = (event) => {
      const row = event.target.closest?.('[data-id]');
      if (row) store.setCursor(row.dataset.id);
    };
    const list = region.current;
    list.addEventListener('focusin', noticed);
    window.addEventListener('popstate', back);
    return () => {
      off();
      list.removeEventListener('focusin', noticed);
      window.removeEventListener('popstate', back);
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (typesText(target) || (target instanceof Element && target.closest('dialog'))) return;
      if (target !== document.body && !region.current?.contains(target)) return;
      const { items } = store.s;
      const at = items.findIndex((i) => i.id === store.cursorId());
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const move = (index) => {
        if (items.length) focusRow(items[Math.max(0, Math.min(items.length - 1, index))].id);
      };
      if (key === 'j') move(at + 1);
      else if (key === 'k') move(at - 1);
      else if (key === 'Home') move(0);
      else if (key === 'End') move(items.length - 1);
      else if (key === 'x') {
        if (at >= 0) store.toggle(items[at].id);
      } else if (key === 'a') acknowledge(true);
      else if (key === 'r') askResolve(rowElement(region.current, store.cursorId()));
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const request = s.focusReq;
  useEffect(() => {
    if (!request || dialog) return;
    if (request.target === 'empty') document.getElementById('list-empty')?.focus();
    else focusRow(request.target);
    store.focusDone(request.n);
  }, [request, dialog]);

  const cursor = store.cursorId();
  const status = STATUS_OPTIONS.find(([value]) => value === s.filter.status)[1];
  const edge = (last) => () => {
    if (s.items.length) focusRow(s.items[last ? s.items.length - 1 : 0].id);
  };

  return html`<div class=${'incidents-page' + (s.loaded ? '' : ' is-loading')}>
    <h1 class="figure-label">${status} incidents</h1>
    <div class="figure" role="status" aria-label="Incident total">${s.total ?? ''}</div>
    <${Filters} filter=${s.filter} services=${services} onChange=${goTo} />
    <${SavedFilters} filter=${s.filter} onOpen=${goTo} />
    ${s.failed ? html`<${Bar}>The incident list could not be loaded.</${Bar}>` : null}
    <div class="fresh">${s.pending.length
      ? html`<${Button} onClick=${() => store.showNew()}>${`Show ${s.pending.length} new incidents`}</${Button}>` : null}</div>
    <${BulkResults} lines=${s.results} />
    <div class="list-region" ref=${region}>
      <${IncidentTable} s=${s} cursor=${cursor} zone=${zone} onSelect=${(id) => store.toggle(id)} />
    </div>
    <div class="pager">
      <button type="button" class="secondary" aria-disabled=${s.prev ? undefined : 'true'} onClick=${() => store.newer()}>Newer incidents</button>
      <button type="button" class="secondary" aria-disabled=${s.next ? undefined : 'true'} onClick=${() => store.older()}>Older incidents</button>
    </div>
    ${s.loaded ? html`<${ActionBar} canAct=${s.selected.size > 0} onAcknowledge=${() => acknowledge(false)}
      onResolve=${(e) => askResolve(e.currentTarget)} onFirst=${edge(false)} onLast=${edge(true)} />` : null}
    <${ResolveDialog} dialogRef=${dialogEl} rows=${asking.rows} onConfirm=${resolve} onCancel=${() => dialogHandle.current.close()} />
  </div>`;
}
