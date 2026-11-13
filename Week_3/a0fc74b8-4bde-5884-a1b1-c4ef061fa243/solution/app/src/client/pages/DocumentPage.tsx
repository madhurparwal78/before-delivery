import { type KeyboardEvent, type PointerEvent, type ReactNode, type Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PAGES_UNAVAILABLE, STATUS_WORDS, positionCopy } from "../../shared/copy";
import { boxCenteredAt } from "../../shared/geometry";
import type { Box, DocumentJson, FieldJson, FieldKind } from "../../shared/types";
import { EditorField, keyedMove } from "../components/EditorField";
import { FieldPanel } from "../components/FieldPanel";
import { PageSheet } from "../components/PageSheet";
import { ServiceNotice, Status } from "../components/Regions";
import { Routing } from "../components/Routing";
import { Slide } from "../components/Slide";
import { api } from "../lib/api";
import { useFieldSaver } from "../lib/fieldSaver";
import { useModal } from "../lib/modal";
import { useRouter } from "../lib/router";
import { useMe } from "../lib/session";
import { usePdf } from "../lib/pdf";
import { type Track, useDocument } from "../lib/useDocument";
import { COMPACT, PHONE, useMedia } from "../lib/useMedia";
import { NotFound } from "./NotFound";

const KINDS: { kind: FieldKind; label: string }[] = [
  { kind: "signature", label: "Signature" },
  { kind: "initials", label: "Initials" },
  { kind: "date", label: "Date" },
  { kind: "text", label: "Text" },
];

function boxOf(field: FieldJson): Box {
  return { x: field.x, y: field.y, w: field.w, h: field.h };
}

export function DocumentPage({ id }: { id: string }) {
  const { doc, missing, announcement, setDoc, reload, track } = useDocument(id);
  if (missing) return <NotFound />;
  if (!doc) return <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>;
  return <Loaded key={id} doc={doc} announcement={announcement} setDoc={setDoc} reload={reload} track={track} />;
}

interface LoadedProps {
  doc: DocumentJson;
  announcement: string;
  setDoc: (update: (doc: DocumentJson) => DocumentJson) => void;
  reload: () => Promise<void>;
  track: Track;
}

