import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiFailure, api, newIdempotencyKey } from "../lib/api.js";
import { useLayout, useReducedMotion, useServiceStatus } from "../lib/hooks.js";
import { useCorridorView } from "../lib/useCorridorView.js";
import { baseHeightAt, nearestTower } from "../lib/centreline.js";
import { loadTrackPolyline } from "../lib/track.js";
import { CHASE_SECONDS, FLY_SECONDS } from "../lib/motion.js";
import type { CorridorGlobe } from "../lib/globe.js";
import { GlobeView } from "./GlobeView.jsx";
import { Readout } from "./Readout.jsx";
import { Ribbon } from "./Ribbon.jsx";
import { StatusTag } from "./FindingsRail.jsx";
import { useAnnounce } from "./LiveRegions.jsx";
import { chainage, linkExpiryLine, measure, towerLabel } from "../../shared/format.js";
import {
  DECISIONS_FINAL,
  LINK_EXPIRED_PAGE,
  LINK_UNKNOWN_PAGE,
  LINK_WITHDRAWN_PAGE,
  SEND_DECISIONS_FAILED,
  STORAGE_BANNER,
  decisionFailed,
  decisionSaved,
  decisionsSent,
  railSummary,
  selectedFinding,
} from "../../shared/copy.js";
import { FIELD_MESSAGES_DISPUTE_NOTE } from "../lib/messages.js";
import type { Finding, ReviewPayload } from "../lib/types.js";

const SHEET_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

type LinkProblem = "expired" | "revoked" | "unknown" | null;

interface Decision {
  decision: "accept" | "dispute";
  note: string;
}

