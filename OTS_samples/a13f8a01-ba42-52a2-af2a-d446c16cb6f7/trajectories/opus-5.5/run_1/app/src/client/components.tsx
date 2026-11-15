import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { PenSummary, RenderTicket } from "../shared/types";
import { api } from "./api";
import { formatDate, likesText, versionLabel } from "./format";
import { crossfadeMs, prefersReducedMotion, rovingIndex } from "./hooks";
import { renderBody, type RenderSource } from "./preview";
import { Link } from "./router";

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="radio"]), input[type="radio"]:checked:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.closest("[hidden]") && !element.closest("[inert]"));
}

export function Dialog(props: {
  label: string;
  role?: "dialog" | "alertdialog";
  describedBy?: string;
  onClose: () => void;
  initialFocus?: () => HTMLElement | null;
  returnFocus: () => HTMLElement | null;
  children: ComponentChildren;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const returnRef = useRef(props.returnFocus);
  returnRef.current = props.returnFocus;
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const first = props.initialFocus?.() ?? focusables(container)[0];
    first?.focus();
    return () => returnRef.current()?.focus();
  }, []);
  return (
    <div class="dialog-backdrop">
      <div
        ref={ref}
        role={props.role ?? "dialog"}
        aria-modal="true"
        aria-label={props.label}
        aria-describedby={props.describedBy}
        class={`dialog ${props.class ?? ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeRef.current();
            return;
          }
          if (event.key !== "Tab" || !ref.current) return;
          const items = focusables(ref.current);
          if (items.length === 0) return;
          const index = items.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          event.stopPropagation();
          const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
          items[next]?.focus();
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export interface TabSpec {
  id: string;
  label: string;
  badge?: number;
}

/** A tab list with manual activation: arrows move focus, Enter, Space or a tap selects. */
export function TabList(props: { label: string; tabs: TabSpec[]; selected: string; onSelect: (id: string) => void; idPrefix: string }) {
  const [focused, setFocused] = useState(props.selected);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => setFocused(props.selected), [props.selected]);
  return (
    <div role="tablist" aria-label={props.label} class="tablist">
      {props.tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${props.idPrefix}-tab-${tab.id}`}
          aria-controls={`${props.idPrefix}-panel-${tab.id}`}
          aria-selected={tab.id === props.selected ? "true" : "false"}
          tabIndex={tab.id === props.selected ? 0 : -1}
          class="tab"
          onFocus={() => setFocused(tab.id)}
          onClick={() => props.onSelect(tab.id)}
          onKeyDown={(event) => {
            const position = props.tabs.findIndex((candidate) => candidate.id === focused);
            const next = rovingIndex(event.key, position < 0 ? index : position, props.tabs.length, "horizontal");
            if (next !== null) {
              event.preventDefault();
              const target = props.tabs[next];
              if (target) {
                setFocused(target.id);
                refs.current[target.id]?.focus();
              }
            }
          }}
          ref={(element) => {
            refs.current[tab.id] = element;
          }}
        >
          {tab.label}
          {tab.badge !== undefined && (
            <span class="badge" aria-hidden="true">
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function tabPanelProps(idPrefix: string, id: string, selected: string) {
  return {
    role: "tabpanel" as const,
    id: `${idPrefix}-panel-${id}`,
    "aria-labelledby": `${idPrefix}-tab-${id}`,
    hidden: id !== selected,
  };
}

export interface ComboOption {
  id: string;
  label: string;
}

/** A text box with a filtered list: Down and Up highlight an option, Enter picks it. */
export function Combobox(props: {
  label: string;
  idPrefix: string;
  options: ComboOption[];
  onPick: (option: ComboOption) => void;
  onUnmatched?: (text: string) => void;
  onText?: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const needle = text.trim().toLowerCase();
  const matches = props.options.filter((option) => option.label.toLowerCase().includes(needle));
  const pick = (option: ComboOption) => {
    props.onPick(option);
    setText("");
    setOpen(false);
    setActive(-1);
  };
  const activeOption = open && active >= 0 ? matches[active] : undefined;
  return (
    <div class="combobox">
      <label class="field-label" for={`${props.idPrefix}-input`}>
        {props.label}
      </label>
      <input
        id={`${props.idPrefix}-input`}
        type="text"
        role="combobox"
        aria-expanded={open ? "true" : "false"}
        aria-controls={`${props.idPrefix}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${props.idPrefix}-option-${activeOption.id}` : undefined}
        autocomplete="off"
        value={text}
        onInput={(event) => {
          const value = event.currentTarget.value;
          setText(value);
          setOpen(true);
          setActive(-1);
          props.onText?.(value);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            if (matches.length > 0) setActive((index) => (index + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (matches.length > 0) setActive((index) => (index <= 0 ? matches.length - 1 : index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const exact = matches.find((option) => option.label.toLowerCase() === needle);
            const chosen = activeOption ?? exact ?? (matches.length === 1 && needle !== "" ? matches[0] : undefined);
            if (chosen) pick(chosen);
            else if (needle !== "" && matches.length === 0) props.onUnmatched?.(text.trim());
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      <ul role="listbox" id={`${props.idPrefix}-listbox`} aria-label={props.label} class="listbox" hidden={!open || matches.length === 0}>
        {matches.map((option, index) => (
          <li
            key={option.id}
            id={`${props.idPrefix}-option-${option.id}`}
            role="option"
            aria-selected={index === active ? "true" : "false"}
            class={index === active ? "active" : ""}
            onMouseDown={(event) => {
              event.preventDefault();
              pick(option);
            }}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatePanel({ children }: { children: ComponentChildren }) {
  return <div class="state-panel">{children}</div>;
}

interface StageLayer {
  ticket: RenderTicket;
  shown: boolean;
}

/** The inset stage of list screens: each new render crossfades over the previous one. */
export function StageCrossfade({ source, sourceKey }: { source: RenderSource | null; sourceKey: string }) {
  const [layers, setLayers] = useState<StageLayer[]>([]);
  const request = useRef(0);
  useEffect(() => {
    if (!source) return;
    const current = ++request.current;
    void api<RenderTicket>("POST", "/api/renders", renderBody(source)).then((result) => {
      if (!result.ok || current !== request.current) return;
      const ticket = result.data;
      setLayers((previous) => [...previous.filter((layer) => layer.shown).slice(-1), { ticket, shown: false }]);
    });
  }, [sourceKey]);
  const reveal = (render: string) => {
    const dropOlder = () => setLayers((previous) => previous.slice(Math.max(0, previous.findIndex((layer) => layer.ticket.render === render))));
    setLayers((previous) => previous.map((layer) => (layer.ticket.render === render ? { ...layer, shown: true } : layer)));
    if (prefersReducedMotion()) dropOlder();
    else window.setTimeout(dropOlder, crossfadeMs + 50);
  };
  return (
    <div class="stage-layers" inert>
      {layers.map((layer) => (
        <iframe
          key={layer.ticket.render}
          onLoad={() => reveal(layer.ticket.render)}
          class={`stage-layer${layer.shown ? " shown" : ""}`}
          src={layer.ticket.url}
          title="Stage"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          tabIndex={-1}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function PenRow(props: { pen: PenSummary; showOwner?: boolean; onPreview: (pen: PenSummary) => void; children?: ComponentChildren; onLinkKeyDown?: (event: KeyboardEvent) => void }) {
  const { pen } = props;
  return (
    <li class="pen-row" data-pen-row={pen.id} onMouseEnter={() => props.onPreview(pen)}>
      <Link href={`/pen/${pen.id}`} class="pen-title" onFocus={() => props.onPreview(pen)} onKeyDown={props.onLinkKeyDown}>
        {pen.title}
      </Link>
      {props.showOwner && <span class="pen-owner">{pen.owner}</span>}
      {pen.tags.length > 0 && <span class="pen-tags">{pen.tags.join(" · ")}</span>}
      <span class="pen-meta">
        <span class="figure">{versionLabel(pen.head)}</span>
        <span class="figure">Updated {formatDate(pen.updated_at)}</span>
        <span class="figure">{likesText(pen.likes)}</span>
      </span>
      {props.children}
    </li>
  );
}
