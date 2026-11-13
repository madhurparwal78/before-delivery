// The service map: a flat list of treeitems with aria-level, keyed by path so a live redraw never remounts a row.
import { html, useState, useRef, useLayoutEffect } from '../../lib/html.js';
import { Tone } from '../../lib/ui.js';
import { byName } from './data.js';

// visibleRows walks the dependency tree from the services nothing depends on; a closed item hides its children.
function visibleRows(services, closed) {
  const byId = new Map(services.map((s) => [s.id, s]));
  const needed = new Set(services.flatMap((s) => s.depends_on));
  const rows = [];
  const walk = (service, parent, level, position, siblings) => {
    const path = parent ? `${parent.path}/${service.id}` : service.id;
    const children = service.depends_on.map((id) => byId.get(id)).sort(byName);
    const open = !closed.has(path);
    const row = { path, parent: parent?.path ?? null, service, level, position, siblings, children: children.length, open };
    rows.push(row);
    if (open) children.forEach((child, i) => walk(child, row, level + 1, i + 1, children.length));
  };
  const tops = services.filter((s) => !needed.has(s.id)).sort(byName);
  tops.forEach((service, i) => walk(service, null, 1, i + 1, tops.length));
  return rows;
}

export function ServiceTree({ services }) {
  const [closed, setClosed] = useState(() => new Set());
  const [active, setActive] = useState(null);
  const treeRef = useRef(null);
  const focusPath = useRef(null);
  const rows = visibleRows(services, closed);
  const tabStop = rows.some((r) => r.path === active) ? active : rows[0]?.path;

  useLayoutEffect(() => {
    if (!focusPath.current) return;
    const item = [...treeRef.current.children].find((el) => el.dataset.path === focusPath.current);
    focusPath.current = null;
    if (item) item.focus();
  });

  const focusRow = (path) => {
    focusPath.current = path;
    setActive(path);
  };
  const setOpen = (path, open) => {
    const next = new Set(closed);
    if (open) next.delete(path);
    else next.add(path);
    setClosed(next);
  };
  const onKeyDown = (event) => {
    const item = event.target.closest('[role="treeitem"]');
    if (!item) return;
    const index = rows.findIndex((r) => r.path === item.dataset.path);
    const row = rows[index];
    const keys = {
      ArrowDown: () => focusRow(rows[Math.min(index + 1, rows.length - 1)].path),
      ArrowUp: () => focusRow(rows[Math.max(index - 1, 0)].path),
      Home: () => focusRow(rows[0].path),
      End: () => focusRow(rows[rows.length - 1].path),
      ArrowRight: () => {
        if (!row.children) return;
        if (row.open) focusRow(rows[index + 1].path);
        else setOpen(row.path, true);
      },
      ArrowLeft: () => {
        if (row.children && row.open) setOpen(row.path, false);
        else if (row.parent) focusRow(row.parent);
      },
      Enter: () => location.assign('/services/' + row.service.id),
    };
    if (!keys[event.key]) return;
    event.preventDefault();
    keys[event.key]();
  };

  return html`<div role="tree" aria-label="Service map" class="service-tree" ref=${treeRef} onKeyDown=${onKeyDown}>
    ${rows.map((row) => html`<div key=${row.path} role="treeitem" class="tree-row" data-path=${row.path}
      data-service=${row.service.name} data-status=${row.service.status} style=${'--depth:' + (row.level - 1)}
      aria-level=${row.level} aria-posinset=${row.position} aria-setsize=${row.siblings}
      aria-expanded=${row.children ? String(row.open) : undefined} tabindex=${row.path === tabStop ? 0 : -1}
      onFocus=${() => setActive(row.path)}>
      <span class="caret" aria-hidden="true" data-has-children=${row.children ? 'true' : 'false'}
        onClick=${() => { if (row.children) { setOpen(row.path, !row.open); focusRow(row.path); } }}>${row.children ? (row.open ? '−' : '+') : ''}</span>
      <span class="svc-name">${row.service.name}</span>
      <${Tone} status=${row.service.status} />
      <span class="svc-team">${row.service.team}</span>
    </div>`)}
  </div>`;
}
