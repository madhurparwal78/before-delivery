import type { Account, Addon, Badge, Device, Dossier, Note, VaultMeta } from './store';
import { save, uuid, newIdemKey, get } from './store';
import { popQueue } from './apiHelpers';
import {
  pushNote, pullRevisions, blob, history, cursor, restoreRevision, decryptBlob,
  manifestPreview, noteToCandidate, candidatesFor, HttpError,
} from './api';
import { countsAt } from './ui/ring';
import { computeManifest, linkTargets, splitTarget } from '../shared/domain';
import { renderBody } from '../shared/render';
import icons from './icons.json';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const el = (tag: string, attrs: Record<string, string | boolean | undefined> = {}, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (v === true) n.setAttribute(k, '');
    else if (v !== false) n.setAttribute(k, String(v));
  }
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (iso: string | null | undefined): string => {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
};
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Session {
  account: Account | null;
  device: Device | null;
  vaults: VaultMeta[];
  sync: Addon | null;
  publish: Addon | null;
  dossiers: Dossier[];
  unlockedVaults: Set<string>;
}
const session: Session = {
  account: null, device: null, vaults: [], sync: null, publish: null, dossiers: [], unlockedVaults: new Set(),
};

interface LocalNotebook { kind: 'local' }
interface VaultNotebook { kind: 'vault'; vaultId: string }
const nb: { current: LocalNotebook | VaultNotebook } = { current: { kind: 'local' } };
const state = { mode: 'edit' as 'edit' | 'read', inFlight: 0, storageOutage: false, readOnly: false };
const ctx = { tab: 'Backlinks' as 'Backlinks' | 'History' | 'Graph' | 'Publish' };
const ring = { radius: 2 };
let hopToken = 0;
const wb = { dossier: null as Dossier | null };
const checkState = { value: 'pending' as 'pending' | 'match' | 'mismatch' | 'fail' };
let focusReturn: HTMLElement | null = null;

const notesOf = (): Note[] => {
  const st = get();
  return nb.current.kind === 'local' ? st.localNotes : st.notebooks[(nb.current as VaultNotebook).vaultId] ?? [];
};

const setNotes = (notes: Note[]): void => {
  const st = get();
  if (nb.current.kind === 'local') save({ localNotes: notes });
  else save({ notebooks: { ...st.notebooks, [(nb.current as VaultNotebook).vaultId]: notes } });
};

const heads = (): Record<string, number> => {
  try { return JSON.parse(sessionStorage.getItem('cairn.heads') ?? '{}'); } catch { return {}; }
};
const setHead = (noteId: string, rev: number | null): void => {
  const h = heads();
  if (rev === null) delete h[noteId];
  else h[noteId] = rev;
  sessionStorage.setItem('cairn.heads', JSON.stringify(h));
};
const rejects = (): Record<string, string> => {
  try { return JSON.parse(sessionStorage.getItem('cairn.reject') ?? '{}'); } catch { return {}; }
};
const setReject = (noteId: string, message: string): void => {
  const r = rejects();
  r[noteId] = message;
  sessionStorage.setItem('cairn.reject', JSON.stringify(r));
};

// ---------- badges ----------

const setBadge = (noteId: string, badge: Badge): void => {
  save({ badges: { ...get().badges, [noteId]: badge } });
};

const badgeText = (note: Note): string =>
  nb.current.kind === 'local' ? 'local only' : get().badges[note.id] ?? 'pending';

// ---------- sync engine ----------

