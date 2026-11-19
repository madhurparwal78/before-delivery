import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiFailure, api, newIdempotencyKey } from "../lib/api.js";
import { useReducedMotion, useServiceStatus, useLayout } from "../lib/hooks.js";
import { useCorridorView } from "../lib/useCorridorView.js";
import { baseHeightAt, centrelineAt } from "../lib/centreline.js";
import { loadTrackPolyline } from "../lib/track.js";
import { CHASE_SECONDS } from "../lib/motion.js";
import type { CorridorGlobe, TerrainSample } from "../lib/globe.js";
import { GlobeView } from "./GlobeView.jsx";
import { Readout } from "./Readout.jsx";
import { Ribbon } from "./Ribbon.jsx";
import { FindingsRail } from "./FindingsRail.jsx";
import { FindingEditor, type EditorDraft } from "./FindingEditor.jsx";
import { UploadDialog } from "./UploadDialog.jsx";
import { SubmitDialog } from "./SubmitDialog.jsx";
import { useAnnounce } from "./LiveRegions.jsx";
import {
  inspectionDueLine,
  linkExpiryLine,
  measure,
  setStateWord,
} from "../../shared/format.js";
import {
  ALREADY_SUBMITTED,
  SET_CLOSED,
  STORAGE_BANNER,
  SUBMIT_NEEDS_STORAGE,
  VIEW_LINK_COPIED,
  deletedFinding,
  emailQueued,
  linkResent,
  LINK_WITHDRAWN_STATUS,
  newLinkSent,
  railSummary,
  revisionStarted,
  saveFailedFields,
  savedFinding,
  savingFinding,
  selectedFinding,
  submittedQueued,
  submittedSent,
  submitting,
  terrainRefined,
} from "../../shared/copy.js";
import type {
  Asset,
  Corridor,
  CorridorDetail,
  Finding,
  FindingsSet,
  ReviewLink,
  Staff,
} from "../lib/types.js";

const SHEET_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

interface Props {
  corridorId: string;
  staff: Staff;
  onSignOut: () => void;
}

interface SetBundle {
  set: FindingsSet;
  findings: Finding[];
}

