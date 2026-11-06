import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Layers, PanelRight, Share2, Star, Trash2, FolderPlus, X } from "lucide-react";
import type { FieldValue } from "../../shared/sync.ts";
import { assignCardSlots, moveToTrash, setDocumentDetails, setDocumentTitle } from "../store/actions.ts";
import { announce } from "../store/announcer.ts";
import { location, navigate, replaceAddress, takeArrivalFocus } from "../store/router.ts";
import type { Camera } from "../store/preferences.ts";
import { blocksOf, documentState, getRecord, isListed, liveDocuments } from "../store/workspace.ts";
import { BlockList, focusPageBlock, useFittedHeight } from "./BlockList.tsx";
import { BothKept } from "./BothKept.tsx";
import { Canvas, cardsInReadingOrder, focusCard } from "./Canvas.tsx";
import { Dialog, NotFound, overlayRoot } from "./common.tsx";
import type { Rects, ViewState } from "./deal.ts";
import { clearMotion, crossfade, drawConnectors, measureCards, measurePage, travel } from "./deal.ts";
import { untitled } from "./DocumentList.tsx";
import { useModal, usePresence, useViewport, prefersReducedMotion } from "./hooks.ts";
import { ShareDialog } from "./ShareDialog.tsx";

export const InspectorSlot = createContext<HTMLElement | null>(null);

const SHEET_EXIT: Keyframe[] = [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(16px)" }];

/** The inspector pane: docked, or a sheet that traps focus while it is open. */
export function InspectorPane({ open, floating, onClose, children }: { open: boolean; floating: boolean; onClose: () => void; children: React.ReactNode }) {
  const { mounted, ref } = usePresence<HTMLElement>(open, SHEET_EXIT);
  useModal(ref, onClose, floating && open && mounted);
  const slot = useContext(InspectorSlot);
  if (!mounted || !slot) return null;
  return createPortal(
    <aside ref={ref} aria-label="Inspector" className={floating ? "inspector inspector-floating" : "inspector"}>
      {floating && (
        <button type="button" className="button inspector-close" onClick={onClose}><X aria-hidden="true" />Close inspector</button>
      )}
      {children}
    </aside>,
    floating ? overlayRoot() : slot,
  );
}

function NewFolderDialog({ onSave, onClose }: { onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <Dialog name="New folder" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <label className="field"><span>Folder name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="dialog-actions">
          <button type="submit" className="button">Add folder</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function DocumentInspector({ documentId }: { documentId: string }) {
  const document = getRecord("document", documentId);
  const [tags, setTags] = useState((document?.fields.tags ?? []).join(", "));
  const [dialog, setDialog] = useState<"folder" | "share" | null>(null);
  if (!document) return null;
  const { folder, starred, title } = document.fields;
  const folders = [...new Set(liveDocuments().map((each) => each.fields.folder).filter(Boolean))].sort();
  return (
    <div className="inspector-body">
      <label className="field">
        <span>Tags</span>
        <input
          value={tags}
          onChange={(event) => {
            setTags(event.target.value);
            setDocumentDetails(documentId, { tags: [...new Set(event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))] });
          }}
        />
      </label>
      <label className="field">
        <span>Folder</span>
        <select value={folder} onChange={(event) => setDocumentDetails(documentId, { folder: event.target.value })}>
          <option value="">No folder</option>
          {folders.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
      <button type="button" className="button" onClick={() => setDialog("folder")}><FolderPlus aria-hidden="true" />New folder</button>
      <button type="button" className="button" aria-pressed={starred} onClick={() => setDocumentDetails(documentId, { starred: !starred })}>
        <Star aria-hidden="true" fill={starred ? "currentColor" : "none"} />Star this document
      </button>
      <button type="button" className="button" onClick={() => setDialog("share")}><Share2 aria-hidden="true" />Share</button>
      <button
        type="button"
        className="button"
        onClick={() => {
          moveToTrash(documentId, untitled(title));
          navigate("/");
        }}
      >
        <Trash2 aria-hidden="true" />Move to trash
      </button>
      {dialog === "folder" && (
        <NewFolderDialog
          onClose={() => setDialog(null)}
          onSave={(name) => {
            setDocumentDetails(documentId, { folder: name });
            setDialog(null);
          }}
        />
      )}
      {dialog === "share" && <ShareDialog documentId={documentId} onClose={() => setDialog(null)} />}
    </div>
  );
}

function TitleField({ documentId, title, kept }: { documentId: string; title: string; kept: FieldValue[] | undefined }) {
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);
  const shown = kept ? String(kept[0] ?? "") : title;
  useFittedHeight(field, shown);
  return (
    <>
      <textarea
        ref={setField}
        id="document-title"
        className="document-title"
        aria-label="Document title"
        placeholder="Untitled"
        rows={1}
        value={shown}
        readOnly={Boolean(kept)}
        onChange={(event) => setDocumentTitle(documentId, event.target.value.replaceAll("\n", " "))}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const first = blocksOf(documentId)[0];
          if (first) focusPageBlock(first.id, "start");
        }}
      />
      {kept && (
        <BothKept
          kind="document"
          id={documentId}
          field="title"
          values={kept}
          text={String}
          sentence="Both kept. Two devices changed this block. Pick the one to keep."
          onChosen={() => field?.focus()}
        />
      )}
    </>
  );
}