function Loaded({ doc, announcement, setDoc, reload, track }: LoadedProps) {
  const me = useMe();
  const { navigate } = useRouter();
  const pdf = usePdf(`/api/documents/${doc.id}/original.pdf`);
  const phone = useMedia(PHONE);
  const compact = useMedia(COMPACT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<FieldKind | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [position, setPosition] = useState("");
  const [updates, setUpdates] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [preview, setPreview] = useState<{ id: string; box: Box } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; kind: FieldKind } | null>(null);
  const [images, setImages] = useState<Record<number, string>>({});
  const pendingFocus = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastPointer = useRef<string>("mouse");

  const canManage = me.role === "owner" || (me.role === "member" && doc.ownerId === me.user.id);
  const draft = doc.status === "draft";
  const editable = canManage && draft;
  const selected = doc.fields.find((f) => f.id === selectedId) ?? null;
  const names = useMemo(() => new Map(doc.recipients.map((r) => [r.id, r.name])), [doc.recipients]);

  const save = useFieldSaver(doc.id, track, () => void reload());

  useEffect(() => {
    if (pendingFocus.current) {
      const el = document.getElementById(`field-${pendingFocus.current}`);
      if (el) {
        pendingFocus.current = null;
        el.focus();
      }
    }
  });

  useEffect(() => {
    const onScroll = () => {
      const middle = window.innerHeight / 2;
      for (let n = 1; n <= doc.pageCount; n += 1) {
        const rect = document.getElementById(`page-${n}`)?.getBoundingClientRect();
        if (rect && rect.top <= middle && rect.bottom >= middle) {
          setCurrentPage(n);
          return;
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [doc.pageCount]);

  useEffect(() => {
    if (!phone) setSheetOpen(false);
  }, [phone]);

  const goToPage = (n: number) => {
    setCurrentPage(n);
    const el = document.getElementById(`page-${n}`);
    el?.scrollIntoView({ block: "start" });
    el?.focus({ preventScroll: true });
  };

  const patchLocal = useCallback(
    (fieldId: string, patch: Partial<FieldJson>) => {
      setDoc((d) => ({ ...d, fields: d.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) }));
    },
    [setDoc],
  );

  const edit = useCallback(
    (field: FieldJson, patch: Partial<Pick<FieldJson, "recipientId" | "page" | "x" | "y" | "w" | "h" | "required" | "label">>, announce: boolean) => {
      patchLocal(field.id, patch);
      save(field.id, patch);
      if (announce) setPosition(positionCopy(patch.label ?? field.label, patch.page ?? field.page, { ...boxOf(field), ...patch }));
    },
    [patchLocal, save],
  );

  const place = async (kind: FieldKind, page: number, box: Box) => {
    const first = doc.recipients[0];
    if (!first) return;
    const created = await track(api.post<FieldJson>(`/api/documents/${doc.id}/fields`, { recipientId: first.id, kind, page, ...box }));
    setDoc((d) => ({ ...d, fields: [...d.fields, created] }));
    setSelectedId(created.id);
    pendingFocus.current = created.id;
    setPosition(positionCopy(created.label, created.page, created));
    setArmed(null);
  };

  const remove = async (field: FieldJson) => {
    const onPage = doc.fields.filter((f) => f.page === field.page);
    const next = onPage[onPage.findIndex((f) => f.id === field.id) + 1];
    setDoc((d) => ({ ...d, fields: d.fields.filter((f) => f.id !== field.id) }));
    setSelectedId(null);
    await track(api.del(`/api/documents/${doc.id}/fields/${field.id}`));
    if (next) {
      pendingFocus.current = next.id;
      setSelectedId(next.id);
    } else document.getElementById(`page-${field.page}`)?.focus({ preventScroll: true });
  };

  const deselect = () => {
    const page = selected?.page ?? currentPage;
    setSelectedId(null);
    document.getElementById(`page-${page}`)?.focus({ preventScroll: true });
  };

  const onFieldKey = (field: FieldJson, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!editable) return;
    if (event.key === "Escape") {
      event.preventDefault();
      deselect();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void remove(field);
      return;
    }
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const page = field.page + (event.key === "PageDown" ? 1 : -1);
      if (page < 1 || page > doc.pageCount) return;
      pendingFocus.current = field.id;
      edit(field, { page }, true);
      return;
    }
    const next = keyedMove(event, boxOf(field));
    if (next) {
      event.preventDefault();
      edit(field, next, true);
    }
  };

  const commitPointer = (field: FieldJson, patch: Partial<Box> & { page?: number }, announce: boolean) => {
    if (patch.page !== undefined) pendingFocus.current = field.id;
    edit(field, patch, announce);
  };

  const sheetClick = (event: React.MouseEvent<HTMLDivElement>, page: number) => {
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && !target.classList.contains("sheet-image")) return;
    if (armed && editable) {
      const rect = event.currentTarget.getBoundingClientRect();
      void place(armed, page, boxCenteredAt(armed, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height));
      return;
    }
    setSelectedId(null);
  };

  const paletteDown = (kind: FieldKind, event: PointerEvent<HTMLButtonElement>) => {
    lastPointer.current = event.pointerType;
    if (event.pointerType === "touch" || event.button !== 0 || !editable) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    const onMove = (e: globalThis.PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > 4) dragging = true;
      if (dragging) setGhost({ x: e.clientX, y: e.clientY, kind });
    };
    const onUp = (e: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGhost(null);
      if (!dragging) return;
      for (const el of document.querySelectorAll<HTMLElement>(".sheet")) {
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          void place(kind, Number(el.id.replace("page-", "")), boxCenteredAt(kind, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
          return;
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const paletteClick = (kind: FieldKind) => {
    if (lastPointer.current === "touch") {
      // Arming starts a placement: the selected field's properties step aside so the whole page can be tapped.
      setSelectedId(null);
      setArmed((current) => (current === kind ? null : kind));
      return;
    }
    lastPointer.current = "keyboard";
    void place(kind, currentPage, boxCenteredAt(kind, 0.5, 0.5));
  };

  const routing = (
    <Routing
      doc={doc}
      canManage={canManage}
      isOwnerRole={me.role === "owner"}
      updates={updates}
      announce={setUpdates}
      reload={reload}
      setDoc={setDoc}
      track={track}
      onSent={() => heading.current?.focus()}
      onTemplateSaved={() => navigate("/templates")}
    />
  );

  const failed = doc.recipients.find((r) => r.status === "declined");
  const pages = Array.from({ length: doc.pageCount }, (_, i) => i + 1);

  return (
    <>
      <ServiceNotice />
      <Status label="Document updates" className="sr-only">
        {announcement}
      </Status>
      <header className="doc-head">
        <h1 ref={heading} tabIndex={-1}>
          {doc.title}
        </h1>
        <span className="badge">{STATUS_WORDS[doc.status]}</span>
        <span className="nextstep">{doc.nextStep}</span>
        {phone ? (
          <button type="button" className="btn" onClick={() => setSheetOpen(true)}>
            Signing order
          </button>
        ) : null}
      </header>
      {doc.status === "declined" && failed ? <p className="banner outcome">{`${failed.name} declined: ${failed.declineReason ?? ""}`}</p> : null}
      {doc.status === "voided" ? <p className="banner outcome">{`Voided by ${doc.voidedByName ?? ""}: ${doc.voidReason ?? ""}`}</p> : null}
      {doc.status === "completed" && doc.completedSha256 ? (
        <div className="banner outcome completed">
          <span className="muted">Completed PDF SHA-256</span>
          <span className="hash">{doc.completedSha256}</span>
          <a href={`/api/documents/${doc.id}/completed.pdf`} className="textlink" download>
            Download completed PDF
          </a>
        </div>
      ) : null}
      {pdf.status === "unavailable" ? (
        <section className="banner-block">
          <h2>{PAGES_UNAVAILABLE.heading}</h2>
          <p>{PAGES_UNAVAILABLE.body}</p>
          <ul aria-label="Fields">
            {doc.fields.map((f) => (
              <li key={f.id}>{`${f.label} for ${names.get(f.recipientId) ?? ""}, page ${f.page}`}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="doc-layout">
        {compact ? null : (
        <nav aria-label="Pages" className="filmstrip">
          {pages.map((n) => (
            <button
              key={n}
              type="button"
              className="thumb"
              aria-current={n === currentPage ? "page" : undefined}
              tabIndex={n === currentPage ? 0 : -1}
              onClick={() => goToPage(n)}
              onKeyDown={(event) => {
                const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                (event.currentTarget.parentElement?.querySelectorAll("button")[n - 1 + step] as HTMLElement | undefined)?.focus();
              }}
            >
              <span className="thumb-sheet" style={{ aspectRatio: `${doc.pageSizes[n - 1]?.w ?? 612} / ${doc.pageSizes[n - 1]?.h ?? 792}` }}>
                {images[n] ? <img src={images[n]} alt="" /> : null}
              </span>
              <span>Page {n}</span>
            </button>
          ))}
        </nav>
        )}
        <div className="center">
          {compact ? (
            <label className="field-label page-select">
              Page
              <select value={currentPage} onChange={(e) => goToPage(Number(e.target.value))}>
                {pages.map((n) => (
                  <option key={n} value={n}>{`Page ${n} of ${doc.pageCount}`}</option>
                ))}
              </select>
            </label>
          ) : null}
          {editable ? (
            <div className="toolbar-wrap">
              <div role="toolbar" aria-label="Fields" className="toolbar">
                {KINDS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn"
                    disabled={doc.recipients.length === 0}
                    aria-pressed={armed === kind ? true : undefined}
                    onPointerDown={(event) => paletteDown(kind, event)}
                    onKeyDown={() => void (lastPointer.current = "keyboard")}
                    onClick={() => paletteClick(kind)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Status label="Field position" className="position mono">
                {position}
              </Status>
            </div>
          ) : null}
          <div className="stack-pages">
            {pages.map((n) => (
              <PageSheet
                key={n}
                number={n}
                count={doc.pageCount}
                size={doc.pageSizes[n - 1] ?? { w: 612, h: 792 }}
                pdf={pdf}
                onImage={(url) => setImages((previous) => (previous[n] === url ? previous : { ...previous, [n]: url }))}
                onClick={(event) => sheetClick(event, n)}
              >
                {doc.fields
                  .filter((f) => f.page === n)
                  .map((f) => (
                    <EditorField
                      key={f.id}
                      field={f}
                      recipientName={names.get(f.recipientId) ?? ""}
                      box={preview?.id === f.id ? preview.box : boxOf(f)}
                      selected={selectedId === f.id}
                      editable={editable}
                      select={setSelectedId}
                      preview={(fieldId, box) => setPreview(box ? { id: fieldId, box } : null)}
                      commit={commitPointer}
                      keyboard={onFieldKey}
                    />
                  ))}
              </PageSheet>
            ))}
          </div>
        </div>
        {!phone ? (
          <div className="routing-wrap">
            <div className="routing-scroll">{routing}</div>
            {editable ? (
              <FieldPanel
                open={selected !== null}
                field={selected}
                doc={doc}
                edge="right"
                change={(patch) => selected && edit(selected, patch, false)}
                close={deselect}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {phone && editable ? (
        <FieldPanel open={selected !== null} field={selected} doc={doc} edge="bottom" change={(patch) => selected && edit(selected, patch, false)} close={deselect} />
      ) : null}
      {phone ? (
        <Slide open={sheetOpen} edge="bottom">
          {(slideRef) => (
            <SheetBody slideRef={slideRef} onClose={() => setSheetOpen(false)} active={sheetOpen}>
              {routing}
            </SheetBody>
          )}
        </Slide>
      ) : null}
      {ghost ? createPortal(<div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }}>{KINDS.find((k) => k.kind === ghost.kind)?.label}</div>, document.body) : null}
    </>
  );
}

function SheetBody({ slideRef, onClose, active, children }: { slideRef: Ref<HTMLElement>; onClose: () => void; active: boolean; children: ReactNode }) {
  const own = useRef<HTMLDivElement | null>(null);
  useModal(own, onClose, active);
  return createPortal(
    <div className="scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Signing order"
        tabIndex={-1}
        className="sheet-dialog"
        ref={(node) => {
          own.current = node;
          if (typeof slideRef === "function") slideRef(node);
          else if (slideRef) (slideRef as { current: HTMLElement | null }).current = node;
        }}
      >
        <div className="sheet-head">
          <button type="button" className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
