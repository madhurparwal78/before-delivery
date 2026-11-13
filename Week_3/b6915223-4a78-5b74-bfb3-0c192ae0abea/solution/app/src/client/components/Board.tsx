import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { Position } from "../../shared/api.ts";
import { POSITION_WORD } from "../format.ts";
import { type Badge, Kit, Shirt, type ShirtData } from "./Shirt.tsx";

// The pitch (or list) of fifteen shirts. One Tab stop; arrows move between rows, Home and End jump
// to the ends of a row (brief: Interactions / Pick Team pitch and list).

interface Slot {
  key: string;
  position: Position;
}

export type BoardItem = { kind: "shirt"; shirt: ShirtData } | { kind: "slot"; slot: Slot };

export interface BoardRow {
  key: string;
  bench?: boolean;
  items: BoardItem[];
}

interface BoardProps {
  view: "pitch" | "list";
  rows: BoardRow[];
  homeKey: string;
  focusKey: string | null;
  onFocusKey: (key: string) => void;
  selected: string | null;
  selectable: boolean;
  pressedOf: (id: string) => boolean;
  pendingKey: string | null;
  badges: Record<string, Badge>;
  onActivate: (key: string) => void;
  onEscape: () => void;
  onArmband?: (kind: "captain" | "vice", key: string) => void;
  actions: ComponentChildren;
  builder?: boolean;
}

// Rows top to bottom: forwards, midfielders, defenders, then the goalkeeper nearest the goal.
export function pitchRows<T extends { position: string }>(starters: T[], bench: T[]): { field: T[][]; bench: T[] } {
  return { field: ["FWD", "MID", "DEF", "GK"].map((position) => starters.filter((p) => p.position === position)), bench };
}

const itemKey = (item: BoardItem) => (item.kind === "shirt" ? item.shirt.id : item.slot.key);

function PitchLines() {
  return (
    <svg class="pitch-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((band) => (
        <rect x="0" y={band * 12.5} width="100" height="12.5" fill={band % 2 ? "var(--turf-alt)" : "var(--turf)"} />
      ))}
      <g fill="none" stroke="var(--chalk-line)" stroke-width="0.6" vector-effect="non-scaling-stroke">
        <rect x="2" y="2" width="96" height="96" vector-effect="non-scaling-stroke" />
        <line x1="2" y1="2" x2="98" y2="2" vector-effect="non-scaling-stroke" />
        <path d="M34 2 A16 10 0 0 0 66 2" vector-effect="non-scaling-stroke" />
        <rect x="24" y="80" width="52" height="18" vector-effect="non-scaling-stroke" />
        <rect x="38" y="92" width="24" height="6" vector-effect="non-scaling-stroke" />
        <path d="M40 80 A12 7 0 0 1 60 80" vector-effect="non-scaling-stroke" />
        <rect x="44" y="98" width="12" height="2" vector-effect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

function EmptySlot({ slot, tabIndex }: { slot: Slot; tabIndex: number }) {
  return (
    <div class="shirt empty">
      <button type="button" class="shirt-hit" data-nav={slot.key} aria-label={`Empty ${POSITION_WORD[slot.position]} slot`} tabIndex={tabIndex} />
      <Kit club={null} />
      <span class="name" aria-hidden="true">
        {slot.position}
      </span>
    </div>
  );
}