export function DocumentView({ documentId, query }: { documentId: string; query: URLSearchParams }) {
  const document = getRecord("document", documentId);
  const viewport = useViewport();
  const askedView = query.get("view") === "canvas" ? "canvas" : "page";
  const [viewState, setViewState] = useState<ViewState>(askedView);
  const [landed, setLanded] = useState(askedView === "canvas");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const selected = useRef(query.get("block") ?? "");
  const [selectedCard, setSelectedCard] = useState(selected.current);
  const sheet = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera>({ zoom: 1, panX: 40, panY: 40 });
  const motion = useRef<(() => void) | null>(null);
  const stateRef = useRef(viewState);
  stateRef.current = viewState;

  const blocks = blocksOf(documentId);
  const missing = !document || !isListed(document);
  const showingCanvas = viewState !== "page";

  const addressFor = (view: "page" | "canvas", block: string): string =>
    `/doc/${documentId}?view=${view}${block ? `&block=${block}` : ""}`;

  const selectBlock = useCallback((id: string): void => {
    selected.current = id;
    setSelectedCard(id);
    const state = stateRef.current;
    if (state === "page" || state === "canvas") replaceAddress(addressFor(state, id));
  }, [documentId]);

  useEffect(() => {
    if (viewState === "canvas" && !missing) assignCardSlots(documentId);
  }, [viewState, missing, blocks.length]);

  useLayoutEffect(() => {
    if (takeArrivalFocus() === "title") window.document.getElementById("document-title")?.focus();
  }, [documentId]);

  const land = (going: "page" | "canvas", order: readonly string[]): void => {
    motion.current = null;
    clearMotion(order, [canvas.current, sheet.current]);
    if (going === "page") {
      flushSync(() => setViewState("page"));
      focusPageBlock(selected.current);
      return;
    }
    flushSync(() => setLanded(true));
    if (prefersReducedMotion() || !surface.current) setViewState("canvas");
    else motion.current = drawConnectors(surface.current, () => {
      motion.current = null;
      setViewState("canvas");
    });
  };

  const switchView = (): void => {
    const state = stateRef.current;
    const going = state === "page" || state === "gathering" ? "canvas" : "page";
    const reversing = state === "dealing" || state === "gathering";
    const selectable = going === "page" ? blocks : cardsInReadingOrder(documentId);
    if (!selectable.some((card) => card.id === selected.current)) selected.current = blocks[0]?.id ?? "";
    if (going === "canvas") flushSync(() => assignCardSlots(documentId));
    const order = cardsInReadingOrder(documentId).map((card) => card.id);
    const blockIds = blocks.map((block) => block.id);
    const current: Rects = reversing || going === "page" ? measureCards(order) : measurePage(blockIds);
    motion.current?.();
    motion.current = null;
    flushSync(() => {
      setViewState(going === "canvas" ? "dealing" : "gathering");
      setLanded(false);
      setInspectorOpen(false);
      setSelectedCard(selected.current);
      replaceAddress(addressFor(going, selected.current));
    });
    announce(going === "canvas" ? `Canvas view. ${order.length} cards.` : `Page view. ${blockIds.length} blocks.`);
    if (going === "canvas") focusCard(selected.current);
    const region = canvas.current;
    const paper = sheet.current;
    if (!region || !paper) return;
    const finished = (): void => land(going, order);
    motion.current = prefersReducedMotion()
      ? crossfade(going === "canvas" ? paper : region, going === "canvas" ? region : paper, finished)
      : travel({
        canvas: region,
        sheet: paper,
        camera: camera.current,
        order,
        current,
        pageTargets: going === "page" ? measurePage(blockIds) : new Map(),
        going,
        reversing,
      }, finished);
  };

  const switchRef = useRef(switchView);
  switchRef.current = switchView;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyC") {
        event.preventDefault();
        switchRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const asked = location.get().query.get("view") === "canvas" ? "canvas" : "page";
    const state = stateRef.current;
    if ((state === "page" || state === "canvas") && asked !== state) {
      setViewState(asked);
      setLanded(asked === "canvas");
    }
  }, [askedView]);

  if (missing) return <NotFound heading="We could not find that document." />;

  const docked = viewport !== "phone" && (viewState === "page" || viewState === "gathering");
  const inspectorShown = docked || inspectorOpen;
  const flying = viewState === "dealing" || viewState === "gathering";
  const state = documentState(documentId);
  return (
    <div className="document">
      <div className="document-tools">
        <button type="button" className="button" aria-pressed={showingCanvas && (viewState === "canvas" || viewState === "dealing")} onClick={switchView}>
          <Layers aria-hidden="true" />Switch view
        </button>
        {!docked && (
          <button type="button" className="button" onClick={() => setInspectorOpen(true)}><PanelRight aria-hidden="true" />Open inspector</button>
        )}
      </div>
      <div ref={surface} role="region" aria-label="Table" className="table-surface" data-view-state={viewState}>
        {viewState !== "canvas" && (
          <div className="sheet-scroller">
            <div ref={sheet} className={flying ? "sheet sheet-flying" : "sheet"}>
              <TitleField documentId={documentId} title={document.fields.title} kept={document.sync.bothKept["title"]} />
              <div role="group" aria-label="Document state" className="document-state">{state}</div>
              <BlockList documentId={documentId} ghost={flying} onSelect={selectBlock} />
            </div>
          </div>
        )}
        {viewState !== "page" && (
          <Canvas
            documentId={documentId}
            regionRef={canvas}
            connectors={landed}
            selected={selectedCard}
            onSelect={selectBlock}
            onInspect={(next) => { camera.current = next; }}
            interactive={viewState === "canvas"}
          />
        )}
      </div>
      <InspectorPane open={inspectorShown} floating={!docked} onClose={() => setInspectorOpen(false)}>
        <DocumentInspector documentId={documentId} />
      </InspectorPane>
    </div>
  );
}