const flushQueue = async (): Promise<void> => {
  if (nb.current.kind !== 'vault' || !session.device?.approved) return;
  const vaultId = (nb.current as VaultNotebook).vaultId;
  while (get().queue.length) {
    const item = get().queue[0];
    const notes = notesOf();
    const note = notes.find((n) => n.id === item.noteId);
    if (!note) { popQueue(); continue; }
    const raw = get().vaultKeyRaw[vaultId];
    if (!raw) return;
    state.inFlight++;
    renderTopbar();
    try {
      const res = await pushNote(vaultId, item.noteId, note, item.baseRevision, raw, item.idemKey);
      popQueue();
      setHead(item.noteId, res.revision.rev);
      setBadge(note.id, 'synced');
      state.storageOutage = false;
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 503 && e.code === 'storage_unavailable') {
          state.storageOutage = true;
          setBadge(note.id, 'paused');
          break;
        }
        if (e.status === 503) {
          setBadge(note.id, 'paused');
          break;
        }
        if (e.status === 409 && e.code === 'revision_conflict') {
          const head = (e.extra as { head_revision?: number | null })?.head_revision ?? null;
          await handleConflict(vaultId, item.noteId, head);
          break;
        }
        if (e.status === 403 && e.code === 'vault_read_only') {
          state.readOnly = true;
          setBadge(note.id, 'sync error');
          setReject(item.noteId, e.message);
          popQueue();
          break;
        }
        if (e.status === 402 || e.status === 403 || e.status === 422) {
          setBadge(note.id, 'sync error');
          setReject(item.noteId, e.message);
          popQueue();
          break;
        }
      }
      break;
    } finally {
      state.inFlight--;
    }
  }
  renderTopbar();
  renderNote();
  renderRail();
};

const handleConflict = async (vaultId: string, noteId: string, head: number | null): Promise<void> => {
  const raw = get().vaultKeyRaw[vaultId];
  if (!raw) return;
  try {
    const h = await history(vaultId, noteId);
    const winner = h.revisions[0];
    if (!winner) return;
    const bytes = await blob(vaultId, winner.rev);
    const plain = await decryptBlob(raw, bytes);
    if (!plain) return;
    const notes = notesOf();
    const mine = notes.find((n) => n.id === noteId);
    if (!mine) return;
    const deviceName = session.device?.name ?? 'this device';
    const copy: Note = {
      ...mine, id: uuid(), title: `${mine.title || 'Untitled'} (conflict copy, ${deviceName})`, createdAt: Date.now(),
    };
    const next = notes.map((n) => (n.id === noteId ? { ...plain, id: noteId, createdAt: n.createdAt } : n));
    next.push(copy);
    setNotes(next);
    setHead(noteId, head !== null ? head : winner.rev);
    setBadge(noteId, 'conflict');
    save({ conflictCopies: { ...get().conflictCopies, [noteId]: copy.id } });
    popQueue();
  } catch {
    // the next pull retries
  }
  render();
};

const pullOnce = async (): Promise<void> => {
  if (nb.current.kind !== 'vault' || !session.device?.approved) return;
  const vaultId = (nb.current as VaultNotebook).vaultId;
  const raw = get().vaultKeyRaw[vaultId];
  if (!raw) return;
  const cur = await cursor(vaultId).catch(() => null);
  if (!cur) return;
  const res = await pullRevisions(vaultId, cur.cursor).catch(() => null);
  if (!res || !res.revisions.length) return;
  const notes = [...notesOf()];
  let changed = false;
  for (const rev of res.revisions) {
    if (rev.device_id === session.device?.id) { setHead(rev.note_id, rev.rev); continue; }
    try {
      const bytes = await blob(vaultId, rev.rev);
      const plain = await decryptBlob(raw, bytes);
      if (!plain) continue;
      const idx = notes.findIndex((n) => n.id === rev.note_id);
      const restored: Note = { ...plain, id: rev.note_id, createdAt: idx >= 0 ? notes[idx].createdAt : Date.now() };
      if (idx >= 0) notes[idx] = restored;
      else notes.push(restored);
      setHead(rev.note_id, rev.rev);
      changed = true;
    } catch {
      // the next pull retries
    }
  }
  if (changed) {
    setNotes(notes);
    render();
  }
};

// ---------- render ----------

const render = (): void => {
  renderTopbar();
  renderRail();
  renderNote();
  renderContext();
};

const syncStatusText = (): { text: string; pulse: boolean } => {
  const q = get().queue.length;
  if (!session.account) return { text: 'Local only — not syncing', pulse: false };
  if (session.device && !session.device.approved) return { text: 'Waiting for device approval — check your email', pulse: false };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { text: `Offline — ${q} queued`, pulse: false };
  if (state.storageOutage) return { text: `sync paused: storage unavailable — ${q} queued`, pulse: false };
  if (state.readOnly) return { text: 'Vault is read-only — Sync has lapsed', pulse: false };
  if (state.inFlight > 0) return { text: `Syncing — ${q} queued`, pulse: true };
  return { text: q > 0 ? `Syncing — ${q} queued` : 'All changes synced', pulse: q > 0 };
};

