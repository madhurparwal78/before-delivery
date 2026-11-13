import { useRef, useState } from "react";
import { copy } from "../shared/copy.js";
import { formatLength } from "../shared/format.js";
import type { Units } from "../shared/types.js";
import type { DrawingResponse, MeResponse } from "./types.js";
import type { AidsState } from "./editor.js";

export function EditorHeader(props: {
  drawing: DrawingResponse;
  me: MeResponse | null;
  sync: string;
  collaborators: Array<{ name: string; state: string }>;
  onDialog: (dialog: string) => void;
  onUndoRedo: (name: "UNDO" | "REDO") => void;
  trialEnded: boolean;
}): JSX.Element {
  const accessText =
    props.drawing.access === "owner" || props.drawing.access === "edit"
      ? "Can edit"
      : props.drawing.access === "markup"
        ? "Mark-up only"
        : "View only";
  return (
    <header className="editor-header">
      <nav aria-label="Breadcrumb" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <a href="/drawings" style={{ color: "#7ad7e8" }}>My Drawings</a>
        <span>/</span>
        <span>{props.drawing.name}</span>
      </nav>
      <div style={{ flex: 1 }} />
      <button className="btn btn-outline btn-small" type="button" onClick={() => props.onDialog("saveas")}>Save as</button>
      <button className="btn btn-outline btn-small" type="button" onClick={() => props.onDialog("export")}>Print</button>
      <button className="btn btn-outline btn-small" type="button" onClick={() => props.onUndoRedo("UNDO")}>Undo</button>
      <button className="btn btn-outline btn-small" type="button" onClick={() => props.onUndoRedo("REDO")}>Redo</button>
      <button className="btn btn-outline btn-small" type="button" onClick={() => props.onDialog("reference")}>Learning material</button>
      {props.drawing.access === "owner" && (
        <button className="btn btn-outline btn-small" type="button" onClick={() => props.onDialog("share")}>Share</button>
      )}
      <span className="status-chip" role="status" aria-label="Sync">{props.sync}</span>
      <ul aria-label="Collaborators" style={{ listStyle: "none", display: "flex", gap: 6, margin: 0, padding: 0 }}>
        {props.collaborators.map((c) => (
          <li key={c.name} className="status-chip">{c.name} · {c.state}</li>
        ))}
      </ul>
      <span className="status-chip" role="status" aria-label="Access">{accessText}</span>
      {props.drawing.access === "owner" && (
        <span className="status-chip" role="status" aria-label="Trial">
          {props.trialEnded ? "Your trial has ended" : props.me && props.me.trial.days_left === 1 ? "1 day left in your trial" : props.me ? `${props.me.trial.days_left} days left in your trial` : ""}
        </span>
      )}
    </header>
  );
}

const ribbonGroups: Record<string, Array<{ label: string; command: string }>> = {
  Draw: [
    { label: "Line", command: "LINE" },
    { label: "Polyline", command: "PLINE" },
    { label: "Circle", command: "CIRCLE" },
    { label: "Arc", command: "ARC" },
    { label: "Rectangle", command: "RECTANG" },
    { label: "Polygon", command: "POLYGON" },
    { label: "Spline", command: "SPLINE" },
  ],
  Annotate: [
    { label: "Text", command: "MTEXT" },
    { label: "Linear", command: "DIMLINEAR" },
    { label: "Aligned", command: "DIMALIGNED" },
    { label: "Radius", command: "DIMRADIUS" },
    { label: "Angular", command: "DIMANGULAR" },
  ],
  Modify: [
    { label: "Move", command: "MOVE" },
    { label: "Copy", command: "COPY" },
    { label: "Rotate", command: "ROTATE" },
    { label: "Mirror", command: "MIRROR" },
    { label: "Scale", command: "SCALE" },
    { label: "Trim", command: "TRIM" },
    { label: "Extend", command: "EXTEND" },
    { label: "Fillet", command: "FILLET" },
    { label: "Offset", command: "OFFSET" },
    { label: "Erase", command: "ERASE" },
  ],
};

