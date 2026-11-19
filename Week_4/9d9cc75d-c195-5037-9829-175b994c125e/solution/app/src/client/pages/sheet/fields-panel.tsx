import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { CalculationDef } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import type { DragItem } from './drag.ts';
import { Menu } from './menu.tsx';
import { SHELVES } from './model.ts';
import type { FieldEntry, Shelf } from './model.ts';

interface FieldGroup {
  label: string;
  fields: readonly FieldEntry[];
}

interface FieldsPanelProps {
  groups: readonly FieldGroup[];
  calculations: readonly CalculationDef[];
  /** `menu "Add to shelf"` chose a shelf for a field; `option` is where focus returns */
  onAdd: (field: FieldEntry, shelf: Shelf, option: HTMLElement) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, item: DragItem, label: string) => void;
  onNewCalculation: () => void;
  onEditCalculation: (calculation: CalculationDef) => void;
}

/** `data-field-option` of an option, so the page can put focus back on it. */
export function optionSelector(key: string): string {
  return `[data-field-option="${CSS.escape(key)}"]`;
}

/**
 * `region "Fields"`: `listbox "Fields"` with one tab stop (arrows move and stop at the ends, Enter or a click opens
 * `menu "Add to shelf"`), each option also a drag source; then `list "Calculations"` and `button "New calculation"`.
 */
export function FieldsPanel({ groups, calculations, onAdd, onDragStart, onNewCalculation, onEditCalculation }: FieldsPanelProps) {
  const headingId = useId();
  const all = groups.flatMap((group) => group.fields);
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState<{ field: FieldEntry; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const activeIndex = Math.min(active, Math.max(0, all.length - 1));

  const optionAt = (index: number) => wrap.current?.querySelectorAll<HTMLElement>('[role="option"]')[index] ?? null;

  const openMenu = (field: FieldEntry, option: HTMLElement) => {
    const top = option.getBoundingClientRect().bottom - (wrap.current?.getBoundingClientRect().top ?? 0);
    setMenu({ field, top });
  };

  const closeMenu = () => {
    const field = menu?.field;
    setMenu(null);
    if (field) wrap.current?.querySelector<HTMLElement>(optionSelector(field.key))?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number, field: FieldEntry) => {
    const move = (to: number) => {
      event.preventDefault();
      const next = Math.min(Math.max(to, 0), all.length - 1);
      setActive(next);
      optionAt(next)?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu(field, event.currentTarget);
    }
  };

  let index = -1;
  return (
    <section className="sheet-panel fields-panel" aria-labelledby={headingId} data-region="Fields" tabIndex={-1}>
      <h2 id={headingId} className="panel-title">
        Fields
      </h2>
      <div className="fields-wrap" ref={wrap}>
        <div role="listbox" aria-label="Fields" className="field-list">
          {groups.map((group) =>
            group.fields.length === 0 ? null : (
              <div key={group.label} role="group" aria-label={group.label} className="field-group">
                <p className="field-group-title" aria-hidden="true">
                  {group.label}
                </p>
                {group.fields.map((field) => {
                  index += 1;
                  const mine = index;
                  return (
                    <div
                      key={field.key}
                      role="option"
                      aria-selected={mine === activeIndex}
                      aria-label={`${field.name}, ${field.kind}`}
                      tabIndex={mine === activeIndex ? 0 : -1}
                      data-field-option={field.key}
                      className={`field-chip field-chip-${field.kind}`}
                      onFocus={() => setActive(mine)}
                      onKeyDown={(event) => onKeyDown(event, mine, field)}
                      onPointerDown={(event) => onDragStart(event, { kind: 'field', name: field.key }, field.name)}
                      onClick={(event) => {
                        setActive(mine);
                        openMenu(field, event.currentTarget);
                      }}
                    >
                      <span className="field-chip-mark" aria-hidden="true" />
                      <span className="field-chip-text">{field.name}</span>
                    </div>
                  );
                })}
              </div>
            ),
          )}
        </div>
        {menu ? (
          <div className="menu-anchor" style={{ top: menu.top }}>
            <Menu
              name="Add to shelf"
              items={SHELVES.map((shelf) => ({
                label: shelf,
                onChoose: () => {
                  const option = wrap.current?.querySelector<HTMLElement>(optionSelector(menu.field.key));
                  setMenu(null);
                  if (option) onAdd(menu.field, shelf, option);
                },
              }))}
              onClose={closeMenu}
            />
          </div>
        ) : null}
      </div>
      <div className="calc-row">
        <ul aria-label="Calculations" className="calc-list">
          {calculations.map((calculation) => (
            <li key={calculation.id}>
              <Button compact onClick={() => onEditCalculation(calculation)}>
                Edit {calculation.name}
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="primary" compact onClick={onNewCalculation}>
          New calculation
        </Button>
      </div>
    </section>
  );
}
