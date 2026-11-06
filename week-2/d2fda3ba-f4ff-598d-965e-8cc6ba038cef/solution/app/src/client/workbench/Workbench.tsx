// The publish workbench (Publish tab): dossier address and state, the Exposure Ring with its slider,
// hop stepper and counters, the server boundary check, the live preview and the publish controls.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check, Copy, Eye, Link2Off, RotateCcw, Send, Trash2 } from "lucide-react";
import { api, HttpError } from "../api.ts";
import { loadDossiers } from "../sync.ts";
import { notesIn, update, useApp, type Note } from "../store.ts";
import { ErrorLine, Modal } from "../ui.tsx";
import { Ring, SPACING, VIEW } from "./Ring.tsx";
import { useCrossing, type Counts } from "./crossing.ts";
import { boundary, candidates, linkedFrom, MAX_HOP } from "../../shared/boundary.ts";
import { STATE_LABEL, transition } from "../../shared/dossier.ts";
import { boundaryLinks, renderBody } from "../../shared/render.ts";
import { formatWhen } from "../../shared/time.ts";
import type { Dossier, ManifestPreview, PreviewLink } from "../../shared/types.ts";

const BILLING_OUTAGE = "Billing is unavailable. Your plan hasn't changed — try again shortly.";
const HOPS = [0, 1, 2, 3, 4];
const hopMemory = new Map<string, number>();

type Check = { kind: "pending" } | { kind: "match"; n: number; m: number } | { kind: "mismatch" } | { kind: "failure"; detail: string | null };

function candidateNotes(notes: Note[], rootId: string) {
  return candidates(notes, rootId).map((n) => ({ id: n.id, title: n.title, aliases: n.aliases, frontmatter: n.frontmatter, body: n.body, private: n.private }));
}

export function Workbench() {
  const app = useApp();
  const signedIn = app.session.kind === "signed_in";
  const openNote = app.notes.find((n) => n.id === app.openNoteId);
  const rootedHere = app.dossiers.find((d) => d.root_note_id === openNote?.id);
  const selected = app.workbenchDossierId === "new" ? undefined : app.dossiers.find((d) => d.id === app.workbenchDossierId);
  const dossier = rootedHere ?? selected;

  if (!signedIn) {
    return <p className="pane-empty">Sign in from Account and add Publish to turn a slice of this case into a public dossier.</p>;
  }
  if (dossier) return <DossierBench key={dossier.id} dossier={dossier} openNote={openNote} />;
  if (!openNote) return <p className="pane-empty">Open the note that should be the dossier's root.</p>;
  return <CreateDossier root={openNote} />;
}

function CreateDossier({ root }: { root: Note }) {
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setError(null);
    setStatus("Creating dossier…");
    try {
      const { dossier } = await api<{ dossier: Dossier }>("POST", "/api/dossiers", { slug, root_note_id: root.id });
      update((s) => ({ dossiers: [...s.dossiers, dossier], workbenchDossierId: dossier.id }));
      setStatus("");
    } catch (e) {
      setStatus("");
      if (e instanceof HttpError && e.code === "publish_not_entitled") setError("Publishing needs the Publish add-on.");
      else if (e instanceof HttpError && e.code === "billing_unavailable") setError(BILLING_OUTAGE);
      else if (e instanceof HttpError) setError(e.body?.error.fields?.slug ?? e.message);
      else setError("The server can't be reached. Try again when you're back online.");
    }
  };
  return (
    <form className="create-dossier" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <h3 className="pane-heading">New dossier</h3>
      <p className="muted">Rooted at <strong>{root.title || "Untitled"}</strong>. The address becomes <span className="mono">/d/{slug || "…"}/</span> once published.</p>
      <label className="field">
        <span>Dossier address</span>
        <input aria-label="Dossier address" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="port-ellery-fuel" spellCheck={false} />
      </label>
      <button className="button" type="submit">Create dossier</button>
      {status && <p className="muted" role="status">{status}</p>}
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
  );
}