const renderTopbar = (): void => {
  const st = syncStatusText();
  $('#sync-status').textContent = (st.pulse ? '● ' : '') + st.text;
};

const renderRail = (): void => {
  const tree = $('#notes-tree');
  tree.textContent = '';
  const notes = notesOf();
  for (const n of notes) {
    const li = el('li', { role: 'treeitem' });
    const btn = el('button', { type: 'button' }) as HTMLButtonElement;
    btn.setAttribute('aria-selected', String(n.id === get().openNoteId));
    const conflictPending = get().conflictCopies[n.id] !== undefined && !get().dismissedConflicts.includes(n.id);
    if (conflictPending) {
      const mark = el('span', { class: 'conflict-mark', 'aria-hidden': 'true' });
      mark.innerHTML = icons.scissors;
      btn.appendChild(mark);
    }
    btn.appendChild(el('span', { class: 't' }, n.title === '' ? 'Untitled' : n.title));
    btn.appendChild(el('span', { class: `badge ${badgeText(n).replace(' ', '-')}` }, badgeText(n)));
    btn.addEventListener('click', () => {
      save({ openNoteId: n.id });
      state.mode = 'edit';
      render();
    });
    if (n.id === get().openNoteId) btn.classList.add('open');
    li.appendChild(btn);
    tree.appendChild(li);
  }
  $('#sample-btn').style.display = notes.length === 0 ? '' : 'none';
  const nbSel = $('#notebook-select') as HTMLSelectElement;
  const prev = nbSel.value;
  nbSel.textContent = '';
  nbSel.appendChild(el('option', { value: 'local' }, 'Local notebook'));
  for (const v of session.vaults) {
    nbSel.appendChild(el('option', { value: v.id }, session.unlockedVaults.has(v.id) ? v.name : `${v.name} · locked`));
  }
  nbSel.value = prev === 'local' || session.vaults.some((v) => v.id === prev) ? prev : 'local';
};

const resolveWikilink = (target: string): Note | undefined => {
  const t = target.trim().toLowerCase();
  return notesOf().find((n) => n.title.trim().toLowerCase() === t || n.aliases.some((a) => a.trim().toLowerCase() === t));
};

const renderNote = (): void => {
  const note = notesOf().find((n) => n.id === get().openNoteId) ?? null;
  const titleInput = $('#note-title') as HTMLInputElement;
  const bodyInput = $('#note-body') as HTMLTextAreaElement;
  const badge = $('#note-sync-status');
  const pinBtn = $('#pin-btn') as HTMLButtonElement;
  const readBtn = $('#read-btn') as HTMLButtonElement;
  const rejectNote = $('#reject-note');
  const conflictRegion = $('#conflict-region');
  if (!note) {
    titleInput.value = '';
    bodyInput.value = '';
    badge.textContent = 'local only';
    pinBtn.setAttribute('aria-pressed', 'false');
    pinBtn.classList.remove('pinned');
    conflictRegion.hidden = true;
    rejectNote.textContent = '';
    return;
  }
  titleInput.value = note.title;
  bodyInput.value = note.body;
  badge.textContent = badgeText(note);
  const rej = rejects()[note.id];
  rejectNote.textContent = rej ? `This revision was rejected: ${rej}` : '';
  pinBtn.setAttribute('aria-pressed', String(note.private));
  pinBtn.classList.toggle('pinned', note.private);
  pinBtn.innerHTML = `${note.private ? icons.lock : ''} Private`;
  readBtn.textContent = state.mode === 'edit' ? 'Read' : 'Edit';
  const showConflict = get().conflictCopies[note.id] !== undefined && !get().dismissedConflicts.includes(note.id);
  conflictRegion.hidden = !showConflict;
  const bodyWrap = $('#body-wrap');
  bodyWrap.textContent = '';
  if (state.mode === 'edit') {
    bodyInput.style.display = '';
    bodyWrap.appendChild(bodyInput);
  } else {
    bodyInput.style.display = 'none';
    const reading = el('div', { class: 'reading' });
    reading.innerHTML = renderBody(note.body, (label, target) => {
      const t = resolveWikilink(target);
      if (!t) return null;
      return `<span class="wikilink" data-note="${t.id}">${escapeHtml(label ?? t.title)}</span>`;
    });
    for (const link of Array.from(reading.querySelectorAll<HTMLElement>('.wikilink'))) {
      link.addEventListener('click', () => {
        save({ openNoteId: link.getAttribute('data-note') });
        state.mode = 'edit';
        render();
        ($('#note-title') as HTMLInputElement).focus();
      });
    }
    bodyWrap.appendChild(reading);
  }
};

