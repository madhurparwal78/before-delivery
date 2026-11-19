import { el } from '../lib/dom.js';
import { api, errorOf } from '../lib/api.js';
import type { VersionSnapshot, VersionInfo } from '../../shared/types.js';
import { may } from '../../shared/permissions.js';

/**
 * The read-only version view with the diff summary and restore.
 */

export async function renderVersionView(root: HTMLElement, mapId: string, versionId: string, query: URLSearchParams): Promise<void> {
  const res = await api<{ version: VersionInfo; snapshot: VersionSnapshot | null }>(`/api/maps/${mapId}/versions/${versionId}`);
  const me = await api<{ user: { username: string } }>('/api/me');
  if (!res.ok) {
    root.replaceChildren();
    const page = el('main', { class: 'auth-form' });
    page.appendChild(el('h1', {}, "We couldn't find that map."));
    root.appendChild(page);
    return;
  }
  const data = res.body as { version: VersionInfo; snapshot: VersionSnapshot | null };
  const username = me.ok ? (me.body as { user: { username: string } }).user.username : null;
  const mapRes = await api<{ map: { owner: string; role: string } }>(`/api/maps/${mapId}`);
  const role = mapRes.ok ? (mapRes.body as { map: { role: string } }).map.role : 'viewer';

  root.replaceChildren();
  const bar = el('div', { class: 'versionbar' });
  bar.appendChild(el('span', {}, `This is version ${data.version.number}. Read only.`));
  const compare = el('select', { 'aria-label': 'Compare with' }) as HTMLSelectElement;
  compare.append(el('option', { value: '' }, 'Compare with'));
  const versionsRes = await api<{ versions: VersionInfo[] }>(`/api/maps/${mapId}/versions`);
  const versions = versionsRes.ok ? (versionsRes.body as { versions: VersionInfo[] }).versions : [];
  for (const v of versions) {
    if (v.id !== versionId) compare.append(el('option', { value: v.id }, `Version ${v.number} by ${v.by}`));
  }
  bar.appendChild(compare);
  const changes = el('div', { class: 'panel', role: 'region', 'aria-label': 'Changes', hidden: '' });
  const removedList = el('ul', { role: 'list', 'aria-label': 'Removed topics' });
  changes.appendChild(removedList);
  bar.appendChild(changes);
  if (may(role as 'owner', 'restore')) {
    const restore = el('button', { class: 'primary', 'aria-label': 'Restore this version' }, 'Restore this version');
    restore.addEventListener('click', async () => {
      restore.textContent = '';
      restore.appendChild(el('span', { class: 'spinner' }, ''));
      const out = await api(`/api/maps/${mapId}/versions/${versionId}/restore`, 'POST');
      if (out.ok) {
        const body = out.body as { version?: { number: number } };
        if (body.version) location.href = `/m/${mapId}`;
      } else {
        restore.textContent = 'Restore this version';
        const err = errorOf(out);
        const notice = el('div', { class: 'error-band' });
        notice.appendChild(el('h3', {}, err.message));
        root.prepend(notice);
      }
    });
    bar.appendChild(restore);
  }
  root.appendChild(bar);

  // Draw the snapshot read-only.
  const wrap = el('div', { class: 'canvas-wrap', style: 'height:calc(100dvh - 56px)' });
  const canvas = el('div', { class: 'canvas', role: 'region', 'aria-label': 'Canvas' });
  const stage = el('div', { class: 'stage', 'data-zoom': '1', 'data-pan-x': '0', 'data-pan-y': '0', 'data-layout': data.snapshot?.layout ?? 'map', 'data-revision': String(data.version.revision) });
  canvas.appendChild(stage);
  wrap.appendChild(canvas);
  root.appendChild(wrap);

  const snapshot = data.snapshot;
  const diffIds = new Set<string>();
  if (snapshot) {
    const { layoutMap } = await import('../../shared/layout.js');
    const topics = snapshot.topics.map((t) => ({ ...t, comment_count: 0, vote_count: 0, voted: false, lock_inherited: false, derived: { colour: 'accent', shape: 'pill', text: 'ink', percent: null, earliest_due: null, overdue: false, blocked_by: [], blocked_count: 0, subtopics: 0 } }));
    const layout = layoutMap(topics as never, snapshot.layout, new Set());
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, b] of layout.boxes) {
      diffIds.add(id);
      minX = Math.min(minX, b.x - b.w / 2); minY = Math.min(minY, b.y - b.h / 2);
      maxX = Math.max(maxX, b.x + b.w / 2); maxY = Math.max(maxY, b.y + b.h / 2);
      const t = snapshot.topics.find((x) => x.id === id)!;
      const node = el('div', {
        class: 'topic', 'data-topic-id': id,
        'data-x': String(b.x), 'data-y': String(b.y), 'data-w': String(b.w), 'data-h': String(b.h),
        'data-side': layout.sides.get(id) ?? 'none', 'data-colour': 'accent', 'data-shape': 'pill', 'data-text': 'ink',
        'data-icon': t.icon ?? '', 'data-dim': 'false', 'data-diff': query.get('compare') ? 'edited' : '',
        'data-drop-target': 'false', 'data-percent': '',
      }, t.title);
      node.style.left = `${b.x - b.w / 2}px`;
      node.style.top = `${b.y - b.h / 2}px`;
      node.style.width = `${b.w}px`;
      node.style.height = `${b.h}px`;
      stage.appendChild(node);
      if (t.parent_id) {
        const pb = layout.boxes.get(t.parent_id);
        if (pb) {
          const connector = el('div', { class: 'connector', 'data-connector': id });
          const len = Math.hypot(b.x - b.w / 2 - pb.x, b.y - pb.y);
          connector.style.left = `${pb.x}px`;
          connector.style.top = `${pb.y}px`;
          connector.style.width = `${len}px`;
          connector.style.transform = `rotate(${Math.atan2(b.y - pb.y, b.x - b.w / 2 - pb.x)}rad)`;
          stage.appendChild(connector);
        }
      }
    }
    if (minX !== Infinity) {
      const zoom = Math.min(1, (canvas.clientWidth - 96) / Math.max(1, maxX - minX), (canvas.clientHeight - 96) / Math.max(1, maxY - minY));
      const panX = canvas.clientWidth / 2 - (minX + maxX) / 2 * zoom;
      const panY = canvas.clientHeight / 2 - (minY + maxY) / 2 * zoom;
      stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      stage.setAttribute('data-zoom', zoom.toFixed(4));
      stage.setAttribute('data-pan-x', panX.toFixed(2));
      stage.setAttribute('data-pan-y', panY.toFixed(2));
    }
  }

  compare.addEventListener('change', async () => {
    if (!compare.value) { changes.hidden = true; return; }
    const diffRes = await api<{ added: string[]; removed: string[]; moved: string[]; edited: string[]; summary: string }>(`/api/maps/${mapId}/versions/diff?from=${versionId}&to=${compare.value}`);
    if (!diffRes.ok) return;
    const diff = diffRes.body as { added: string[]; removed: string[]; moved: string[]; edited: string[]; summary: string };
    changes.hidden = false;
    changes.replaceChildren(el('h3', {}, diff.summary));
    removedList.replaceChildren();
    for (const id of diff.removed) {
      const t = snapshot?.topics.find((x) => x.id === id);
      removedList.appendChild(el('li', { 'data-diff': 'removed' }, t?.title ?? id));
    }
    for (const node of [...stage.querySelectorAll('[data-topic-id]')] as HTMLElement[]) {
      const id = node.getAttribute('data-topic-id') ?? '';
      const d = diff.added.includes(id) ? 'added' : diff.edited.includes(id) ? (diff.moved.includes(id) ? 'moved edited' : 'edited') : diff.moved.includes(id) ? 'moved' : '';
      node.setAttribute('data-diff', d);
    }
  });

  void query;
}