export function Board(props: BoardProps) {
  const region = useRef<HTMLElement>(null);
  const wantsFocus = useRef(false);
  const keys = props.rows.flatMap((row) => row.items.map(itemKey));
  const tabKey = props.focusKey && keys.includes(props.focusKey) ? props.focusKey : props.homeKey;

  // A shirt that moves rows is drawn anew; keep the keyboard user's focus on it.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (wantsFocus.current && (!active || active === document.body)) {
      region.current?.querySelector<HTMLElement>(`[data-nav="${tabKey}"]`)?.focus();
    }
  });

  const navRows = (): HTMLElement[][] => {
    const root = region.current!;
    if (props.view === "list") return [[...root.querySelectorAll<HTMLElement>("[data-nav]")]];
    return [...root.querySelectorAll<HTMLElement>("[data-nav-row]")]
      .map((row) => [...row.querySelectorAll<HTMLElement>("[data-nav]")])
      .filter((row) => row.length > 0);
  };

  const move = (key: string, target: HTMLElement) => {
    const rows = navRows();
    const r = rows.findIndex((row) => row.includes(target));
    if (r < 0) return false;
    const row = rows[r]!;
    const c = row.indexOf(target);
    const vertical = props.view === "list";
    let next: HTMLElement | undefined;
    if (key === (vertical ? "ArrowDown" : "ArrowRight")) next = row[c + 1];
    else if (key === (vertical ? "ArrowUp" : "ArrowLeft")) next = row[c - 1];
    else if (key === "Home") next = row[0];
    else if (key === "End") next = row[row.length - 1];
    else if (!vertical && (key === "ArrowUp" || key === "ArrowDown")) {
      const other = rows[key === "ArrowUp" ? r - 1 : r + 1];
      if (other) {
        const box = target.getBoundingClientRect();
        const middle = box.left + box.width / 2;
        next = other.reduce((best, candidate) => {
          const centre = (el: HTMLElement) => Math.abs(el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 - middle);
          return centre(candidate) < centre(best) ? candidate : best;
        });
      }
    } else {
      return false;
    }
    next?.focus();
    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-nav]");
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (target && move(event.key, target)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      props.onEscape();
      return;
    }
    const letter = event.key.toLowerCase();
    if (props.onArmband && (letter === "c" || letter === "v")) {
      const key = props.selected ?? target?.dataset.nav;
      if (key) {
        event.preventDefault();
        props.onArmband(letter === "c" ? "captain" : "vice", key);
      }
    }
  };

  const onFocusIn = (event: FocusEvent) => {
    wantsFocus.current = true;
    const key = (event.target as HTMLElement).closest<HTMLElement>("[data-nav]")?.dataset.nav;
    if (key) props.onFocusKey(key);
  };
  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && !region.current?.contains(next)) wantsFocus.current = false;
  };
  const onPointerDownOutside = useRef((event: PointerEvent) => {
    if (!region.current?.contains(event.target as Node)) wantsFocus.current = false;
  });
  useLayoutEffect(() => {
    const listener = onPointerDownOutside.current;
    document.addEventListener("pointerdown", listener, true);
    return () => document.removeEventListener("pointerdown", listener, true);
  }, []);

  const render = (item: BoardItem) => {
    const key = itemKey(item);
    const tabIndex = key === tabKey ? 0 : -1;
    if (item.kind === "slot") return <EmptySlot key={key} slot={item.slot} tabIndex={tabIndex} />;
    return (
      <Shirt
        key={key}
        shirt={item.shirt}
        list={props.view === "list"}
        pressed={props.selectable ? props.pressedOf(key) : null}
        pending={props.pendingKey === key}
        badge={props.badges[key] ?? null}
        tabIndex={tabIndex}
        onActivate={() => props.onActivate(key)}
      />
    );
  };
  const field = props.rows.filter((row) => !row.bench);
  const bench = props.rows.find((row) => row.bench);

  return (
    <section ref={region} class="pitch-region" aria-label="Pitch" onKeyDown={onKeyDown} onFocusIn={onFocusIn} onFocusOut={onFocusOut}>
      <div class="action-slot">{props.actions}</div>
      {props.view === "pitch" ? (
        <>
          <div class={`pitch${props.builder ? " builder" : ""}`}>
            <PitchLines />
            {field.map((row) => (
              <div class="shirt-row" data-nav-row key={row.key}>
                {row.items.map(render)}
              </div>
            ))}
          </div>
          {bench && (
            <div class="bench-tray" role="group" aria-label="Bench">
              <span class="label">Bench</span>
              <div class="shirt-row" data-nav-row>
                {bench.items.map(render)}
              </div>
            </div>
          )}
        </>
      ) : (
        <div class="squad-list">
          <div class="rows">
            <h3>{props.builder ? "Squad" : "Starters"}</h3>
            {[...field].reverse().flatMap((row) => row.items).map(render)}
          </div>
          {bench && (
            <div class="rows" role="group" aria-label="Bench">
              <h3>Bench</h3>
              {bench.items.map(render)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
