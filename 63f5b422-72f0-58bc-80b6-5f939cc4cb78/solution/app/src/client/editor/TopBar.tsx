import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { INSERTABLE, TYPE_LABEL } from "../../shared/tree.js";
import { BREAKPOINT_LABEL, BREAKPOINTS, FRAME_WIDTH, type Breakpoint } from "../../shared/types.js";
import { Icon, type IconName } from "../ui/icons.js";
import { useEditor, type Panel } from "./context.js";
import { startDrag } from "./drag.js";

const BP_ICON: Record<Breakpoint, IconName> = { desktop: "monitor", tablet: "tablet", phone: "smartphone" };
const TYPE_ICON: Record<string, IconName> = {
  section: "square",
  stack: "rows-3",
  heading: "heading-1",
  text: "type",
  image: "image",
  button: "mouse-pointer-click",
  nav: "navigation",
  collection_list: "file-stack",
};

function Tool({ label, icon, onClick, pressed, children, disabled, extra }: { label: string; icon: IconName; onClick: () => void; pressed?: boolean; children?: ReactNode; disabled?: boolean; extra?: Record<string, string | boolean> }) {
  return (
    <button type="button" className={`pl-tool${children ? " pl-tool-labelled" : ""}${pressed ? " pl-tool-on" : ""}`} aria-label={label} title={label} onClick={onClick} disabled={disabled} data-panel-button={label} {...extra}>
      <Icon name={icon} />
      {children}
    </button>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function Presence() {
  const { sync, state, act } = useEditor();
  const people = [...sync.people].sort((a, b) => (a.id === state.meId ? -1 : b.id === state.meId ? 1 : 0));
  return (
    <div className="pl-presence">
      {people.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`pl-avatar${p.id === state.meId ? " pl-avatar-me" : ""}`}
          aria-label={`${p.name}, ${p.role === "viewer" ? "viewing" : "editing"}`}
          title={`${p.name} · ${p.role}`}
          data-initials={initials(p.name)}
          onClick={() => {
            const nodeId = sync.selections.get(p.id);
            if (nodeId && document.querySelector(`#canvas [data-node-id="${nodeId}"]`)) act.select(nodeId);
          }}
        />
      ))}
    </div>
  );
}

function AddMenu() {
  const { state, act } = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      act.closeMenu();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? list[0] : list[list.length - 1])?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      act.closeMenu();
    }
  };
  return (
    <div className="pl-menu" role="menu" aria-label="Add component" ref={ref} onKeyDown={onKeyDown}>
      {INSERTABLE.map((type) => (
        <button
          key={type}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="pl-menuitem"
          onClick={() => act.insert({ kind: "type", type })}
          onPointerDown={(e) => startDrag(e, { kind: "type", type }, act)}
        >
          <Icon name={TYPE_ICON[type]} />
          {TYPE_LABEL[type]}
        </button>
      ))}
      {state.doc.components.length > 0 && (
        <div role="group" aria-label="Insert shared component" className="pl-menu-group">
          <p className="pl-menu-heading" aria-hidden="true">
            Shared components
          </p>
          {state.doc.components.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="pl-menuitem"
              onClick={() => act.insert({ kind: "component", componentId: c.id })}
              onPointerDown={(e) => startDrag(e, { kind: "component", componentId: c.id }, act)}
            >
              <Icon name="layers" />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const { state, act } = useEditor();
  const { layout, readOnly, panel, doc } = state;
  const phone = layout === "phone";
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  const panelButton = (name: Panel, label: string, icon: IconName) => (
    <Tool label={label} icon={icon} pressed={panel === name} onClick={() => (panel === name ? act.closePanel() : act.openPanel(name))} />
  );
  return (
    <header className="pl-topbar">
      <div className="pl-topbar-start">
        <span className="pl-brand-mark" aria-hidden="true" />
        <span className="pl-workspace-name" title={doc.name}>
          {doc.name}
        </span>
        {!phone && (
          <select className="pl-select pl-page-select" aria-label="Page" value={state.page.id} onChange={(e) => act.setPage(e.target.value)}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {layout === "tablet" && (
          <Tool label="Navigator" icon="list-tree" pressed={state.drawerOpen} onClick={() => act.toggleDrawer()} extra={{ "aria-expanded": state.drawerOpen, "data-navigator-toggle": true }} />
        )}
        {!phone && !readOnly && (
          <div className="pl-add-wrap">
            <button type="button" className="pl-button pl-add" aria-haspopup="menu" aria-expanded={state.menuOpen} onClick={() => (state.menuOpen ? act.closeMenu() : act.openMenu())}>
              <Icon name="plus" />
              Add
            </button>
            {state.menuOpen && <AddMenu />}
          </div>
        )}
      </div>
      {!phone && (
        <div className="pl-topbar-middle">
          <div role="radiogroup" aria-label="Breakpoint" className="pl-breakpoints">
            {BREAKPOINTS.map((bp) => (
              <label key={bp} className={`pl-bp${state.bp === bp ? " pl-bp-on" : ""}`} title={`${BREAKPOINT_LABEL[bp]} ${FRAME_WIDTH[bp]}`}>
                <input type="radio" name="breakpoint" value={bp} checked={state.bp === bp} onChange={() => act.setBp(bp)} />
                <Icon name={BP_ICON[bp]} />
                <span className="pl-sr">{BREAKPOINT_LABEL[bp]}</span> <span className="pl-mono">{FRAME_WIDTH[bp]}</span>
              </label>
            ))}
          </div>
          <Tool label="Fan" icon="fan" pressed={state.fan !== "closed"} onClick={act.toggleFan} disabled={!state.selectedId}>
            <span>Fan</span>
          </Tool>
        </div>
      )}
      <div className="pl-topbar-end">
        {!phone && (
          <>
            {!readOnly && panelButton("tokens", "Tokens", "palette")}
            {!readOnly && panelButton("collection", "Collection", "database")}
            {!readOnly && panelButton("images", "Images", "image")}
            {panelButton("history", "History", "history")}
            {panelButton("comments", "Comments", "message-square")}
            {!readOnly && <Tool label="Save version" icon="save" onClick={() => act.openDialog({ kind: "saveVersion" })} />}
            {!readOnly && state.role === "owner" && (
              <button type="button" className="pl-button" onClick={() => act.openDialog({ kind: "share" })}>
                <Icon name="share-2" />
                Share
              </button>
            )}
            {!readOnly && (
              <button type="button" className="pl-primary" onClick={() => act.openDialog({ kind: "publish" })} aria-busy={state.busy.publish || undefined} disabled={state.busy.publish}>
                <Icon name="upload" />
                Publish
              </button>
            )}
            <Tool label="Style panel" icon="panel-right" pressed={state.stylePanelOpen} onClick={act.toggleStylePanel} extra={{ "aria-expanded": state.stylePanelOpen }} />
          </>
        )}
        <Presence />
      </div>
    </header>
  );
}