const renderContext = (): void => {
  const tab = ctx.tab;
  $('#tab-backlinks').setAttribute('aria-selected', String(tab === 'Backlinks'));
  $('#tab-history').setAttribute('aria-selected', String(tab === 'History'));
  $('#tab-graph').setAttribute('aria-selected', String(tab === 'Graph'));
  $('#tab-publish').setAttribute('aria-selected', String(tab === 'Publish'));
  for (const id of ['backlinks-panel', 'history-panel', 'graph-panel', 'publish-panel']) $(`#${id}`).hidden = true;
  const note = notesOf().find((n) => n.id === get().openNoteId);
  if (tab === 'Backlinks') {
    $('#backlinks-panel').hidden = false;
    const list = $('#backlinks');
    list.textContent = '';
    if (note) {
      for (const n of notesOf()) {
        if (n.id === note.id) continue;
        const linked = linkTargets(n.body).some((raw) => {
          const { target } = splitTarget(raw);
          return resolveWikilink(target)?.id === note.id;
        });
        if (linked) {
          const li = el('li');
          const a = el('a', { href: '#' }, n.title || 'Untitled');
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            save({ openNoteId: n.id });
            render();
          });
          li.appendChild(a);
          list.appendChild(li);
        }
      }
    }
  } else if (tab === 'History') {
    $('#history-panel').hidden = false;
    const list = $('#revisions');
    list.textContent = '';
    const status = $('#history-status');
    if (nb.current.kind === 'vault' && note) {
      const vaultId = (nb.current as VaultNotebook).vaultId;
      history(vaultId, note.id).then((h) => {
        for (const r of h.revisions) {
          const li = el('li');
          li.appendChild(el('span', { class: 'rev' }, `r${r.rev}`));
          if (r.restored_from !== null) li.appendChild(el('span', {}, `restored from r${r.restored_from}`));
          li.appendChild(el('span', {}, r.device_name));
          li.appendChild(el('span', { class: 'when' }, fmt(r.created_at)));
          const btn = el('button', { type: 'button' }, `Restore r${r.rev}`) as HTMLButtonElement;
          btn.addEventListener('click', () => openRestoreDialog(r.rev));
          li.appendChild(btn);
          list.appendChild(li);
        }
        status.textContent = h.revisions.length ? '' : 'No revisions yet.';
      }).catch(() => {
        status.textContent = '';
      });
    } else {
      status.textContent = 'History appears for synced notes.';
    }
  } else if (tab === 'Graph') {
    $('#graph-panel').hidden = false;
    renderGraph();
  } else {
    $('#publish-panel').hidden = false;
    void renderPublish();
  }
};

