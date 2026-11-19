import { useEffect, useState } from "react";
import { Menu } from "../lib/Menu";
import {
  IconBack, IconBoard, IconDownload, IconForward, IconHome, IconList, IconRedo, IconSearch, IconShare, IconUndo,
} from "../lib/icons";
import { Link, navigate } from "../lib/router";
import { matchCount } from "../../shared/copy";
import { bulletLabel } from "../../shared/text";
import { homePath } from "./actions";
import type { ControllerState, OutlineController } from "./controller";

function useNarrow(): boolean {
  const query = "(width <= 480px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const change = () => setNarrow(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return narrow;
}

interface Crumb {
  label: string;
  to: string | null;
  last: boolean;
}

function crumbsFor(controller: OutlineController, state: ControllerState, narrow: boolean): Crumb[] {
  const { root, ancestors } = state.view;
  const home = homePath(controller);
  const top = controller.shareTop();
  if (root === null || (top !== null && top === root.id)) return [{ label: "Home", to: home, last: true }];
  const trail: Crumb[] = [
    ...ancestors.map((ancestor) => ({ label: bulletLabel(ancestor.text), to: `/b/${encodeURIComponent(ancestor.id)}`, last: false })),
    { label: bulletLabel(controller.textOf(root)), to: null, last: true },
  ];
  return [{ label: "Home", to: home, last: false }, ...(narrow ? trail.slice(-2) : trail)];
}

export function Toolbar({ controller, state, board }: { controller: OutlineController; state: ControllerState; board: boolean }) {
  const narrow = useNarrow();
  const { view } = state;
  const crumbs = crumbsFor(controller, state, narrow);
  const exportRoot = view.rootId === null ? "" : `&root=${encodeURIComponent(view.rootId)}`;
  const canShare = view.root !== null && controller.shareTop() === null;
  const viewPath = (toBoard: boolean) => `${location.pathname}${toBoard ? "?view=board" : ""}`;

  return (
    <div className="window-bar">
      <div className="bar-group">
        <button type="button" className="tool-button" aria-label="Go back" onClick={() => history.back()}><IconBack /></button>
        <button type="button" className="tool-button" aria-label="Go forward" onClick={() => history.forward()}><IconForward /></button>
        <button type="button" className="tool-button" aria-label="Go home" onClick={() => navigate(homePath(controller))}><IconHome /></button>
      </div>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((crumb, index) => (
          <span className="crumb" key={`${crumb.label}-${index}`} {...(crumb.last ? { "data-crumb-last": "" } : {})}>
            {index > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}
            {crumb.to !== null
              ? <Link to={crumb.to} {...(crumb.last ? { "aria-current": "page" as const } : {})}>{crumb.label}</Link>
              : <span aria-current="page">{crumb.label}</span>}
          </span>
        ))}
      </nav>
      <div className="search">
        <IconSearch width={16} height={16} />
        <input
          type="search" aria-label="Search outline" placeholder="Search outline" value={state.search.query} autoComplete="off"
          aria-invalid={state.search.error !== null} aria-describedby={state.search.error === null ? undefined : "search-error"}
          onChange={(event) => controller.setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); controller.setSearch(""); } }}
        />
        {state.search.result !== null && (
          <span className="count">{matchCount(state.search.result.count)}</span>
        )}
      </div>
      {state.search.error !== null && <p className="field-error search-error" id="search-error">{state.search.error}</p>}
      <div className="bar-group tools">
        <button
          type="button" role="switch" aria-checked={state.hideCompleted} aria-label="Hide completed" className="switch"
          onClick={() => void controller.setHideCompleted(!state.hideCompleted)}
        >
          <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
          <span className="switch-label" aria-hidden="true">Hide completed</span>
          <span className="switch-label-short" aria-hidden="true">Hide done</span>
        </button>
        <button type="button" className="view-button" onClick={() => navigate(viewPath(!board))}>
          {board ? <IconList /> : <IconBoard />}
          <span className="view-text">{board ? "Show as list" : "Show as board"}</span>
        </button>
        {canShare && (
          <button type="button" className="tool-button wide" aria-label="Share" onClick={() => controller.setSharing(true)}>
            <IconShare /><span className="tool-text" aria-hidden="true">Share</span>
          </button>
        )}
        <Menu label="Download" buttonClassName="tool-button wide" buttonContent={<><IconDownload /><span className="tool-text" aria-hidden="true">Download</span></>}>
          {(close) => (
            <>
              <a role="menuitem" className="menu-item" href={`/api/export?format=text${exportRoot}`} download onClick={close}>Plain text</a>
              <a role="menuitem" className="menu-item" href={`/api/export?format=markdown${exportRoot}`} download onClick={close}>Markdown</a>
              <a role="menuitem" className="menu-item" href={`/api/export?format=opml${exportRoot}`} download onClick={close}>OPML</a>
            </>
          )}
        </Menu>
        <button type="button" className="tool-button wide" aria-label="Undo" onClick={() => controller.undoOrRedo("undo")}>
          <IconUndo /><span className="tool-text" aria-hidden="true">Undo</span>
        </button>
        <button type="button" className="tool-button wide" aria-label="Redo" onClick={() => controller.undoOrRedo("redo")}>
          <IconRedo /><span className="tool-text" aria-hidden="true">Redo</span>
        </button>
      </div>
    </div>
  );
}
