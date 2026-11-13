// The field list, the statistics of the selected field, and the filter pills with their action menu.
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Menu } from "../../lib/menu";
import { Button } from "../../lib/ui";
import { pillLabel, type FieldInfo, type Pill, type PillValue, type Stats } from "./model";

export interface FieldsHandle {
  focus: () => void;
}

interface FieldsProps {
  fields: FieldInfo[];
  selected: string | null;
  stats: Stats | null;
  statsError: string | null;
  onSelect: (field: string) => void;
  onFilter: (field: string, value: PillValue, mode: "include" | "exclude") => void;
}

export const Fields = forwardRef<FieldsHandle, FieldsProps>(function Fields({ fields, selected, stats, statsError, onSelect, onFilter }, handle) {
  const list = useRef<HTMLUListElement>(null);
  useImperativeHandle(handle, () => ({ focus: () => list.current?.querySelector<HTMLElement>("button")?.focus() }));
  return (
    <div className="fields">
      <ul ref={list} aria-label="Fields" className="field-list">
        {fields.map((info) => (
          <li key={info.field} className={selected === info.field ? "selected" : ""}>
            <button type="button" className="field-button" aria-pressed={selected === info.field} aria-label={`Field ${info.field}, ${info.type}`} onClick={() => onSelect(info.field)}>
              <span className="mono field-name">{info.field},</span>{" "}
              <span className="mono field-type">{info.type}</span>
            </button>
            {info.conflict ? <p className="small conflict"><strong>Conflict</strong> {info.conflict}</p> : null}
          </li>
        ))}
      </ul>
      <section role="region" aria-label="Field statistics" className="field-stats">
        {statsError ? <p className="small">{statsError}</p> : null}
        {!stats && !statsError ? <p className="small muted">Select a field to see its top values.</p> : null}
        {stats && !statsError ? (
          <>
            <h3 className="mono">{stats.field}</h3>
            <p className="small mono">In {stats.present} of {stats.total} events</p>
            <table className="data" aria-label="Top values">
              <thead><tr><th scope="col">Value</th><th scope="col" className="num">Count</th><th scope="col" className="num">Share</th></tr></thead>
              <tbody>
                {stats.top.map((row) => (
                  <tr key={String(row.value)}>
                    <td>
                      <span className="mono">{String(row.value)}</span>
                      <div className="row-actions">
                        <Button aria-label={`Include ${row.value}`} onClick={() => onFilter(stats.field, row.value, "include")}>Include</Button>
                        <Button aria-label={`Exclude ${row.value}`} onClick={() => onFilter(stats.field, row.value, "exclude")}>Exclude</Button>
                      </div>
                    </td>
                    <td className="num">{row.count}</td><td className="num">{row.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>
    </div>
  );
});

interface PillsProps {
  pills: Pill[];
  onChange: (pills: Pill[]) => void;
}

export function Pills({ pills, onChange }: PillsProps) {
  const [menu, setMenu] = useState<number | null>(null);
  const anchors = useRef<Array<HTMLButtonElement | null>>([]);
  const act = (index: number, action: "invert" | "toggle" | "remove"): void => {
    const next = pills.flatMap((pill, k): Pill[] => {
      if (k !== index) return [pill];
      if (action === "remove") return [];
      if (action === "invert") return [{ ...pill, mode: pill.mode === "include" ? "exclude" : "include" }];
      return [{ ...pill, enabled: !pill.enabled }];
    });
    onChange(next);
  };
  return (
    <ul aria-label="Filters" className="pills">
      {pills.map((pill, k) => (
        <li key={`${pill.field}:${pill.value}:${k}`} className="menu-host">
          <button
            ref={(element) => { anchors.current[k] = element; }}
            type="button"
            className={`pill pill-${pill.mode}${pill.enabled ? "" : " pill-off"}`}
            aria-haspopup="menu"
            aria-expanded={menu === k}
            aria-label={pillLabel(pill)}
            onClick={() => setMenu(menu === k ? null : k)}
          >
            <span className="mono">{pill.field}: {String(pill.value)}</span>
          </button>
          {menu === k ? (
            <Menu
              label="Filter actions" anchor={{ current: anchors.current[k] ?? null }} onClose={() => setMenu(null)} className="menu-left"
              items={[
                { label: "Invert", onSelect: () => act(k, "invert") },
                { label: pill.enabled ? "Disable" : "Enable", onSelect: () => act(k, "toggle") },
                { label: "Remove", onSelect: () => act(k, "remove") },
              ]}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
