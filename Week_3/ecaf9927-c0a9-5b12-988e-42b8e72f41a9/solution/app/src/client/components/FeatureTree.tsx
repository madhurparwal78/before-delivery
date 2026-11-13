import { useMemo, useState, type KeyboardEvent } from 'react';
import type { Part } from '../../shared/api';
import { formatMass } from '../../shared/units';
import { useWorkbench } from '../workbench';

const chipText = (part: Part, saving: boolean): string =>
  saving ? 'Saving…' : ({ stored: 'Stored', not_stored: 'Not stored', saving: 'Saving…', none: 'No body' } as const)[part.body.status];

interface TreeEntry {
  key: string;
  level: 1 | 2;
  label: string;
  chip?: string;
  note?: string;
  expandable: boolean;
  open: () => void;
  selected: boolean;
  group: string;
  parent?: string;
}

const CHIP_CLASS: Record<string, string> = { Stored: 'stored', 'Not stored': 'not-stored', 'Saving…': 'saving', 'No body': 'none' };

/** The feature tree: assemblies, parts (each expandable to its sketches and extrudes) and purchased parts. */
export function FeatureTree() {
  const wb = useWorkbench();
  const { assemblies, parts, purchased, view, saving, member } = wb;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const toggle = (key: string, force?: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (force === undefined ? next.has(key) : !force) next.delete(key);
      else next.add(key);
      return next;
    });

  const entries = useMemo(() => {
    const list: TreeEntry[] = [];
    const product = wb.workspace?.product.assembly_id;
    for (const a of [...assemblies].sort((x, y) => Number(y.id === product) - Number(x.id === product))) {
      list.push({ key: `assembly:${a.id}`, level: 1, label: a.name, expandable: false, group: 'Assemblies', selected: view?.kind === 'assembly' && view.id === a.id, open: () => void wb.openAssembly(a.id) });
    }
    for (const p of parts) {
      const key = `part:${p.id}`;
      list.push({
        key,
        level: 1,
        label: p.name,
        chip: chipText(p, saving[p.id] === true),
        expandable: true,
        group: 'Parts',
        selected: (view?.kind === 'part' && view.id === p.id && !view.extrudeId) || false,
        open: () => {
          toggle(key, true);
          void wb.openPart(p.id);
        },
      });
      if (expanded.has(key)) {
        for (const s of p.sketches) {
          list.push({ key: `sketch:${s.id}`, level: 2, label: s.name, expandable: false, group: 'Parts', parent: key, selected: view?.kind === 'sketch' && view.id === s.id, open: () => void wb.openSketch(s.id, p.id) });
        }
        for (const f of p.features) {
          list.push({ key: `feature:${f.id}`, level: 2, label: f.name, expandable: false, group: 'Parts', parent: key, selected: view?.kind === 'part' && view.extrudeId === f.id, open: () => void wb.openPart(p.id, f.id) });
        }
      }
    }
    for (const p of purchased) {
      list.push({ key: `purchased:${p.id}`, level: 1, label: p.name, note: formatMass(p.declared_mass_g), expandable: false, group: 'Purchased parts', selected: false, open: () => undefined });
    }
    return list;
  }, [assemblies, parts, purchased, view, saving, expanded]);

  const focusKey = active && entries.some((i) => i.key === active) ? active : (entries.find((i) => i.selected)?.key ?? entries[0]?.key);

  const focusItem = (key: string | undefined) => {
    if (!key) return;
    setActive(key);
    requestAnimationFrame(() => document.getElementById(`tree-${key}`)?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const key = target?.dataset['key'];
    const at = entries.findIndex((i) => i.key === key);
    const item = entries[at];
    if (!item) return;
    const move = (to: number) => {
      event.preventDefault();
      focusItem(entries[Math.max(0, Math.min(entries.length - 1, to))]?.key);
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(at + 1);
      case 'ArrowUp':
        return move(at - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(entries.length - 1);
      case 'ArrowRight':
        event.preventDefault();
        if (item.expandable && !expanded.has(item.key)) toggle(item.key, true);
        else if (item.expandable) focusItem(entries[at + 1]?.key);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (item.expandable && expanded.has(item.key)) toggle(item.key, false);
        else if (item.parent) focusItem(item.parent);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        item.open();
        return;
    }
  };

  const groups = ['Assemblies', 'Parts', 'Purchased parts'];
  return (
    <>
      <ul role="tree" aria-label="Feature tree" className="tree" onKeyDown={onKeyDown}>
        {groups.map((group) => (
          <li key={group} role="none" className="tree-group">
            <h2 className="group-title" aria-hidden="true">
              {group}
            </h2>
            <ul role="group" aria-label={group}>
              {entries
                .filter((i) => i.group === group)
                .map((item) => (
                  <li
                    key={item.key}
                    id={`tree-${item.key}`}
                    data-key={item.key}
                    role="treeitem"
                    aria-level={item.level}
                    aria-selected={item.selected}
                    aria-expanded={item.expandable ? expanded.has(item.key) : undefined}
                    tabIndex={item.key === focusKey ? 0 : -1}
                    className={`tree-item level-${item.level}${item.selected ? ' selected' : ''}`}
                    onClick={() => {
                      setActive(item.key);
                      item.open();
                    }}
                    onFocus={() => setActive(item.key)}
                  >
                    <span className="item-name">{item.label}</span>
                    {item.chip && <span className={`chip ${CHIP_CLASS[item.chip] ?? ''}`}>{item.chip}</span>}
                    {item.note && <span className="num item-note">{item.note}</span>}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      {member?.role === 'founder' && (
        <div className="tree-actions">
          <button type="button" onClick={() => wb.setDialog('part')}>
            New part
          </button>
          <button type="button" onClick={() => wb.setDialog('assembly')}>
            New assembly
          </button>
          <button type="button" onClick={() => wb.setDialog('purchased')}>
            New purchased part
          </button>
        </div>
      )}
    </>
  );
}