export function Ribbon(props: {
  drawing: DrawingResponse;
  traceActive: boolean;
  onStart: (command: string) => void;
}): JSX.Element {
  const [tab, setTab] = useState("Draw");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const markupEnabled = props.drawing.access === "markup" ? props.traceActive : true;
  const canEdit = props.drawing.access === "owner" || props.drawing.access === "edit" || markupEnabled;
  const markupCommands = new Set(["LINE", "PLINE", "CIRCLE", "MTEXT", "ERASE"]);
  const disabled = (command: string): boolean => {
    if (!canEdit) return true;
    if (props.drawing.access === "markup" && props.traceActive && !markupCommands.has(command)) return true;
    return false;
  };
  const names = Object.keys(ribbonGroups);
  return (
    <div className="ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
        {names.map((name) => (
          <button
            key={name}
            ref={(node) => {
              tabRefs.current[name] = node;
            }}
            className="ribbon-tab"
            type="button"
            role="tab"
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const index = names.indexOf(tab);
                const next = e.key === "ArrowRight" ? (index + 1) % names.length : (index - 1 + names.length) % names.length;
                setTab(names[next]);
                tabRefs.current[names[next]]?.focus();
              }
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="ribbon-buttons">
        {(ribbonGroups[tab] ?? []).map((button) => (
          <button
            key={button.command}
            className="ribbon-btn"
            type="button"
            aria-disabled={disabled(button.command)}
            onClick={() => {
              if (disabled(button.command)) return;
              props.onStart(button.command);
              setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Command"]')?.focus(), 0);
            }}
          >
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LayoutTabs(props: {
  drawing: DrawingResponse;
  onCommand: (name: string, args: Record<string, unknown>) => void;
}): JSX.Element {
  const [active, setActive] = useState("Model");
  return (
    <div className="layout-bar" role="tablist" aria-label="Layouts">
      <span className="status-chip" style={{ marginRight: 6 }}>{active === "Model" ? "Model" : "1:50"}</span>
      {props.drawing.layouts.map((layout) => (
        <button
          key={layout.name}
          className="layout-tab"
          type="button"
          role="tab"
          aria-selected={active === layout.name}
          onClick={() => setActive(layout.name)}
        >
          {layout.name}
        </button>
      ))}
      <button
        className="layout-tab"
        type="button"
        onClick={() => props.onCommand("LAYOUT", { op: "new" })}
        aria-label="New layout"
      >
        +
      </button>
    </div>
  );
}

export function StatusBar(props: {
  aids: AidsState;
  onToggle: (aid: keyof AidsState) => void;
  cursor: [number, number] | null;
  zoom: number;
  units: Units;
}): JSX.Element {
  return (
    <div className="status-bar">
      <div role="toolbar" aria-label="Drafting aids" style={{ display: "flex", gap: 4 }}>
        {([
          ["osnap", "OSNAP"],
          ["ortho", "ORTHO"],
          ["polar", "POLAR"],
          ["snapGrid", "SNAP & GRID"],
          ["otrack", "OTRACK"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className="aid-btn"
            type="button"
            aria-pressed={props.aids[key]}
            onClick={() => props.onToggle(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="status-chip" role="status" aria-label="Coordinates">
        {props.cursor ? `${formatLength(props.cursor[0], props.units)}, ${formatLength(props.cursor[1], props.units)}` : "—"}
      </span>
      <span className="status-chip" role="status" aria-label="Zoom">{props.zoom}%</span>
      <span className="status-chip" role="status" aria-label="Space">MODEL</span>
    </div>
  );
}

export function CommandLine(props: {
  history: Array<{ id: number; text: string }>;
  prompt: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const focused = useRef(false);
  const attach = (node: HTMLInputElement | null): void => {
    if (props.inputRef) (props.inputRef as { current: HTMLInputElement | null }).current = node;
    if (node && !focused.current) {
      focused.current = true;
      node.focus();
    }
  };
  return (
    <div className="command-line">
      <div className="command-history" role="log" aria-label="Command history">
        {props.history.map((line) => (
          <div key={line.id}>{line.text}</div>
        ))}
      </div>
      <form
        className="command-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          const input = props.inputRef.current;
          if (!input) return;
          props.onSubmit(input.value);
          input.value = "";
        }}
      >
        <span role="status" aria-label="Command prompt" aria-live="polite" className="status-chip">{props.prompt}</span>
        <input
          ref={attach}
          type="text"
          aria-label="Command"
          placeholder="Type a command"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              props.onCancel();
              (e.target as HTMLInputElement).value = "";
            }
          }}
        />
      </form>
    </div>
  );
}
