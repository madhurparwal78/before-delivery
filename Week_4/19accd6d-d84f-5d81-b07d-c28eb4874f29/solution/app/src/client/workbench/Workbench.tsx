import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { flushSync } from "react-dom";
import { announcements } from "../announce";
import { useAddress } from "../router";
import { onLiveCatchUp, onLiveMessage } from "../live";
import { session } from "../session";
import { useStore } from "../store";
import { modalIsOpen } from "../ui/Modal";
import { addTab, catchUp, handleLive, openFromAddress } from "./actions";
import { bakeNow, stepNow } from "./bake";
import { InputPane, InputTabs } from "./InputPane";
import { OperationsPane } from "./OperationsPane";
import { OutputPane } from "./OutputPane";
import { persistOnLeave } from "./persist";
import { RecipePane } from "./RecipePane";
import { DEFAULT_LAYOUT, patch, workbench } from "./state";
import type { Layout } from "./state";
import { useMediaQuery } from "./useMediaQuery";

const PANEL_MIN = 10;
const PANEL_MAX = 90;
const STEP = 2;
const BIG_STEP = 10;
const PANELS = ["Operations", "Recipe", "Input", "Output"] as const;

type Divider = keyof Layout;

/** The range a divider may take given where the others are: every pane keeps at least 10 percent. */
function limitsOf(divider: Divider, layout: Layout): { min: number; max: number } {
  if (divider === "operations") return { min: PANEL_MIN, max: layout.recipe - PANEL_MIN };
  if (divider === "recipe") return { min: layout.operations + PANEL_MIN, max: PANEL_MAX };
  return { min: PANEL_MIN, max: PANEL_MAX };
}

function moveDivider(divider: Divider, wanted: number): void {
  const { layout } = workbench.get();
  const { min, max } = limitsOf(divider, layout);
  patch({ layout: { ...layout, [divider]: Math.min(max, Math.max(min, Math.round(wanted))) } });
}

function Separator({ name, divider, orientation, container }: {
  name: string; divider: Divider; orientation: "vertical" | "horizontal"; container: React.RefObject<HTMLElement | null>;
}) {
  const layout = useStore(workbench, (state) => state.layout);
  const value = layout[divider];
  const { min, max } = limitsOf(divider, layout);
  const dragging = useRef(false);
  const vertical = orientation === "vertical";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const forward = vertical ? "ArrowRight" : "ArrowDown";
    const backward = vertical ? "ArrowLeft" : "ArrowUp";
    const size = event.shiftKey ? BIG_STEP : STEP;
    if (event.key === forward) moveDivider(divider, value + size);
    else if (event.key === backward) moveDivider(divider, value - size);
    else if (event.key === "Home") moveDivider(divider, min);
    else if (event.key === "End") moveDivider(divider, max);
    else return;
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current || !container.current) return;
    const box = container.current.getBoundingClientRect();
    moveDivider(divider, vertical ? ((event.clientX - box.left) / box.width) * 100 : ((event.clientY - box.top) / box.height) * 100);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={name}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className={`separator separator-${orientation}`}
      style={vertical ? { left: `${value}%` } : { top: `${value}%` }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={() => patch({ layout: DEFAULT_LAYOUT })}
    />
  );
}

function AnnouncementRegion() {
  const messages = useStore(announcements, (state) => state);
  return (
    <div role="status" aria-label="Workbench announcements" aria-live="polite" className="visually-hidden">
      {messages.map((message) => (
        <div key={message.id}>{message.text}</div>
      ))}
    </div>
  );
}

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof Element && target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"]');

function PhonePanels({ finder }: { finder: React.RefObject<HTMLInputElement | null> }) {
  const panel = useStore(workbench, (state) => state.panel);
  const panes = {
    Operations: <OperationsPane finderRef={finder} />,
    Recipe: <RecipePane phone />,
    Input: (
      <>
        <InputTabs />
        <InputPane />
      </>
    ),
    Output: <OutputPane />,
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = PANELS.indexOf(panel);
    const to = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : -1;
    if (to < 0 || to >= PANELS.length) return;
    event.preventDefault();
    patch({ panel: PANELS[to] });
    (event.currentTarget.children[to] as HTMLElement).focus();
  };
  return (
    <>
      <div role="tablist" aria-label="Workbench panes" className="panel-tabs" onKeyDown={onKeyDown}>
        {PANELS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`panel-tab-${name}`}
            aria-selected={panel === name}
            aria-controls={`panel-${name}`}
            tabIndex={panel === name ? 0 : -1}
            onClick={() => patch({ panel: name })}
          >
            {name}
          </button>
        ))}
      </div>
      {PANELS.map((name) => (
        <div key={name} role="tabpanel" id={`panel-${name}`} aria-labelledby={`panel-tab-${name}`} className="panel" hidden={panel !== name} inert={panel !== name}>
          {panes[name]}
        </div>
      ))}
    </>
  );
}

export function Workbench() {
  const address = useAddress();
  const phone = useMediaQuery("(max-width: 700px)");
  const ready = useStore(workbench, (state) => state.ready);
  const topAlert = useStore(workbench, (state) => state.topAlert);
  const layout = useStore(workbench, (state) => state.layout);
  const user = useStore(session, (state) => state.user);
  const bench = useRef<HTMLDivElement>(null);
  const editors = useRef<HTMLDivElement>(null);
  const finder = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void openFromAddress();
    const fromHash = (): void => void openFromAddress();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [address]);

  useEffect(persistOnLeave, []);

  useEffect(() => {
    if (!user) return;
    const offMessage = onLiveMessage(handleLive);
    const offCatchUp = onLiveCatchUp(() => void catchUp());
    return () => {
      offMessage();
      offCatchUp();
    };
  }, [user]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (modalIsOpen()) return;
      const target = event.target;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        bakeNow();
      } else if (event.key === "F8") {
        event.preventDefault();
        stepNow();
      } else if (event.ctrlKey && event.altKey && event.code === "KeyN") {
        event.preventDefault();
        addTab();
      } else if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextField(target)) {
        event.preventDefault();
        if (phone) flushSync(() => patch({ panel: "Operations" }));
        finder.current?.focus();
      } else if (event.key === "Escape" && isTextField(target)) {
        (target as Element).closest<HTMLElement>('[role="region"][tabindex="-1"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [phone]);

  if (!ready) return <main className="workbench loading" aria-busy="true" />;
  return (
    <main className="workbench">
      <AnnouncementRegion />
      {topAlert && (
        <div role="alert" className="top-alert">
          <span>{topAlert}</span>
          <button type="button" aria-label="Dismiss alert" onClick={() => patch({ topAlert: null })}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {phone ? (
        <div className="phone-panels">
          <PhonePanels finder={finder} />
        </div>
      ) : (
        <div
          ref={bench}
          className="bench"
          style={{ gridTemplateColumns: `${layout.operations}fr ${layout.recipe - layout.operations}fr ${100 - layout.recipe}fr` }}
        >
          <OperationsPane finderRef={finder} />
          <Separator name="Resize Operations and Recipe" divider="operations" orientation="vertical" container={bench} />
          <RecipePane phone={false} />
          <Separator name="Resize Recipe and Editors" divider="recipe" orientation="vertical" container={bench} />
          <div ref={editors} className="editor-column" style={{ gridTemplateRows: `${layout.inputShare}fr ${100 - layout.inputShare}fr` }}>
            <div className="input-group">
              <InputTabs />
              <InputPane />
            </div>
            <Separator name="Resize Input and Output" divider="inputShare" orientation="horizontal" container={editors} />
            <OutputPane />
          </div>
        </div>
      )}
    </main>
  );
}