export function ReviewPage({ token }: { token: string }): ReactNode {
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [problem, setProblem] = useState<LinkProblem>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState<Set<string>>(new Set());
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [final, setFinal] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [track, setTrack] = useState<{ lon: number; lat: number; height: number }[]>([]);
  const [cameraHeight, setCameraHeight] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(0);
  const [globeReady, setGlobeReady] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const status = useServiceStatus();
  const reducedMotion = useReducedMotion();
  const layout = useLayout();
  const announce = useAnnounce();
  const globe = useRef<CorridorGlobe | null>(null);
  const completeKey = useRef(newIdempotencyKey());
  const sheetToggle = useRef<HTMLButtonElement | null>(null);
  const sheetBody = useRef<HTMLDivElement | null>(null);

  const handleFailure = useCallback((error: unknown): boolean => {
    if (!(error instanceof ApiFailure)) return false;
    if (error.code === "link_revoked") {
      setProblem("revoked");
      return true;
    }
    if (error.code === "link_expired") {
      setProblem("expired");
      return true;
    }
    if (error.code === "link_not_found") {
      setProblem("unknown");
      return true;
    }
    return false;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await api<ReviewPayload>("GET", `/api/review/${token}`);
      setPayload(result);
      setDecisions(result.set.decisions as Record<string, Decision>);
      setFinal(result.read_only);
      setNoteOpen(
        new Set(
          Object.entries(result.set.decisions)
            .filter(([, value]) => value.decision === "dispute")
            .map(([id]) => id),
        ),
      );
      setNoteDrafts(
        Object.fromEntries(
          Object.entries(result.set.decisions).map(([id, value]) => [id, value.note]),
        ),
      );
    } catch (error) {
      if (!handleFailure(error)) setProblem("unknown");
    }
  }, [token, handleFailure]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!payload) return;
    void loadTrackPolyline(`/api/review/${token}/flight`, payload.coverage).then(setTrack);
  }, [payload?.coverage, token]);

  const towers = payload?.towers ?? [];
  const findings = payload?.findings ?? [];
  const lengthM = payload?.corridor.length_m ?? 0;

  const groundHeightAt = useCallback(
    (lonDeg: number, latDeg: number) => globe.current?.groundHeight(lonDeg, latDeg) ?? null,
    [],
  );
  const baseHeight = useCallback(
    (chainageM: number) => (towers.length > 1 ? baseHeightAt(towers, chainageM) : 0),
    [towers],
  );

  const view = useCorridorView({
    towers,
    lengthM,
    findings,
    flightPath: `/api/review/${token}/flight`,
    groundHeightAt,
    baseHeightAt: baseHeight,
    onSelectionAnnounce: (finding) =>
      announce(
        "View status",
        selectedFinding(finding.label, finding.span.label, finding.chainage_m),
      ),
  });

  const appliedUrlCamera = useRef(false);
  useEffect(() => {
    if (!globe.current || view.flight.pending || towers.length === 0) return;
    if (!appliedUrlCamera.current && view.initialCamera) {
      appliedUrlCamera.current = true;
      globe.current.setCameraExactly(view.initialCamera);
      return;
    }
    appliedUrlCamera.current = true;
    globe.current.moveCamera(
      view.chasePose(view.chainageM, view.flight.answer),
      reducedMotion ? 0 : CHASE_SECONDS,
    );
  }, [view.flight.pending, view.flight.answer, view.chainageM, reducedMotion, towers.length, globeReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      if (findings.length === 0) return;
      event.preventDefault();
      const index = findings.findIndex((finding) => finding.id === view.selectedId);
      let next: number;
      if (index < 0) {
        next = key === "j" ? 0 : findings.length - 1;
      } else {
        next = key === "j" ? index + 1 : index - 1;
      }
      if (next < 0 || next >= findings.length) return;
      view.select(findings[next].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [findings, view]);

  const storeDecision = async (finding: Finding, input: Decision): Promise<void> => {
    try {
      const result = await api<{ decision: { decision: "accept" | "dispute"; note: string } }>(
        "PUT",
        `/api/review/${token}/findings/${finding.id}/decision`,
        { body: input },
      );
      setDecisions((current) => ({
        ...current,
        [finding.id]: { decision: result.decision.decision, note: result.decision.note },
      }));
      setNoteErrors((current) => ({ ...current, [finding.id]: "" }));
      announce("Review status", decisionSaved(finding.label, result.decision.decision));
    } catch (error) {
      if (handleFailure(error)) return;
      if (error instanceof ApiFailure && error.code === "review_closed") {
        await load();
        setFinal(true);
        return;
      }
      if (error instanceof ApiFailure && error.status === 422) {
        setNoteErrors((current) => ({
          ...current,
          [finding.id]: error.fields.note ?? error.fields.decision ?? error.message,
        }));
        announce("Review status", error.fields.note ?? error.message);
        return;
      }
      announce("Review status", decisionFailed(finding.label));
    }
  };

  const send = async (): Promise<void> => {
    if (sendPending) return;
    setSendPending(true);
    try {
      const result = await api<{ summary: { accepted: number; disputed: number } }>(
        "POST",
        `/api/review/${token}/complete`,
        { body: {}, idempotencyKey: completeKey.current },
      );
      announce("Review status", decisionsSent(result.summary.accepted, result.summary.disputed));
      await load();
      setFinal(true);
    } catch (error) {
      if (handleFailure(error)) return;
      if (error instanceof ApiFailure && error.code === "review_closed") {
        await load();
        setFinal(true);
        return;
      }
      if (error instanceof ApiFailure && error.status === 422) {
        announce("Review status", error.fields.decisions ?? error.message);
        return;
      }
      announce("Review status", SEND_DECISIONS_FAILED);
    } finally {
      setSendPending(false);
    }
  };

  if (problem) {
    return (
      <main className="link-problem">
        <h1 className="wordmark">Spanwise</h1>
        <p role="status" aria-live="polite">
          {problem === "expired"
            ? LINK_EXPIRED_PAGE
            : problem === "revoked"
              ? LINK_WITHDRAWN_PAGE
              : LINK_UNKNOWN_PAGE}
        </p>
      </main>
    );
  }

  if (!payload) return <main className="workspace workspace--loading" />;

  const violations = findings.filter((finding) => finding.status === "violation").length;
  const frozen = payload.set.frozen;
  const storageDown = status.storage === "unreachable";

  const readout = (
    <Readout
      chainageM={view.chainageM}
      span={view.span}
      flight={view.flight}
      camera={view.camera}
      cameraHeightAboveGroundM={cameraHeight}
      streamingCount={streaming}
    />
  );

  const railBody = (
    <div className="rail__inner">
      {layout === "tablet" ? readout : null}
      <p className="rail__summary mono">
        {railSummary(frozen?.finding_count ?? findings.length, frozen?.violation_count ?? violations)}
      </p>
      {final ? <p className="rail__final">{DECISIONS_FINAL}</p> : null}
      <ul className="review-list" aria-label="Findings for review">
        {findings.map((finding) => {
          const stored = decisions[finding.id];
          const near = view.nearIds.has(finding.id);
          return (
            <li
              key={finding.id}
              className={near ? "review-item review-item--near" : "review-item"}
              aria-current={view.selectedId === finding.id ? true : undefined}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button, textarea, a")) return;
                view.select(finding.id);
              }}
            >
              <span className="option__label mono">{finding.label}</span>
              <StatusTag status={finding.status} />
              <span className="mono">{measure(finding.clearance_m)} m</span>
              <span className="option__span">{finding.span.label}</span>
              <span className="mono">{chainage(finding.chainage_m)} m</span>
              {near ? <span className="near-tag">Near playhead</span> : null}
              <Comment text={finding.comment} token={token} corridorId={payload.corridor.id} />

              {final ? (
                <>
                  <p className="review-item__decision">
                    {stored?.decision === "dispute"
                      ? `Disputed: ${stored.note}`
                      : stored?.decision === "accept"
                        ? "Accepted"
                        : ""}
                  </p>
                  <p className="review-item__span mono">
                    {finding.span.label} {"\u00b7"} nearest tower{" "}
                    {towerLabel(nearestTower(towers, finding.chainage_m).number)} {"\u00b7"} chainage{" "}
                    {chainage(finding.chainage_m)} m
                  </p>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      view.select(finding.id);
                      globe.current?.moveCamera(
                        view.chasePose(finding.chainage_m, null),
                        reducedMotion ? 0 : FLY_SECONDS,
                      );
                    }}
                  >
                    Fly to {finding.label}
                  </button>
                </>
              ) : (
                <>
                  <div className="review-item__controls">
                    <button
                      type="button"
                      className="button"
                      aria-pressed={stored?.decision === "accept"}
                      onClick={() => {
                        if (stored?.decision === "accept") return;
                        setNoteOpen((current) => {
                          const next = new Set(current);
                          next.delete(finding.id);
                          return next;
                        });
                        void storeDecision(finding, { decision: "accept", note: "" });
                      }}
                    >
                      Accept {finding.label}
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-pressed={stored?.decision === "dispute"}
                      onClick={() => {
                        setNoteOpen((current) => new Set(current).add(finding.id));
                        window.setTimeout(() => {
                          document
                            .querySelector<HTMLTextAreaElement>(
                              `[data-note="${finding.id}"]`,
                            )
                            ?.focus();
                        }, 0);
                      }}
                    >
                      Dispute {finding.label}
                    </button>
                  </div>
                  {noteOpen.has(finding.id) ? (
                    <label className="field">
                      <span className="visually-hidden">Dispute note for {finding.label}</span>
                      <textarea
                        className="field__input"
                        data-note={finding.id}
                        aria-label={`Dispute note for ${finding.label}`}
                        rows={2}
                        value={noteDrafts[finding.id] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((current) => ({
                            ...current,
                            [finding.id]: event.target.value,
                          }))
                        }
                        onBlur={() => {
                          const note = (noteDrafts[finding.id] ?? "").trim();
                          if (note === "") {
                            setNoteErrors((current) => ({
                              ...current,
                              [finding.id]: FIELD_MESSAGES_DISPUTE_NOTE,
                            }));
                            return;
                          }
                          if (stored?.decision === "dispute" && stored.note === note) return;
                          void storeDecision(finding, { decision: "dispute", note });
                        }}
                      />
                      {noteErrors[finding.id] ? (
                        <span className="field__error">{noteErrors[finding.id]}</span>
                      ) : null}
                    </label>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {!final ? (
        <button
          type="button"
          className="button button--primary"
          aria-disabled={sendPending}
          onClick={() => void send()}
        >
          Send decisions
        </button>
      ) : null}
    </div>
  );

  return (
    <div className={`workspace workspace--${layout}`}>
      <a className="skip-link" href="#span-ribbon">
        Skip to span ribbon
      </a>
      <header className="workspace__header">
        <h1>
          {payload.corridor.name}, revision {payload.set.revision}
        </h1>
        <p className="workspace__meta">
          <span>{payload.contractor.name}</span>
          <span>{payload.corridor.utility.name}</span>
          <span className="mono">
            {linkExpiryLine(payload.expires_at, payload.corridor.utility.time_zone)}
          </span>
        </p>
      </header>

      {storageDown ? (
        <div role="alert" className="banner">
          {STORAGE_BANNER}
        </div>
      ) : null}

      <div className="workspace__body">
        <div className="workspace__globe">
          <GlobeView
            assetBase={`/api/review/${token}/assets`}
            activeAssets={payload.active_assets}
            towers={towers}
            trackPositions={track}
            findings={findings}
            nearIds={view.nearIds}
            selectedId={view.selectedId}
            dronePosition={
              view.flight.pending || !view.flight.answer?.covered
                ? null
                : (view.flight.answer.position ?? null)
            }
            storageReachable={!storageDown}
            reducedMotion={reducedMotion}
            onReady={(instance) => {
              globe.current = instance;
              setGlobeReady(true);
            }}
            onCameraChange={(pose, height) => {
              view.setCamera(pose);
              setCameraHeight(height);
            }}
            onStreamingChange={setStreaming}
          />
          {layout !== "tablet" ? readout : null}
        </div>

        {layout === "phone" ? (
          <div
            className={sheetOpen ? "sheet sheet--open" : "sheet"}
            ref={sheetBody}
            onKeyDown={(event) => {
              if (!sheetOpen || event.key !== "Tab") return;
              const nodes = [
                ...(sheetBody.current?.querySelectorAll<HTMLElement>(SHEET_FOCUSABLE) ?? []),
              ];
              if (nodes.length === 0) return;
              const first = nodes[0];
              const last = nodes[nodes.length - 1];
              if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              }
            }}
          >
            <p className="rail__summary mono">
              {railSummary(
                frozen?.finding_count ?? findings.length,
                frozen?.violation_count ?? violations,
              )}
            </p>
            <button
              type="button"
              className="button"
              ref={sheetToggle}
              aria-expanded={sheetOpen}
              onClick={() => {
                const next = !sheetOpen;
                setSheetOpen(next);
                if (next) {
                  window.setTimeout(() => {
                    const nodes = sheetBody.current?.querySelectorAll<HTMLElement>(SHEET_FOCUSABLE);
                    const firstInside = [...(nodes ?? [])].find(
                      (node) => node !== sheetToggle.current,
                    );
                    firstInside?.focus();
                  }, 0);
                } else {
                  sheetToggle.current?.focus();
                }
              }}
            >
              {sheetOpen ? "Hide findings" : "Show findings"}
            </button>
            {sheetOpen ? railBody : null}
          </div>
        ) : (
          <aside className="rail" aria-label="Findings rail">
            {railBody}
          </aside>
        )}
      </div>

      <div id="span-ribbon">
        <Ribbon
          towers={towers}
          lengthM={lengthM}
          coverage={payload.coverage}
          chainageM={view.chainageM}
          nearCount={view.nearIds.size}
          spanLabelParts={view.span}
          reducedMotion={reducedMotion}
          onScrub={(chainageM, mode) => view.scrub(chainageM, mode)}
          onRelease={(chainageM) => view.releasePlayhead(chainageM)}
        />
      </div>
    </div>
  );
}

/**
 * A comment URL for this app's corridor or any review link renders as an
 * "Open this view" link that lands on this review with the same view state.
 */
function Comment({
  text,
  token,
  corridorId,
}: {
  text: string;
  token: string;
  corridorId: string;
}): ReactNode {
  if (text === "") return null;
  const parts = text.split(/(\s+)/);
  return (
    <p className="review-item__comment">
      {parts.map((part, index) => {
        const viewUrl = asViewLink(part, token, corridorId);
        return viewUrl ? (
          <a key={index} href={viewUrl}>
            Open this view
          </a>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </p>
  );
}

function asViewLink(candidate: string, token: string, corridorId: string): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  const isCorridor = url.pathname === `/corridors/${corridorId}`;
  const isReview = /^\/review\/[^/]+$/.test(url.pathname);
  if (!isCorridor && !isReview) return null;
  return `/review/${token}${url.search}`;
}
