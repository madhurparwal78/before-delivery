// The review page: the forester decides each finding through the link; once decisions are final
// it shows each finding's decision, span line and Fly to.
import { Plane, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { api, ApiFailure, newIdempotencyKey, type Decision, type Finding, type ReviewData } from "../api";
import { Notice, StatusWord } from "../components/bits";
import { RailSheet } from "../components/RailSheet";
import { Readout, useCameraLine } from "../components/Readout";
import { SpanRibbon } from "../components/SpanRibbon";
import { GlobeArea, useCorridorStage, useMedia } from "../components/Stage";
import { nearestTower } from "../corridorMath";
import { isTyping } from "../focus";
import { chainageText, linkExpiryLine, metres2, summaryLine } from "../format";
import { useStatusChecks } from "../useStatusChecks";
import type { CorridorView } from "../view";
import { readUrl } from "../view";

type Problem = "expired" | "revoked" | "unknown";

const PROBLEM_COPY: Record<Problem, string> = {
  expired: "This review link has expired. Ask your survey contractor for a new one.",
  revoked: "This review link has been withdrawn. Ask your survey contractor for a new one.",
  unknown: "This review link does not exist.",
};

function problemOf(failure: ApiFailure): Problem | null {
  if (failure.code === "link_expired") return "expired";
  if (failure.code === "link_revoked") return "revoked";
  if (failure.code === "link_not_found") return "unknown";
  return null;
}

export function ReviewPage({ token }: { token: string }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<ReviewData>("GET", `/api/review/${encodeURIComponent(token)}`));
    } catch (error) {
      if (error instanceof ApiFailure) setProblem(problemOf(error) ?? "unknown");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = useCallback(
    (failure: ApiFailure) => {
      const found = problemOf(failure);
      if (found !== null) setProblem(found);
      else if (failure.code === "review_closed") void load();
    },
    [load],
  );

  if (problem !== null) {
    return (
      <main className="signin">
        <div className="signin-sheet">
          <p className="wordmark" style={{ fontSize: "var(--size-h1)" }}>
            Spanwise
          </p>
          <div className="signin-rule" aria-hidden="true" />
          <p role="alert">{PROBLEM_COPY[problem]}</p>
        </div>
      </main>
    );
  }
  if (data === null) {
    return (
      <main className="list-page" aria-busy="true">
        <p className="visually-hidden">Loading review</p>
        {[0, 1, 2].map((i) => (
          <div className="skeleton-row" key={i} />
        ))}
      </main>
    );
  }
  return <Review token={token} data={data} reload={load} onFailure={fail} />;
}

/** Comment text with each view link of this app replaced by an "Open this view" link to this review. */
function CommentText({ text, token, corridorId, onOpen }: { text: string; token: string; corridorId: string; onOpen: (href: string) => void }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const start = match.index;
    const raw = match[0];
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }
    const ours = url !== null && url.origin === location.origin && (url.pathname === `/corridors/${corridorId}` || /^\/review\/[^/]+$/.test(url.pathname));
    if (!ours || url === null) continue;
    parts.push(text.slice(last, start));
    const href = `/review/${token}${url.search}`;
    parts.push(
      <a
        key={start}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          onOpen(href);
        }}
      >
        Open this view
      </a>,
    );
    last = start + raw.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

interface ReviewProps {
  token: string;
  data: ReviewData;
  reload: () => Promise<void>;
  onFailure: (failure: ApiFailure) => void;
}