const renderGraph = (): void => {
  const canvas = $('#graph-canvas') as HTMLCanvasElement;
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.clientWidth || 320;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = 320 * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0b0e11';
  g.fillRect(0, 0, w, 320);
  const cx = w / 2;
  const cy = 160;
  const notes = notesOf();
  const root = notes.find((n) => n.id === get().openNoteId);
  if (!root) return;
  const manifest = computeManifest({ radius: 4, notes: notes.map(noteToCandidate) });
  const hopMap = new Map(manifest.inside.map((i) => [i.note_id, i.hop]));
  const ringR = (h: number) => 30 + h * 34;
  g.strokeStyle = '#232a32';
  for (let h = 1; h <= 4; h++) {
    g.beginPath();
    g.arc(cx, cy, ringR(h), 0, Math.PI * 2);
    g.stroke();
  }
  const byHop = new Map<number, Note[]>();
  for (const n of notes) {
    if (n.id === root.id) continue;
    const h = hopMap.get(n.id);
    if (h === undefined) continue;
    if (!byHop.has(h)) byHop.set(h, []);
    (byHop.get(h) as Note[]).push(n);
  }
  const angle = new Map<string, number>();
  for (const list of byHop.values()) {
    list.forEach((n, i) => angle.set(n.id, (2 * Math.PI * i) / list.length));
  }
  const pos = (n: Note): [number, number] => {
    if (n.id === root.id) return [cx, cy];
    const h = hopMap.get(n.id) ?? 1;
    const a = angle.get(n.id) ?? 0;
    return [cx + ringR(h) * Math.cos(a), cy + ringR(h) * Math.sin(a)];
  };
  g.strokeStyle = '#3a434d';
  for (const n of notes) {
    const [x1, y1] = pos(n);
    for (const raw of linkTargets(n.body)) {
      const { target } = splitTarget(raw);
      const t = resolveWikilink(target);
      if (!t) continue;
      const [x2, y2] = pos(t);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
  }
  for (const n of notes) {
    const [x, y] = pos(n);
    g.beginPath();
    g.arc(x, y, n.id === root.id ? 8 : 5, 0, Math.PI * 2);
    g.fillStyle = n.id === root.id ? '#e0a030' : n.private ? '#5a5348' : '#8d8578';
    g.fill();
  }
};

// ---------- publish workbench ----------

const renderPublish = async (): Promise<void> => {
  const addr = $('#dossier-address') as HTMLInputElement;
  const stateStatus = $('#dossier-state');
  const startBtn = $('#start-dossier-btn') as HTMLButtonElement;
  const takeBtn = $('#takedown-btn') as HTMLButtonElement;
  const reopenBtn = $('#reopen-btn') as HTMLButtonElement;
  const publishBtn = $('#publish-btn') as HTMLButtonElement;
  const workbench = $('#workbench-main');
  const openNote = notesOf().find((n) => n.id === get().openNoteId);
  const mine = session.dossiers.find((d) => d.root_note_id === get().openNoteId) ?? wb.dossier;
  if (mine) wb.dossier = mine;
  if (mine) {
    addr.value = mine.slug;
    stateStatus.textContent = mine.state === 'in_review' ? 'In review'
      : mine.state.charAt(0).toUpperCase() + mine.state.slice(1);
    workbench.hidden = false;
    startBtn.hidden = true;
    if (mine.radius !== null) ring.radius = mine.radius;
    const cands = candidatesFor(notesOf(), mine.root_note_id);
    const counts = countsAt(cands, ring.radius);
    $('#exposure-counts').textContent = `notes public ${counts.public_count} · links severed ${counts.severed_count}`;
    ($('#ring-slider') as HTMLInputElement).value = String(ring.radius);
    for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="hop"]'))) r.checked = Number(r.value) === ring.radius;
    $('#slider-value').textContent = `Hop ${ring.radius}`;
    renderRingCanvas(mine.root_note_id, cands);
    renderLivePreview(mine.root_note_id, cands);
    takeBtn.hidden = mine.state !== 'published';
    reopenBtn.hidden = !(mine.state === 'unpublished' || mine.state === 'lapsed');
    $('#revoke-preview-btn').hidden = !mine.preview_link;
    await refreshBoundaryCheck(mine);
  } else {
    workbench.hidden = true;
    stateStatus.textContent = 'Draft';
    startBtn.hidden = !openNote;
    if (openNote) startBtn.textContent = `Start a dossier from “${openNote.title || 'Untitled'}”`;
  }
  publishBtn.disabled = checkState.value !== 'match';
};