export function Workspace({ corridorId, staff, onSignOut }: Props): ReactNode {
  const [detail, setDetail] = useState<CorridorDetail | null>(null);
  const [bundle, setBundle] = useState<SetBundle | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [track, setTrack] = useState<{ lon: number; lat: number; height: number }[]>([]);
  const [tab, setTab] = useState<"findings" | "assets">("findings");
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState<"new" | "edit" | null>(null);
  const [editorErrors, setEditorErrors] = useState<Record<string, string>>({});
  const [editorPending, setEditorPending] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const [linkPending, setLinkPending] = useState(false);
  const [cameraHeight, setCameraHeight] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(0);
  const [globeReady, setGlobeReady] = useState(false);
  const [pickPoint, setPickPoint] = useState<{ lonDeg: number; latDeg: number } | null>(null);
  const [prefill, setPrefill] = useState({ groundHeight: "", terrainLevel: null as number | null });

  const status = useServiceStatus();
  const reducedMotion = useReducedMotion();
  const layout = useLayout();
  const announce = useAnnounce();
  const globe = useRef<CorridorGlobe | null>(null);
  const submitKey = useRef<string | null>(null);
  const refinements = useRef(new Set<string>());
  const sheetToggle = useRef<HTMLButtonElement | null>(null);
  const sheetBody = useRef<HTMLDivElement | null>(null);

  const towers = detail?.towers ?? [];
  const lengthM = detail?.corridor.length_m ?? 0;
  const findings = bundle?.findings ?? [];

  const loadSet = useCallback(async (corridor: Corridor): Promise<void> => {
    if (!corridor.current_set) {
      setBundle(null);
      return;
    }
    const result = await api<SetBundle>("GET", `/api/findings-sets/${corridor.current_set.id}`);
    setBundle(result);
  }, []);

  const loadAssets = useCallback(async (): Promise<void> => {
    const result = await api<{ assets: Asset[] }>("GET", `/api/corridors/${corridorId}/assets`);
    setAssets(result.assets);
  }, [corridorId]);

  useEffect(() => {
    void (async () => {
      const result = await api<CorridorDetail>("GET", `/api/corridors/${corridorId}`);
      setDetail(result);
      await loadSet(result.corridor);
      await loadAssets();
      setTrack(await loadTrackPolyline(`/api/corridors/${corridorId}/flight`, result.coverage));
    })();
  }, [corridorId, loadAssets, loadSet]);

  // Every status check re-reads the current findings set so the link line and
  // asset rows update in place, with no reload and no change of focus.
  const previousStorage = useRef(status.storage);
  useEffect(() => {
    if (status.ticks === 0 || !detail) return;
    void api<CorridorDetail>("GET", `/api/corridors/${corridorId}`)
      .then(async (result) => {
        setDetail(result);
        await loadSet(result.corridor);
        if (previousStorage.current !== status.storage) {
          previousStorage.current = status.storage;
          await loadAssets();
        }
      })
      .catch(() => undefined);
    // Re-reading is driven only by the status tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.ticks]);

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
    flightPath: `/api/corridors/${corridorId}/flight`,
    groundHeightAt,
    baseHeightAt: baseHeight,
    onSelectionAnnounce: (finding) =>
      announce(
        "View status",
        selectedFinding(finding.label, finding.span.label, finding.chainage_m),
      ),
  });

  // The camera eases to the chase pose once the answer to the latest input is
  // applied, unless the URL named an exact camera.
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

  const selected = findings.find((finding) => finding.id === view.selectedId) ?? null;
  const isAnalyst = staff.role === "vegetation_analyst";
  const isDraft = bundle?.set.state === "draft";

  const openEditor = useCallback(
    (mode: "new" | "edit", point?: { lonDeg: number; latDeg: number; sample: TerrainSample | null }) => {
      setEditorErrors({});
      if (mode === "new") {
        const atPlayhead =
          towers.length > 1 ? centrelineAt(towers, view.chainageM) : null;
        const sample = point
          ? point.sample
          : atPlayhead
            ? (globe.current?.terrainSample(atPlayhead.lonDeg, atPlayhead.latDeg) ?? null)
            : null;
        setPickPoint(point ? { lonDeg: point.lonDeg, latDeg: point.latDeg } : null);
        setPrefill({
          groundHeight: sample ? measure(sample.heightM) : "",
          terrainLevel: sample ? sample.level : null,
        });
      }
      setEditorOpen(mode);
    },
    [towers, view.chainageM, view.flight.answer],
  );

  // Keyboard shortcuts work from any control when no dialog is open and focus
  // is not in a text field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (editorOpen || uploadOpen || submitOpen) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k" && key !== "e" && key !== "n") return;
      if (key === "j" || key === "k") {
        event.preventDefault();
        const index = findings.findIndex((finding) => finding.id === view.selectedId);
        if (findings.length === 0) return;
        let next: number;
        if (index < 0) {
          next = key === "j" ? 0 : findings.length - 1;
        } else {
          next = key === "j" ? index + 1 : index - 1;
        }
        if (next < 0 || next >= findings.length) return;
        view.select(findings[next].id);
        return;
      }
      if (!isAnalyst || !isDraft) return;
      event.preventDefault();
      if (key === "e" && view.selectedId) openEditor("edit");
      if (key === "n") openEditor("new");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorOpen, uploadOpen, submitOpen, findings, view, isAnalyst, isDraft, openEditor]);

  // A finer terrain tile re-resolves a draft finding's ground height once.
  useEffect(() => {
    if (!isDraft || !isAnalyst || findings.length === 0) return undefined;
    const tick = async (): Promise<void> => {
      for (const finding of findings) {
        const sample = globe.current?.terrainSample(finding.lon_deg, finding.lat_deg);
        if (!sample) continue;
        if (finding.terrain_level !== null && sample.level <= finding.terrain_level) continue;
        const stamp = `${finding.id}:${sample.level}`;
        if (refinements.current.has(stamp)) continue;
        refinements.current.add(stamp);
        try {
          const result = await api<{ finding: Finding }>(
            "POST",
            `/api/findings/${finding.id}/terrain`,
            { body: { ground_height_m: sample.heightM, terrain_level: sample.level } },
          );
          setBundle((current) =>
            current === null
              ? current
              : {
                  ...current,
                  findings: current.findings.map((item) =>
                    item.id === result.finding.id ? result.finding : item,
                  ),
                },
          );
          announce(
            "Terrain updates",
            terrainRefined(
              result.finding.label,
              result.finding.ground_height_m,
              result.finding.terrain_level ?? sample.level,
              result.finding.clearance_m,
              result.finding.status,
            ),
          );
        } catch {
          /* A coarser or equal tile never changes a finding. */
        }
      }
    };
    const timer = window.setInterval(() => void tick(), 1500);
    return () => window.clearInterval(timer);
  }, [findings, isDraft, isAnalyst, announce]);

  const saveFinding = async (draft: EditorDraft): Promise<void> => {
    if (editorPending) return;
    const label = editorOpen === "edit" && selected ? selected.label : "new finding";
    setEditorPending(true);
    setEditorErrors({});
    announce("Save status", savingFinding(label));
    const numeric = (value: string): number | undefined =>
      value.trim() === "" ? undefined : Number(value);
    try {
      let saved: Finding;
      if (editorOpen === "edit" && selected) {
        const body: Record<string, unknown> = {
          canopy_height_m: numeric(draft.canopyHeight),
          canopy_radius_m: numeric(draft.canopyRadius),
          comment: draft.comment,
          chainage_m: selected.chainage_m,
          offset_m: numeric(draft.offset),
          ground_height_m: numeric(draft.groundHeight),
          terrain_level: draft.terrainLevel,
        };
        saved = (await api<{ finding: Finding }>("PATCH", `/api/findings/${selected.id}`, { body }))
          .finding;
      } else {
        const body: Record<string, unknown> = pickPoint
          ? {
              lon_deg: pickPoint.lonDeg,
              lat_deg: pickPoint.latDeg,
              ground_height_m: numeric(draft.groundHeight),
              terrain_level: draft.terrainLevel,
              canopy_height_m: numeric(draft.canopyHeight),
              canopy_radius_m: numeric(draft.canopyRadius),
              comment: draft.comment,
            }
          : {
              chainage_m: view.chainageM,
              offset_m: numeric(draft.offset),
              ground_height_m: numeric(draft.groundHeight),
              terrain_level: draft.terrainLevel,
              canopy_height_m: numeric(draft.canopyHeight),
              canopy_radius_m: numeric(draft.canopyRadius),
              comment: draft.comment,
            };
        saved = (
          await api<{ finding: Finding }>(
            "POST",
            `/api/findings-sets/${bundle!.set.id}/findings`,
            { body },
          )
        ).finding;
      }
      setBundle((current) =>
        current === null
          ? current
          : {
              ...current,
              findings: current.findings.some((item) => item.id === saved.id)
                ? current.findings.map((item) => (item.id === saved.id ? saved : item))
                : [...current.findings, saved].sort(
                    (a, b) => a.chainage_m - b.chainage_m || a.label.localeCompare(b.label),
                  ),
            },
      );
      announce("Save status", savedFinding(saved.label, saved.clearance_m, saved.status));
      setEditorOpen(null);
      setPickPoint(null);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setEditorErrors(error.fields);
        announce("Save status", saveFailedFields(label));
      } else if (error instanceof ApiFailure) {
        announce("Save status", saveFailedFields(label));
      }
    } finally {
      setEditorPending(false);
    }
  };

  const removeFinding = async (): Promise<void> => {
    if (!selected) return;
    const label = selected.label;
    try {
      await api("DELETE", `/api/findings/${selected.id}`);
      setBundle((current) =>
        current === null
          ? current
          : { ...current, findings: current.findings.filter((item) => item.id !== selected.id) },
      );
      announce("Save status", deletedFinding(label));
      setEditorOpen(null);
    } catch (error) {
      if (error instanceof ApiFailure) announce("Save status", saveFailedFields(label));
    }
  };

  const refreshSet = async (): Promise<void> => {
    const result = await api<CorridorDetail>("GET", `/api/corridors/${corridorId}`);
    setDetail(result);
    await loadSet(result.corridor);
  };

  const confirmSubmit = async (): Promise<void> => {
    if (submitPending || !bundle) return;
    setSubmitPending(true);
    submitKey.current ??= newIdempotencyKey();
    announce("Submit status", submitting(bundle.set.revision));
    try {
      const result = await api<{ set: FindingsSet; review_link: ReviewLink; email: string }>(
        "POST",
        `/api/findings-sets/${bundle.set.id}/submit`,
        { body: {}, idempotencyKey: submitKey.current },
      );
      const email = detail!.corridor.utility.forester_email;
      announce(
        "Submit status",
        result.email === "sent"
          ? submittedSent(result.set.revision, email)
          : submittedQueued(result.set.revision, email),
      );
      setSubmitOpen(false);
      submitKey.current = null;
      await refreshSet();
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === "illegal_transition") {
          announce("Submit status", ALREADY_SUBMITTED);
        } else if (error.code === "storage_unavailable") {
          announce("Submit status", SUBMIT_NEEDS_STORAGE);
        } else if (error.status === 422) {
          announce("Submit status", error.fields.findings ?? error.message);
        } else {
          announce("Submit status", error.message);
        }
      }
    } finally {
      setSubmitPending(false);
    }
  };

  const linkAction = async (action: "resend" | "revoke" | "regenerate"): Promise<void> => {
    if (linkPending || !bundle) return;
    setLinkPending(true);
    const email = detail!.corridor.utility.forester_email;
    try {
      if (action === "revoke") {
        await api("POST", `/api/findings-sets/${bundle.set.id}/review-link/revoke`, { body: {} });
        announce("Link status", LINK_WITHDRAWN_STATUS);
      } else {
        const result = await api<{ email: string }>(
          "POST",
          `/api/findings-sets/${bundle.set.id}/review-link/${action}`,
          { body: {}, idempotencyKey: newIdempotencyKey() },
        );
        if (result.email === "queued") {
          announce("Link status", emailQueued(email));
        } else {
          announce("Link status", action === "resend" ? linkResent(email) : newLinkSent(email));
        }
      }
      await refreshSet();
    } catch (error) {
      if (error instanceof ApiFailure) announce("Link status", error.message);
    } finally {
      setLinkPending(false);
    }
  };

  const setAction = async (action: "close" | "revisions"): Promise<void> => {
    if (!bundle) return;
    try {
      const result = await api<{ set: FindingsSet }>(
        "POST",
        `/api/findings-sets/${bundle.set.id}/${action}`,
        { body: {} },
      );
      announce(
        "Submit status",
        action === "close" ? SET_CLOSED : revisionStarted(result.set.revision),
      );
      await refreshSet();
    } catch (error) {
      if (error instanceof ApiFailure) announce("Submit status", error.message);
    }
  };

  const startSet = async (): Promise<void> => {
    try {
      await api("POST", `/api/corridors/${corridorId}/findings-sets`, { body: {} });
      await refreshSet();
    } catch (error) {
      if (error instanceof ApiFailure) announce("Submit status", error.message);
    }
  };

  const link = bundle?.set.review_link ?? null;
  const linkSuffix = useMemo(() => {
    if (!link) return "";
    if (link.status === "revoked") return " \u00b7 Withdrawn";
    if (link.status === "expired") return " \u00b7 Expired";
    return link.email_state === "sent" ? " \u00b7 Email sent" : " \u00b7 Email queued";
  }, [link]);

  const storageDown = status.storage === "unreachable";

  const canStartSet = isAnalyst && (bundle === null || bundle.set.state === "closed");
  const startSetButton = canStartSet ? (
    <button type="button" className="button" onClick={() => void startSet()}>
      Start findings set
    </button>
  ) : null;

  const railActions = (
    <>
      {startSetButton}
      {isAnalyst && isDraft ? (
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            submitKey.current = newIdempotencyKey();
            setSubmitOpen(true);
          }}
        >
          Submit for review
        </button>
      ) : null}
      {link && link.status === "live" && isAnalyst ? (
        <>
          <button
            type="button"
            className="button"
            aria-disabled={linkPending}
            onClick={() => void linkAction("resend")}
          >
            Resend link
          </button>
          <button
            type="button"
            className="button"
            aria-disabled={linkPending}
            onClick={() => void linkAction("revoke")}
          >
            Withdraw link
          </button>
        </>
      ) : null}
      {isAnalyst &&
      bundle &&
      ["submitted", "under_review", "accepted", "disputed"].includes(bundle.set.state) ? (
        <button
          type="button"
          className="button"
          aria-disabled={linkPending}
          onClick={() => void linkAction("regenerate")}
        >
          New link
        </button>
      ) : null}
      {isAnalyst && bundle?.set.state === "accepted" ? (
        <button type="button" className="button" onClick={() => void setAction("close")}>
          Close set
        </button>
      ) : null}
      {isAnalyst && bundle?.set.state === "disputed" ? (
        <button type="button" className="button" onClick={() => void setAction("revisions")}>
          Start revision
        </button>
      ) : null}
      {link && detail ? (
        <p className="link-line mono">
          {linkExpiryLine(link.expires_at, detail.corridor.utility.time_zone)}
          {linkSuffix}
        </p>
      ) : null}
    </>
  );

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

  if (!detail) {
    return <main className="workspace workspace--loading" />;
  }

  const rail = (
    <FindingsRail
      findings={findings}
      set={bundle?.set ?? null}
      staff={staff}
      assets={assets}
      selectedId={view.selectedId}
      nearIds={view.nearIds}
      tab={tab}
      expandedAssets={expandedAssets}
      onTab={setTab}
      onToggleAsset={(assetId) =>
        setExpandedAssets((current) => {
          const next = new Set(current);
          if (next.has(assetId)) {
            next.delete(assetId);
          } else {
            next.add(assetId);
          }
          return next;
        })
      }
      onSelect={(findingId) => view.select(findingId)}
      onOpenEditor={() => openEditor("edit")}
      onNewFinding={() => openEditor("new")}
      onUpload={() => setUploadOpen(true)}
      actions={railActions}
      startSet={startSetButton}
      readout={layout === "tablet" ? readout : undefined}
    />
  );

  return (
    <div className={`workspace workspace--${layout}`}>
      <a className="skip-link" href="#span-ribbon">
        Skip to span ribbon
      </a>
      <header className="workspace__header">
        <h1>{detail.corridor.name}</h1>
        <p className="workspace__meta">
          <span>{detail.corridor.utility.name}</span>
          <span className="mono">
            {inspectionDueLine(detail.corridor.inspection_due, detail.corridor.utility.time_zone)}
          </span>
          {detail.corridor.overdue ? <span className="badge badge--overdue">Overdue</span> : null}
          <span>{setStateWord(bundle?.set.state)}</span>
        </p>
        <nav className="workspace__nav">
          <a className="button button--quiet" href="/corridors">
            Corridors
          </a>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(window.location.href)
                .catch(() => undefined);
              announce("View status", VIEW_LINK_COPIED);
            }}
          >
            Copy view link
          </button>
          <button type="button" className="button button--quiet" onClick={onSignOut}>
            Sign out
          </button>
        </nav>
      </header>

      {storageDown ? (
        <div role="alert" className="banner">
          {STORAGE_BANNER}
        </div>
      ) : null}

      <div className="workspace__body">
        <div className="workspace__globe">
          <GlobeView
            assetBase="/api/assets"
            activeAssets={detail.active_assets}
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
            onPick={(lonDeg, latDeg, sample) => {
              if (!isAnalyst || !isDraft) return;
              openEditor("new", { lonDeg, latDeg, sample });
            }}
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
                bundle?.set.frozen?.finding_count ?? findings.length,
                bundle?.set.frozen?.violation_count ??
                  findings.filter((finding) => finding.status === "violation").length,
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
            {sheetOpen ? rail : null}
          </div>
        ) : (
          <aside className="rail" aria-label="Findings rail">
            {rail}
          </aside>
        )}
      </div>

      <div id="span-ribbon">
        <Ribbon
          towers={towers}
          lengthM={lengthM}
          coverage={detail.coverage}
          chainageM={view.chainageM}
          nearCount={view.nearIds.size}
          spanLabelParts={view.span}
          reducedMotion={reducedMotion}
          onScrub={(chainageM, mode) => view.scrub(chainageM, mode)}
          onRelease={(chainageM) => view.releasePlayhead(chainageM)}
        />
      </div>

      {editorOpen ? (
        <FindingEditor
          finding={editorOpen === "edit" ? selected : null}
          chainageM={editorOpen === "edit" && selected ? selected.chainage_m : view.chainageM}
          spanLabel={
            editorOpen === "edit" && selected ? selected.span.label : view.span.label
          }
          prefill={prefill}
          fieldErrors={editorErrors}
          pending={editorPending}
          onSave={(draft) => void saveFinding(draft)}
          onDelete={() => void removeFinding()}
          onClose={() => {
            setEditorOpen(null);
            setPickPoint(null);
          }}
        />
      ) : null}

      {uploadOpen ? (
        <UploadDialog
          corridorId={corridorId}
          onClose={() => setUploadOpen(false)}
          onAssetChange={() => void loadAssets()}
        />
      ) : null}

      {submitOpen && bundle ? (
        <SubmitDialog
          findingCount={findings.length}
          violationCount={findings.filter((finding) => finding.status === "violation").length}
          foresterEmail={detail.corridor.utility.forester_email}
          pending={submitPending}
          onConfirm={() => void confirmSubmit()}
          onClose={() => setSubmitOpen(false)}
        />
      ) : null}

    </div>
  );
}