function DossierBench({ dossier, openNote }: { dossier: Dossier; openNote: Note | undefined }) {
  const app = useApp();
  const notes = notesIn(app.activeNotebookId);
  const root = notes.find((n) => n.id === dossier.root_note_id);
  const [hop, setHop] = useState(() => hopMemory.get(dossier.id) ?? dossier.radius ?? 0);
  const [drag, setDrag] = useState<number | null>(null);
  const [check, setCheck] = useState<Check>({ kind: "pending" });
  const [publishStatus, setPublishStatus] = useState("");
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "takedown" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSeq = useRef(0);
  const zone = app.session.kind === "signed_in" ? app.session.account.time_zone : "UTC";

  const cands = useMemo(() => (root ? candidateNotes(notes, root.id) : []), [notes, root?.id]);
  const insideAt = useMemo(() => HOPS.map((h) => (root ? boundary(cands, root.id, h) : null)), [cands, root?.id]);
  const countsAt = (h: number): Counts => [insideAt[h]?.inside.length ?? 0, insideAt[h]?.severed.length ?? 0];
  const view = useCrossing(hop, countsAt);
  const [n, m] = countsAt(hop);

  useEffect(() => {
    hopMemory.set(dossier.id, hop);
  }, [hop]);

  const signature = JSON.stringify(cands.map((c) => [c.id, c.title, c.aliases, c.body]));
  useEffect(() => {
    if (!root || drag !== null) return;
    const seq = (requestSeq.current += 1);
    setCheck({ kind: "pending" });
    api<ManifestPreview>("POST", `/api/dossiers/${dossier.id}/manifest-preview`, { radius: hop, notes: cands })
      .then((answer) => {
        if (seq !== requestSeq.current) return;
        const local = insideAt[hop];
        const same = local !== null && answer.public_count === local.inside.length && answer.severed_count === local.severed.length
          && answer.inside.every((i, k) => local.inside[k]?.note_id === i.note_id && local.inside[k]?.hop === i.hop);
        setCheck(same ? { kind: "match", n: answer.public_count, m: answer.severed_count } : { kind: "mismatch" });
      })
      .catch((e: unknown) => {
        if (seq !== requestSeq.current) return;
        setCheck({ kind: "failure", detail: e instanceof HttpError ? e.body?.error.fields?.notes ?? null : null });
      });
  }, [hop, signature, drag === null, dossier.id]);

  if (!root) {
    return <p className="pane-empty">This dossier's root note is in another notebook. Switch notebooks to work on it.</p>;
  }

  const moveTo = (h: number) => setHop(Math.max(0, Math.min(MAX_HOP, h)));
  const onSliderKey = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowRight: hop + 1, ArrowUp: hop + 1, ArrowLeft: hop - 1, ArrowDown: hop - 1, Home: 0, End: MAX_HOP };
    if (event.key in moves) {
      event.preventDefault();
      moveTo(moves[event.key]);
    }
  };
  const hopFromPointer = (event: PointerEvent) => {
    const rect = ((event.currentTarget as HTMLElement).parentElement as HTMLElement).getBoundingClientRect();
    const scale = VIEW / rect.width;
    const d = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2)) * scale;
    return Math.max(0, Math.min(MAX_HOP, d / SPACING - 0.5));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(hopFromPointer(event));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const value = hopFromPointer(event);
    setDrag(value);
    if (Math.floor(value + 1e-6) !== hop) setHop(Math.floor(value + 1e-6));
  };
  const onPointerUp = () => {
    if (drag === null) return;
    moveTo(Math.round(drag));
    setDrag(null);
  };

  const scale = (drag ?? hop) + 0.5;
  const fillInside = insideAt[view.fillHop]?.insideIds ?? new Set<string>();
  const cutInside = insideAt[view.cutHop]?.insideIds ?? new Set<string>();
  const [shownN, shownM] = view.counts;
  const announced = countsAt(view.announcedHop);

  const canPublish = transition(dossier.state, "publish") !== null && check.kind === "match" && !busy;
  const activeLink: PreviewLink | null = dossier.preview_link;

  const refresh = (next: Dossier) => update((s) => ({ dossiers: s.dossiers.map((d) => (d.id === next.id ? next : d)) }));
  const failure = (e: unknown, storageCopy: string) => {
    if (!(e instanceof HttpError)) return "The server can't be reached. Nothing changed.";
    if (e.code === "storage_unavailable") return storageCopy;
    if (e.code === "billing_unavailable") return BILLING_OUTAGE;
    if (e.code === "publish_not_entitled") return "Publishing needs the Publish add-on.";
    if (e.code === "publish_in_progress") return "Another publish of this dossier is still running.";
    return e.body?.error.fields?.notes ?? e.message;
  };

  const publish = async () => {
    setConfirm(null);
    setBusy(true);
    setPublishStatus("Publishing…");
    try {
      const { dossier: next } = await api<{ dossier: Dossier }>("POST", `/api/dossiers/${dossier.id}/publish`, { radius: hop, notes: cands });
      refresh(next);
      setPreviewUrl("");
      setPublishStatus(`Published ${next.public_count} notes · ${next.severed_count} links severed`);
    } catch (e) {
      setPublishStatus(failure(e, "Publish paused: storage unavailable. The live dossier hasn't changed."));
    } finally {
      setBusy(false);
    }
  };
  const takeDown = async () => {
    setConfirm(null);
    setBusy(true);
    setPublishStatus("Taking down…");
    try {
      const { dossier: next } = await api<{ dossier: Dossier }>("POST", `/api/dossiers/${dossier.id}/unpublish`);
      refresh(next);
      setPublishStatus("Dossier taken down");
    } catch (e) {
      setPublishStatus(failure(e, "Takedown paused: storage unavailable. Try again shortly."));
      void loadDossiers();
    } finally {
      setBusy(false);
    }
  };
  const reopen = async () => {
    setBusy(true);
    try {
      const { dossier: next } = await api<{ dossier: Dossier }>("POST", `/api/dossiers/${dossier.id}/reopen`);
      refresh(next);
      setPublishStatus("Reopened as draft");
    } catch (e) {
      setPublishStatus(failure(e, "Storage is unavailable. Nothing changed."));
    } finally {
      setBusy(false);
    }
  };
  const createPreview = async () => {
    setBusy(true);
    setPreviewStatus("Creating preview link…");
    try {
      const made = await api<{ preview_link: PreviewLink; url: string }>("POST", `/api/dossiers/${dossier.id}/preview-links`, { radius: hop, notes: cands });
      setPreviewUrl(new URL(made.url, location.origin).href);
      setPreviewStatus(`Preview link ready — expires ${formatWhen(made.preview_link.expires_at, zone)}`);
      const { dossier: next } = await api<{ dossier: Dossier }>("GET", `/api/dossiers/${dossier.id}`);
      refresh(next);
    } catch (e) {
      setPreviewStatus(failure(e, "Preview paused: storage unavailable."));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setConfirm(null);
    if (!activeLink) return;
    setBusy(true);
    try {
      await api("DELETE", `/api/dossiers/${dossier.id}/preview-links/${activeLink.id}`);
      const { dossier: next } = await api<{ dossier: Dossier }>("GET", `/api/dossiers/${dossier.id}`);
      refresh(next);
      setPreviewUrl("");
      setPreviewStatus("Preview link revoked");
    } catch (e) {
      setPreviewStatus(failure(e, "Preview paused: storage unavailable."));
    } finally {
      setBusy(false);
    }
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(previewUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const previewInside = insideAt[view.previewHop]?.insideIds ?? new Set<string>();
  const previewHtml = renderBody(root.body, boundaryLinks(cands, previewInside, () => "#"));
  const linkingNotes = linkedFrom(cands, previewInside, root.id);

  const checkCopy = {
    pending: "Checking boundary…",
    match: check.kind === "match" ? `Server boundary matches: ${check.n} public · ${check.m} severed` : "",
    mismatch: "Server boundary differs — publishing is blocked until it matches",
    failure: "Boundary check unavailable — try again",
  }[check.kind];

  return (
    <div className="workbench">
      <header className="dossier-head">
        <div>
          <p className="eyebrow">Dossier rooted at {root.title || "Untitled"}</p>
          <p className="dossier-address mono">
            {dossier.state === "published"
              ? <a href={dossier.url} target="_blank" rel="noopener">{location.host}{dossier.url}</a>
              : <span>{location.host}{dossier.url}</span>}
          </p>
        </div>
        <p className={`dossier-state state-${dossier.state}`} role="status" aria-label="Dossier state">{STATE_LABEL[dossier.state]}</p>
      </header>
      {openNote && openNote.id !== root.id && !app.dossiers.some((d) => d.root_note_id === openNote.id) && (
        <button type="button" className="text-button" onClick={() => update({ workbenchDossierId: "new" })}>
          Start a dossier from “{openNote.title || "Untitled"}”
        </button>
      )}
      <div className="bench-grid">
        <section className="bench-instrument" aria-label="Boundary">
          <Ring notes={notes} rootId={root.id} fillInside={fillInside} cutInside={cutInside} boundaryScale={scale}
            dragging={drag !== null} label="Exposure Ring">
            {(bearing) => <div
              className={`ring-handle${drag !== null ? " dragging" : ""}`}
              role="slider"
              tabIndex={0}
              aria-label="Publish boundary"
              aria-valuemin={0}
              aria-valuemax={MAX_HOP}
              aria-valuenow={hop}
              aria-valuetext={`Hop ${hop}`}
              style={{ left: `${50 + ((scale * SPACING) / VIEW) * Math.cos(bearing) * 100}%`, top: `${50 + ((scale * SPACING) / VIEW) * Math.sin(bearing) * 100}%` }}
              onKeyDown={onSliderKey}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />}
          </Ring>
          <div className="hop-stepper" role="radiogroup" aria-label="Hop">
            {HOPS.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={hop === h} tabIndex={hop === h ? 0 : -1} className="hop-radio"
                onClick={() => moveTo(h)}
                onKeyDown={(e) => {
                  const next = { ArrowRight: h + 1, ArrowDown: h + 1, ArrowLeft: h - 1, ArrowUp: h - 1 }[e.key];
                  if (next === undefined) return;
                  e.preventDefault();
                  const clamped = Math.max(0, Math.min(MAX_HOP, next));
                  moveTo(clamped);
                  (e.currentTarget.parentElement?.children[clamped] as HTMLElement | undefined)?.focus();
                }}
                aria-label={`Hop ${h}`}>
                {h}
              </button>
            ))}
          </div>
          <div className="exposure-counts" role="group" aria-label="Exposure counts">
            notes public <b className="num">{shownN}</b> · links severed <b className="num">{shownM}</b>
          </div>
          <p className="visually-hidden" role="status" aria-live="polite" aria-label="Boundary announcement">
            {`Hop ${view.announcedHop}: ${announced[0]} notes public, ${announced[1]} links severed`}
          </p>
          <p className={`boundary-check check-${check.kind}`} role="status" aria-label="Boundary check">{checkCopy}</p>
          {check.kind === "failure" && check.detail && <ErrorLine>{check.detail}</ErrorLine>}
        </section>
        <section className="live-preview" role="region" aria-label="Live preview">
          <p className="eyebrow">As it will publish · hop {view.previewHop}</p>
          <h1 className="preview-title">{root.title || "Untitled"}</h1>
          <div className="rendered preview-body" onClick={(e) => e.preventDefault()} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          <div className="preview-linked">
            <h2>Linked from</h2>
            {linkingNotes.length
              ? <ul>{linkingNotes.map((c) => <li key={c.id}><a href="#" onClick={(e) => e.preventDefault()}>{c.title}</a></li>)}</ul>
              : <p className="muted">No published note links here.</p>}
          </div>
        </section>
      </div>
      <section className="bench-actions" aria-label="Publishing">
        <div className="action-row">
          <button type="button" className="button button-publish" disabled={!canPublish} onClick={() => setConfirm("publish")}>
            <Send aria-hidden size={16} strokeWidth={1.5} /> Publish dossier
          </button>
          <button type="button" className="button" disabled={busy || transition(dossier.state, "unpublish") === null} onClick={() => setConfirm("takedown")}>
            <Trash2 aria-hidden size={16} strokeWidth={1.5} /> Take down dossier
          </button>
          <button type="button" className="button" disabled={busy || transition(dossier.state, "reopen") === null} onClick={() => void reopen()}>
            <RotateCcw aria-hidden size={16} strokeWidth={1.5} /> Reopen as draft
          </button>
        </div>
        <p className="action-status" role="status" aria-label="Publish status">{publishStatus}</p>
        <div className="action-row">
          <button type="button" className="button" disabled={busy || transition(dossier.state, "create_preview_link") === null} onClick={() => void createPreview()}>
            <Eye aria-hidden size={16} strokeWidth={1.5} /> Create preview link
          </button>
          <button type="button" className="button" disabled={busy || !activeLink} onClick={() => setConfirm("revoke")}>
            <Link2Off aria-hidden size={16} strokeWidth={1.5} /> Revoke preview link
          </button>
        </div>
        <div className="preview-link-row">
          <input aria-label="Preview link" readOnly value={previewUrl} placeholder={activeLink ? `Active until ${formatWhen(activeLink.expires_at, zone)}` : "No active preview link"} className="mono" />
          <button type="button" className="button" disabled={!previewUrl} onClick={() => void copyLink()} aria-label="Copy link">
            {copied ? <Check aria-hidden size={16} strokeWidth={1.5} /> : <Copy aria-hidden size={16} strokeWidth={1.5} />} {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <p className="action-status" role="status" aria-label="Preview link status">{previewStatus}</p>
      </section>
      {confirm === "publish" && (
        <Modal title="Publish dossier" onClose={() => setConfirm(null)}>
          <p>{`Publish ${n} notes and cut ${m} links?`}</p>
          <p className="muted">Readers will see only the notes inside hop {hop}. Every link that leaves the boundary renders as plain text.</p>
          <div className="modal-actions">
            <button type="button" className="button button-publish" onClick={() => void publish()}>Publish now</button>
            <button type="button" className="button" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {confirm === "takedown" && (
        <Modal title="Take down dossier" onClose={() => setConfirm(null)}>
          <p>Every page, index and preview of this dossier is deleted from storage, and its address answers not found.</p>
          <div className="modal-actions">
            <button type="button" className="button button-danger" onClick={() => void takeDown()}>Take down</button>
            <button type="button" className="button" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {confirm === "revoke" && (
        <Modal title="Revoke preview link" onClose={() => setConfirm(null)}>
          <p>The editor's next request shows that the link has ended.</p>
          <div className="modal-actions">
            <button type="button" className="button button-danger" onClick={() => void revoke()}>Revoke</button>
            <button type="button" className="button" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