const renderRingCanvas = (rootId: string, cands: Note[]): void => {
  const canvas = $('#ring-canvas') as HTMLCanvasElement;
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.clientWidth || 340;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = 340 * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, 340);
  const cx = w / 2;
  const cy = 170;
  const ringR = (h: number) => 32 + h * 33;
  const manifest = computeManifest({ radius: 4, notes: cands.map(noteToCandidate) });
  const hopMap = new Map(manifest.inside.map((i) => [i.note_id, i.hop]));
  const now = computeManifest({ radius: ring.radius, notes: cands.map(noteToCandidate) });
  const insideIds = new Set(now.inside.map((i) => i.note_id));
  const byHop = new Map<number, Note[]>();
  for (const note of cands) {
    if (note.id === rootId) continue;
    const h = hopMap.get(note.id);
    if (h === undefined || note.private) continue;
    if (!byHop.has(h)) byHop.set(h, []);
    (byHop.get(h) as Note[]).push(note);
  }
  const angle = new Map<string, number>();
  for (const [h, list] of byHop) {
    list.sort((a, b) => (a.title < b.title ? -1 : 1));
    list.forEach((note, i) => angle.set(note.id, (2 * Math.PI * i) / list.length + (h % 2) * 0.4));
  }
  const pos = (note: Note): [number, number] => {
    if (note.id === rootId) return [cx, cy];
    const h = hopMap.get(note.id) ?? 1;
    const a = angle.get(note.id) ?? 0;
    return [cx + ringR(h) * Math.cos(a), cy + ringR(h) * Math.sin(a)];
  };
  g.strokeStyle = '#232a32';
  for (let h = 1; h <= 4; h++) {
    g.beginPath();
    g.arc(cx, cy, ringR(h), 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = '#e0a030';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(cx, cy, ringR(ring.radius), 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const src of cands) {
    const [x1, y1] = pos(src);
    for (const raw of linkTargets(src.body)) {
      const { target } = splitTarget(raw);
      const t = cands.find((nn) => nn.title.trim().toLowerCase() === target.trim().toLowerCase()
        || nn.aliases.some((a) => a.trim().toLowerCase() === target.trim().toLowerCase()));
      if (!t) continue;
      const [x2, y2] = pos(t);
      const both = insideIds.has(src.id) && insideIds.has(t.id) && !t.private;
      if (both) {
        g.strokeStyle = '#e0a030';
        g.setLineDash([]);
      } else {
        g.strokeStyle = '#c4543f';
        g.setLineDash(reduced ? [4, 4] : []);
      }
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      if (!both) {
        g.fillStyle = '#c4543f';
        g.fillText('✂', (x1 + x2) / 2 - 4, (y1 + y2) / 2 + 4);
      }
    }
  }
  g.setLineDash([]);
  for (const note of cands) {
    const [x, y] = pos(note);
    const inside = insideIds.has(note.id);
    g.beginPath();
    g.arc(x, y, note.id === rootId ? 9 : 6, 0, Math.PI * 2);
    g.fillStyle = inside ? '#e0a030' : note.private ? '#5a5348' : '#3a434d';
    g.fill();
    if (inside) {
      g.fillStyle = '#0b0e11';
      g.fillText('✓', x - 3, y + 3);
    }
    if (note.private) {
      g.fillStyle = '#8d8578';
      g.fillText('🔒', x - 6, y - 8);
    }
  }
};

const renderLivePreview = (rootId: string, cands: Note[]): void => {
  const frame = $('#live-preview');
  frame.textContent = '';
  const root = cands.find((c) => c.id === rootId);
  if (!root) return;
  const manifest = computeManifest({ radius: ring.radius, notes: cands.map(noteToCandidate) });
  const insideIds = new Set(manifest.inside.map((i) => i.note_id));
  frame.appendChild(el('h2', {}, root.title || 'Untitled'));
  const div = el('div');
  div.innerHTML = renderBody(root.body, (label, target) => {
    const t = cands.find((nn) => nn.title.trim().toLowerCase() === target.trim().toLowerCase()
      || nn.aliases.some((a) => a.trim().toLowerCase() === target.trim().toLowerCase()));
    if (!t || !insideIds.has(t.id)) return null;
    return `<a>${escapeHtml(label ?? t.title)}</a>`;
  });
  frame.appendChild(div);
};

const refreshBoundaryCheck = async (d: Dossier): Promise<void> => {
  const token = ++hopToken;
  const checkLine = $('#boundary-check');
  checkState.value = 'pending';
  checkLine.textContent = 'Checking boundary…';
  checkLine.className = 'check-line';
  const cands = candidatesFor(notesOf(), d.root_note_id);
  const local = countsAt(cands, ring.radius);
  try {
    const res = await manifestPreview(d.id, ring.radius, cands.map(noteToCandidate));
    if (token !== hopToken) return;
    if (res.public_count === local.public_count && res.severed_count === local.severed_count) {
      checkState.value = 'match';
      checkLine.textContent = `Server boundary matches: ${res.public_count} public · ${res.severed_count} severed`;
      checkLine.className = 'check-line match';
    } else {
      checkState.value = 'mismatch';
      checkLine.textContent = 'Server boundary differs — publishing is blocked until it matches';
      checkLine.className = 'check-line mismatch';
    }
  } catch {
    if (token !== hopToken) return;
    checkState.value = 'fail';
    checkLine.textContent = 'Boundary check unavailable — try again';
  }
  ($('#publish-btn') as HTMLButtonElement).disabled = checkState.value !== 'match';
};

const setRingRadius = (next: number): void => {
  ring.radius = Math.max(0, Math.min(4, next));
  const d = wb.dossier;
  const cands = d ? candidatesFor(notesOf(), d.root_note_id) : [];
  const counts = countsAt(cands, ring.radius);
  $('#exposure-counts').textContent = `notes public ${counts.public_count} · links severed ${counts.severed_count}`;
  ($('#ring-slider') as HTMLInputElement).value = String(ring.radius);
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="hop"]'))) r.checked = Number(r.value) === ring.radius;
  $('#slider-value').textContent = `Hop ${ring.radius}`;
  $('#boundary-announcement').textContent = `Hop ${ring.radius}: ${counts.public_count} notes public, ${counts.severed_count} links severed`;
  if (d && cands.length) {
    renderRingCanvas(d.root_note_id, cands);
    renderLivePreview(d.root_note_id, cands);
    void refreshBoundaryCheck(d);
  }
};