function Review({ token, data, reload, onFailure }: ReviewProps) {
  const corridor = data.corridor;
  const findings = data.findings;
  const final = data.read_only;
  const phone = useMedia("(max-width: 767px)");
  const tablet = useMedia("(min-width: 768px) and (max-width: 1023px)");
  const [reviewMessage, setReviewMessage] = useState("");
  const [viewMessage, setViewMessage] = useState("");
  const [stored, setStored] = useState<Record<string, Decision>>(data.set.decisions);
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(data.set.decisions).map(([id, d]) => [id, d.note])),
  );
  const [noteOpen, setNoteOpen] = useState<ReadonlySet<string>>(new Set());
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const sendBusy = useRef(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [streaming, setStreaming] = useState(0);
  const noteBoxes = useRef(new Map<string, HTMLTextAreaElement>());
  const [focusNote, setFocusNote] = useState<string | null>(null);

  useEffect(() => {
    setStored(data.set.decisions);
  }, [data.set.decisions]);

  const stage = useCorridorStage({
    detail: data,
    findings,
    flightPath: `/api/review/${encodeURIComponent(token)}/flight`,
    onAnnounce: setViewMessage,
    onFailure,
  });
  const { shape, rig, view, snapshot, nearIds } = stage;
  const camera = useCameraLine(rig, shape);
  const status = useStatusChecks(() => undefined);

  useEffect(() => {
    if (focusNote === null) return;
    noteBoxes.current.get(focusNote)?.focus();
    setFocusNote(null);
  }, [focusNote, noteOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if ((key !== "j" && key !== "k") || findings.length === 0) return;
      event.preventDefault();
      const index = findings.findIndex((f) => f.id === snapshot.selectedId);
      const next = index < 0 ? (key === "j" ? 0 : findings.length - 1) : Math.min(findings.length - 1, Math.max(0, index + (key === "j" ? 1 : -1)));
      const target = findings[next];
      if (target !== undefined && target.id !== snapshot.selectedId) view.select(target.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findings, snapshot.selectedId, view]);

  /** Sends a decision; the pressed state changes only after the server stores it. */
  const decide = async (finding: Finding, decision: "accept" | "dispute", note: string) => {
    try {
      const result = await api<{ decision: { finding_id: string; decision: "accept" | "dispute"; note: string } }>(
        "PUT",
        `/api/review/${encodeURIComponent(token)}/findings/${finding.id}/decision`,
        { body: { decision, note } },
      );
      setStored((s) => ({ ...s, [finding.id]: { decision: result.decision.decision, note: result.decision.note } }));
      setNoteErrors((e) => ({ ...e, [finding.id]: "" }));
      if (decision === "accept") setNoteOpen((open) => new Set([...open].filter((id) => id !== finding.id)));
      setReviewMessage(`${finding.label} marked ${decision === "accept" ? "accepted" : "disputed"}.`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.networkOrServer) setReviewMessage(`Could not save the decision for ${finding.label}. Try again.`);
      else if (error.status === 422) {
        const message = Object.values(error.fields).join(" ");
        setNoteErrors((e) => ({ ...e, [finding.id]: message }));
        setReviewMessage(message);
      } else onFailure(error);
    }
  };

  const leaveNote = (finding: Finding) => {
    const text = notes[finding.id] ?? "";
    if (text.trim() === "") {
      setNoteErrors((e) => ({ ...e, [finding.id]: "Add a note explaining the dispute." }));
      return;
    }
    const current = stored[finding.id];
    if (current?.decision === "dispute" && current.note === text) return;
    void decide(finding, "dispute", text);
  };

  const send = async () => {
    if (sendBusy.current) return;
    sendBusy.current = true;
    setSending(true);
    try {
      const result = await api<{ summary: { accepted: number; disputed: number } }>("POST", `/api/review/${encodeURIComponent(token)}/complete`, {
        body: {},
        idempotencyKey: newIdempotencyKey(),
      });
      setReviewMessage(`Decisions sent: ${result.summary.accepted} accepted, ${result.summary.disputed} disputed.`);
      await reload();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.networkOrServer) setReviewMessage("Could not send the decisions. Try again.");
      else if (error.status === 422) setReviewMessage(Object.values(error.fields).join(" "));
      else onFailure(error);
    } finally {
      sendBusy.current = false;
      setSending(false);
    }
  };

  const openView = (href: string) => {
    history.pushState(null, "", href);
    view.open(readUrl());
  };

  const selectItem = (event: MouseEvent<HTMLLIElement>, finding: Finding, current: CorridorView) => {
    if (event.target instanceof Element && event.target.closest("button, a, textarea, input") !== null) return;
    if (finding.id !== snapshot.selectedId) current.select(finding.id);
  };

  const drone = snapshot.drone.kind === "placed" ? snapshot.drone.answer.position : null;
  const readout = (className: string) => (
    <Readout shape={shape} chainageM={snapshot.chainageM} drone={snapshot.drone} camera={camera} streaming={streaming} className={className} />
  );
  const assetUrl = useCallback((assetId: string, path: string) => `/api/review/${encodeURIComponent(token)}/assets/${assetId}/files/${path}`, [token]);

  const rail = (
    <>
      {tablet && <div className="rail-readout">{readout("")}</div>}
      {!phone && (
        <div className="rail-summary">
          <p className="summary">{summaryLine(findings)}</p>
        </div>
      )}
      {final && <p className="final-note">Decisions for this revision are final.</p>}
      <ul className="findings-list" aria-label="Findings for review">
        {findings.map((f) => {
          const decision = stored[f.id];
          const showNote = !final && (noteOpen.has(f.id) || decision?.decision === "dispute");
          const tower = nearestTower(shape, f.chainage_m);
          return (
            <li
              key={f.id}
              className={`finding${nearIds.has(f.id) ? " near" : ""}`}
              aria-current={f.id === snapshot.selectedId ? "true" : undefined}
              onClick={(event) => selectItem(event, f, view)}
            >
              <span className="label">{f.label}</span>
              <span className="line">
                <StatusWord status={f.status} />
                <span>
                  Clearance <span className="figure">{metres2(f.clearance_m)}</span>
                </span>
                {nearIds.has(f.id) && <span className="near-tag">Near playhead</span>}
              </span>
              <span />
              <span className="line meta">
                <span>{f.span.label}</span>
                <span>
                  chainage <span className="figure">{chainageText(f.chainage_m)}</span>
                </span>
              </span>
              {f.comment !== "" && (
                <p className="comment">
                  <CommentText text={f.comment} token={token} corridorId={corridor.id} onOpen={openView} />
                </p>
              )}
              <div className="decide">
                {final ? (
                  <>
                    <p>{decision === undefined ? "" : decision.decision === "accept" ? "Accepted" : `Disputed: ${decision.note}`}</p>
                    <p className="meta mono">
                      {f.span.label} · nearest tower T{tower?.number ?? 1} · chainage {chainageText(f.chainage_m)}
                    </p>
                    <div className="buttons">
                      <button type="button" className="button" onClick={() => view.scrub(f.chainage_m, "fly")}>
                        <Plane size={16} aria-hidden="true" />
                        Fly to {f.label}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="buttons">
                      <button
                        type="button"
                        className="button"
                        aria-pressed={decision?.decision === "accept"}
                        onClick={() => {
                          if (decision?.decision !== "accept") void decide(f, "accept", "");
                        }}
                      >
                        Accept {f.label}
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-pressed={decision?.decision === "dispute"}
                        onClick={() => {
                          setNoteOpen((open) => new Set([...open, f.id]));
                          setFocusNote(f.id);
                        }}
                      >
                        Dispute {f.label}
                      </button>
                    </div>
                    {showNote && (
                      <div className="field" data-invalid={(noteErrors[f.id] ?? "") !== ""}>
                        <label htmlFor={`note-${f.id}`}>Dispute note for {f.label}</label>
                        <textarea
                          id={`note-${f.id}`}
                          ref={(element) => {
                            if (element === null) noteBoxes.current.delete(f.id);
                            else noteBoxes.current.set(f.id, element);
                          }}
                          value={notes[f.id] ?? ""}
                          onChange={(event) => {
                            const text = event.target.value;
                            setNotes((n) => ({ ...n, [f.id]: text }));
                          }}
                          onBlur={() => leaveNote(f)}
                        />
                        {(noteErrors[f.id] ?? "") !== "" && <p className="field-error">{noteErrors[f.id]}</p>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!final && (
        <div className="rail-footer">
          <button type="button" className="button primary" aria-disabled={sending} onClick={() => void send()}>
            <Send size={16} aria-hidden="true" />
            Send decisions
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="corridor-app">
      <a
        className="skip"
        href="#span-ribbon-slider"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("span-ribbon-slider")?.focus();
        }}
      >
        Skip to span ribbon
      </a>
      <header className="cw-header">
        <div className="cw-title">
          <p className="crumbs wordmark">Spanwise</p>
          <h1>
            {corridor.name}, revision {data.set.revision}
          </h1>
          <p className="cw-facts">
            <span className="fact">{data.contractor.name}</span>
            <span className="fact">{corridor.utility.name}</span>
          </p>
          <p className="link-line">{linkExpiryLine(data.expires_at, corridor.utility.time_zone)}</p>
        </div>
      </header>
      <main className="cw-body">
        <GlobeArea
          shape={shape}
          rig={rig}
          assets={data.active_assets}
          assetUrl={assetUrl}
          storageOk={status.storage !== "unreachable"}
          findings={findings}
          nearIds={nearIds}
          selectedId={snapshot.selectedId}
          drone={drone === null ? null : { lonDeg: drone.lon_deg, latDeg: drone.lat_deg, heightM: drone.height_m }}
          coverage={data.coverage}
          onStreaming={setStreaming}
          onTerrainTile={() => undefined}
          onPick={() => undefined}
          overlays={
            <>
              {!tablet && readout("readout-float")}
              <div className="notices">
                <Notice name="Review status" text={reviewMessage} />
                <Notice name="View status" text={viewMessage} />
              </div>
            </>
          }
        />
        <RailSheet phone={phone} expanded={sheetOpen} onExpandedChange={setSheetOpen} summary={<p className="summary">{summaryLine(findings)}</p>}>
          {rail}
        </RailSheet>
      </main>
      <SpanRibbon
        shape={shape}
        coverage={data.coverage}
        chainageM={snapshot.chainageM}
        glide={snapshot.glide}
        nearCount={nearIds.size}
        onScrub={(c, kind) => view.scrub(c, kind)}
        onRelease={() => view.release()}
      />
    </div>
  );
}