// ---------- dialogs ----------

const openDialog = (id: string, opener: HTMLElement | null): void => {
  const dlg = $(`#${id}`);
  dlg.hidden = false;
  focusReturn = opener;
  const first = dlg.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]');
  (first ?? dlg).focus();
  if (dlg.dataset.trapped !== 'true') {
    dlg.dataset.trapped = 'true';
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(dlg.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'))
        .filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
      if (!focusables.length) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    });
  }
};
const closeDialog = (id: string): void => {
  $(`#${id}`).hidden = true;
  if (focusReturn) {
    focusReturn.focus();
    focusReturn = null;
  }
};

const openRestoreDialog = (rev: number): void => {
  $('#restore-copy').textContent = `Restore r${rev} as a new revision?`;
  const status = $('#restore-status');
  status.textContent = '';
  $('#restore-btn').onclick = async () => {
    status.textContent = `Restoring r${rev}…`;
    if (nb.current.kind !== 'vault' || !get().openNoteId) return;
    const vaultId = (nb.current as VaultNotebook).vaultId;
    const noteId = get().openNoteId as string;
    const head = heads()[noteId] ?? null;
    try {
      const res = await restoreRevision(vaultId, noteId, rev, head, newIdemKey());
      setHead(noteId, res.revision.rev);
      status.textContent = `Restored r${rev} as r${res.revision.rev}`;
      const bytes = await blob(vaultId, res.revision.rev);
      const raw = get().vaultKeyRaw[vaultId];
      const plain = await decryptBlob(raw, bytes);
      if (plain) {
        const notes = notesOf();
        const idx = notes.findIndex((n) => n.id === noteId);
        if (idx >= 0) {
          const next = [...notes];
          next[idx] = { ...next[idx], title: plain.title, aliases: plain.aliases, frontmatter: plain.frontmatter, body: plain.body, private: plain.private };
          setNotes(next);
        }
      }
      closeDialog('restore-dialog');
      render();
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.code === 'revision_conflict') status.textContent = 'This note changed on another device. The latest version is loaded — choose a revision again.';
        else if (e.code === 'storage_unavailable') status.textContent = 'Restore paused: storage unavailable. Nothing changed.';
        else status.textContent = e.message;
      }
    }
  };
  $('#restore-cancel').onclick = () => closeDialog('restore-dialog');
  openDialog('restore-dialog', document.activeElement as HTMLElement);
  ($('#restore-btn') as HTMLElement).focus();
};

export {
  $, el, fmt, escapeHtml, session, nb, state, ctx, ring, wb, checkState, hopToken,
  notesOf, setNotes, heads, setHead, rejects, setReject, setBadge, badgeText,
  flushQueue, handleConflict, pullOnce, render, renderTopbar, renderRail, renderNote, renderContext,
  renderPublish, setRingRadius, openDialog, closeDialog, openRestoreDialog, refreshBoundaryCheck,
  renderRingCanvas, renderLivePreview,
};
