// The corridor workspace: header with the set's actions, the globe, the findings rail (Findings and
// Assets tabs), the position readout and the span ribbon.
import { Link2, LogOut, Pencil, Plus, Send, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acceptsFindingChanges, allowsNewSet, frozenCounts, nextState, type SetAction } from "../../../shared/findingsSetRules";
import { pointAt, project } from "../../../shared/geodesy";
import { spanLabel } from "../../../shared/text";
import { api, ApiFailure, newIdempotencyKey, type Asset, type CorridorDetail, type Finding, type FindingsSet, type ReviewLink, type Staff } from "../api";
import { AssetsPanel, UploadDialog, type PickedFile } from "../components/Assets";
import { Notice, OverdueBadge, StakeDrawing, StatusWord } from "../components/bits";
import { FindingEditor, type EditorTarget } from "../components/FindingEditor";
import { RailSheet } from "../components/RailSheet";
import { Readout, useCameraLine } from "../components/Readout";
import { SpanRibbon } from "../components/SpanRibbon";
import { GlobeArea, useCorridorStage, useMedia } from "../components/Stage";
import { SubmitDialog, type SubmitResult } from "../components/SubmitDialog";
import { clampChainage, spanOf } from "../corridorMath";
import { dialogOpen, isTyping } from "../focus";
import { chainageText, inspectionDueLine, linkExpiryLine, metres2, setStateLabel, summaryLine } from "../format";
import type { Pick, TerrainTile } from "../globe/scene";
import { TerrainRefinement } from "../refinement";
import { navigate } from "../router";
import { startUpload } from "../upload";
import { useStatusChecks } from "../useStatusChecks";

type DialogKind = { kind: "editor"; target: EditorTarget } | { kind: "submit"; opener: HTMLElement | null } | { kind: "upload"; opener: HTMLElement | null };
/** One opening of a dialog; its sequence number keys the component so a fresh opening never reuses a leaving one. */
type Dialogs = (DialogKind & { seq: number }) | null;
type Messages = Record<"save" | "terrain" | "submit" | "link" | "upload" | "view", string>;
type LinkAction = "resend" | "revoke" | "regenerate";

const NO_MESSAGES: Messages = { save: "", terrain: "", submit: "", link: "", upload: "", view: "" };

function byRailOrder(a: Finding, b: Finding): number {
  return a.chainage_m - b.chainage_m || Number(a.label.slice(2)) - Number(b.label.slice(2));
}

function linkSuffix(link: ReviewLink): string {
  if (link.status === "revoked") return " · Withdrawn";
  if (link.status === "expired") return " · Expired";
  return link.email_state === "queued" ? " · Email queued" : " · Email sent";
}

export function WorkspacePage({ corridorId, staff }: { corridorId: string; staff: Staff }) {
  const [detail, setDetail] = useState<CorridorDetail | null>(null);
  const [set, setSet] = useState<FindingsSet | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [missing, setMissing] = useState(false);

  const loadSet = useCallback(async (setId: string) => {
    const read = await api<{ set: FindingsSet; findings: Finding[] }>("GET", `/api/findings-sets/${setId}`);
    setSet(read.set);
    setFindings([...read.findings].sort(byRailOrder));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [read, listed] = await Promise.all([
          api<CorridorDetail>("GET", `/api/corridors/${corridorId}`),
          api<{ assets: Asset[] }>("GET", `/api/corridors/${corridorId}/assets`),
        ]);
        if (read.corridor.current_set !== null) await loadSet(read.corridor.current_set.id);
        setAssets(listed.assets);
        setDetail(read);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) navigate("/");
        else setMissing(true);
      }
    })();
  }, [corridorId, loadSet]);

  if (missing) {
    return (
      <main className="list-page">
        <h1>Corridor not found</h1>
        <a href="/corridors">Corridors</a>
      </main>
    );
  }
  if (detail === null) {
    return (
      <main className="list-page" aria-busy="true">
        <p className="visually-hidden">Loading corridor</p>
        {[0, 1, 2].map((i) => (
          <div className="skeleton-row" key={i} />
        ))}
      </main>
    );
  }
  return (
    <Workspace
      staff={staff}
      detail={detail}
      set={set}
      findings={findings}
      assets={assets}
      setDetail={setDetail}
      setSet={setSet}
      setFindings={setFindings}
      setAssets={setAssets}
      loadSet={loadSet}
    />
  );
}

interface WorkspaceProps {
  staff: Staff;
  detail: CorridorDetail;
  set: FindingsSet | null;
  findings: Finding[];
  assets: Asset[];
  setDetail: (detail: CorridorDetail) => void;
  setSet: (set: FindingsSet | null) => void;
  setFindings: (update: (findings: Finding[]) => Finding[]) => void;
  setAssets: (update: (assets: Asset[]) => Asset[]) => void;
  loadSet: (setId: string) => Promise<void>;
}

function Workspace({ staff, detail, set, findings, assets, setDetail, setSet, setFindings, setAssets, loadSet }: WorkspaceProps) {
  const corridor = detail.corridor;
  const analyst = staff.role === "vegetation_analyst";
  const editable = analyst && set !== null && acceptsFindingChanges(set.state);
  const phone = useMedia("(max-width: 767px)");
  const tablet = useMedia("(min-width: 768px) and (max-width: 1023px)");

  const [messages, setMessages] = useState<Messages>(NO_MESSAGES);
  const say = useCallback((key: keyof Messages, text: string) => setMessages((m) => ({ ...m, [key]: text })), []);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const openings = useRef(0);
  const openDialog = (next: DialogKind) => {
    openings.current += 1;
    setDialog({ ...next, seq: openings.current });
  };
  /** A dialog's exit finishes after its animation; it clears only its own opening. */
  const closedDialog = (seq: number) => setDialog((current) => (current?.seq === seq ? null : current));
  const [tab, setTab] = useState<"findings" | "assets">("findings");
  const [expandedAssets, setExpandedAssets] = useState<ReadonlySet<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [streaming, setStreaming] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingLink, setPendingLink] = useState<LinkAction | null>(null);
  const linkBusy = useRef(false);

  const stage = useCorridorStage({
    detail,
    findings,
    flightPath: `/api/corridors/${corridor.id}/flight`,
    onAnnounce: (text) => say("view", text),
    onFailure: () => undefined,
  });
  const { shape, rig, view, snapshot, nearIds } = stage;
  const camera = useCameraLine(rig, shape);
  const selected = findings.find((f) => f.id === snapshot.selectedId) ?? null;

  const replaceFinding = useCallback(
    (finding: Finding) => setFindings((list) => [...list.filter((f) => f.id !== finding.id), finding].sort(byRailOrder)),
    [setFindings],
  );

  const findingsRef = useRef(findings);
  findingsRef.current = findings;
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const setIdRef = useRef(set?.id ?? null);
  setIdRef.current = set?.id ?? null;
  const refinement = useMemo(
    () =>
      new TerrainRefinement({
        findings: () => findingsRef.current,
        active: () => editableRef.current,
        onRefined: (finding) => {
          replaceFinding(finding);
          say(
            "terrain",
            `Ground height for ${finding.label} re-resolved to ${metres2(finding.ground_height_m)} at terrain level ${finding.terrain_level ?? ""}. Clearance now ${metres2(finding.clearance_m)}, ${finding.status === "violation" ? "Violation" : "Clear"}.`,
          );
        },
        onStale: () => {
          if (setIdRef.current !== null) void loadSet(setIdRef.current);
        },
      }),
    [replaceFinding, say, loadSet],
  );

  const status = useStatusChecks(
    useCallback(
      (now, previous) => {
        if (set !== null) {
          void api<{ set: FindingsSet }>("GET", `/api/findings-sets/${set.id}`)
            .then((read) => setSet(read.set))
            .catch(() => undefined);
        }
        if (now.storage === "ok" && previous === "unreachable") {
          void api<{ assets: Asset[] }>("GET", `/api/corridors/${corridor.id}/assets`).then((read) => setAssets(() => read.assets));
          void api<CorridorDetail>("GET", `/api/corridors/${corridor.id}`).then(setDetail);
        }
      },
      [set, corridor.id, setSet, setAssets, setDetail],
    ),
  );

  /** Opens the editor: an existing finding, a new one at the playhead, or a new one at a picked point. */
  const openEditor = (finding: Finding | null, opener: HTMLElement | null, pick: Pick | null = null) => {
    if (!editable) return;
    const placed = pick === null ? null : project(shape.line, pick);
    const chainage = clampChainage(shape, placed?.chainageM ?? snapshot.chainageM);
    const span = spanOf(shape, chainage);
    const foot = pointAt(shape.line, chainage, 0);
    const ground = pick === null ? rig.ground(foot.lonDeg, foot.latDeg) : pick.level === null ? null : { heightM: pick.heightM, level: pick.level };
    openDialog({
      kind: "editor",
      target: {
        mode: finding === null ? "new" : "edit",
        finding,
        chainageM: chainage,
        offsetM: Math.round((placed?.offsetM ?? 0) * 100) / 100,
        spanLabel: spanLabel(span.from, span.to),
        ground,
        pick: pick === null ? null : { lonDeg: pick.lonDeg, latDeg: pick.latDeg },
        opener,
      },
    });
  };

  // J and K select, E edits, N adds at the playhead, whenever no dialog is open and focus is not in a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialogOpen() || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        if (findings.length === 0) return;
        event.preventDefault();
        const index = findings.findIndex((f) => f.id === snapshot.selectedId);
        const next = index < 0 ? (key === "j" ? 0 : findings.length - 1) : Math.min(findings.length - 1, Math.max(0, index + (key === "j" ? 1 : -1)));
        const target = findings[next];
        if (target !== undefined && target.id !== snapshot.selectedId) view.select(target.id);
      } else if (key === "e" && selected !== null && editable) {
        event.preventDefault();
        openEditor(selected, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      } else if (key === "n" && editable) {
        event.preventDefault();
        openEditor(null, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findings, snapshot.selectedId, selected, editable, view, openEditor]);

  const onTerrainTile = useCallback((tile: TerrainTile) => refinement.tileArrived(tile), [refinement]);
  const assetUrl = useCallback((assetId: string, path: string) => `/api/assets/${assetId}/files/${path}`, []);

  const linkAction = async (action: LinkAction) => {
    if (set === null || linkBusy.current) return;
    linkBusy.current = true;
    setPendingLink(action);
    const email = corridor.utility.forester_email;
    try {
      const result = await api<{ review_link: ReviewLink; email?: "sent" | "queued" }>(
        "POST",
        `/api/findings-sets/${set.id}/review-link/${action}`,
        { body: {}, idempotencyKey: action === "revoke" ? undefined : newIdempotencyKey() },
      );
      setSet({ ...set, review_link: result.review_link });
      if (action === "revoke") say("link", "Review link withdrawn.");
      else if (result.email === "queued") say("link", `The email to ${email} is queued and will send when mail is back.`);
      else if (action === "resend") say("link", `Review link resent to ${email}.`);
      else say("link", `New review link sent to ${email}. The previous link no longer works.`);
      if (action === "regenerate") void loadSet(set.id);
    } catch (error) {
      if (error instanceof ApiFailure) say("link", error.message);
    } finally {
      linkBusy.current = false;
      setPendingLink(null);
    }
  };

  const setAction = async (path: string, done: (next: FindingsSet) => string) => {
    try {
      const result = await api<{ set: FindingsSet }>("POST", path, { body: {} });
      await loadSet(result.set.id);
      say("submit", done(result.set));
    } catch (error) {
      if (error instanceof ApiFailure) say("submit", error.message);
    }
  };

  const submitted = (result: SubmitResult) => {
    setSet(result.set);
    const email = corridor.utility.forester_email;
    say(
      "submit",
      result.email === "sent"
        ? `Submitted revision ${result.set.revision}. Review link emailed to ${email}.`
        : `Submitted revision ${result.set.revision}. The email to ${email} is queued and will send when mail is back.`,
    );
  };

  const submitRefused = (failure: ApiFailure) => {
    if (failure.code === "illegal_transition") say("submit", "This findings set was already submitted.");
    else if (failure.status === 422) say("submit", failure.fields.findings ?? failure.message);
    else if (failure.code === "storage_unavailable") say("submit", "Submit needs tile storage to write the evidence pack. Try again when storage is back.");
    else say("submit", failure.message);
    if (set !== null) void loadSet(set.id);
  };

  const upload = (kind: Parameters<typeof startUpload>[1], files: PickedFile[]) =>
    startUpload(corridor.id, kind, files, {
      report: (text) => say("upload", text),
      progress: setUploadProgress,
      onAsset: (asset) => setAssets((list) => [asset, ...list.filter((a) => a.id !== asset.id)]),
    });

  const signOut = async () => {
    await api("DELETE", "/api/session").catch(() => undefined);
    navigate("/");
  };

  const link = set?.review_link ?? null;
  const live = link?.status === "live";
  const can = (action: SetAction) => set !== null && nextState(set.state, action) !== null;
  const counts = frozenCounts(findings.map((f) => f.status));
  const drone = snapshot.drone.kind === "placed" ? snapshot.drone.answer.position : null;
  const readout = (className: string) => (
    <Readout shape={shape} chainageM={snapshot.chainageM} drone={snapshot.drone} camera={camera} streaming={streaming} className={className} />
  );

  const rail = (
    <>
      {tablet && <div className="rail-readout">{readout("")}</div>}
      <div className="tabs" role="tablist" aria-label="Rail sections">
        {(["findings", "assets"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className="tab"
            id={`tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const next = name === "findings" ? "assets" : "findings";
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {name === "findings" ? "Findings" : "Assets"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="panel-findings" aria-labelledby="tab-findings" hidden={tab !== "findings"}>
        {!phone && set !== null && (
          <div className="rail-summary">
            <p className="summary">{summaryLine(findings)}</p>
            <span className="meta">{setStateLabel(set.state)}</span>
          </div>
        )}
        {editable && (
          <div className="rail-tools">
            <button type="button" className="button" onClick={(event) => openEditor(null, event.currentTarget)}>
              <Plus size={16} aria-hidden="true" />
              New finding at playhead
            </button>
            {selected !== null && (
              <button type="button" className="button" onClick={(event) => openEditor(selected, event.currentTarget)}>
                <Pencil size={16} aria-hidden="true" />
                Edit finding
              </button>
            )}
          </div>
        )}
        {set === null ? (
          <div className="rail-empty">
            <StakeDrawing />
            <p>No findings set for this corridor yet.</p>
          </div>
        ) : (
          <ul
            className="findings-list"
            role="listbox"
            aria-label="Findings"
            tabIndex={0}
            aria-activedescendant={selected === null ? undefined : `option-${selected.id}`}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const index = findings.findIndex((f) => f.id === snapshot.selectedId);
                const next = findings[Math.min(findings.length - 1, Math.max(0, index < 0 ? 0 : index + (event.key === "ArrowDown" ? 1 : -1)))];
                if (next !== undefined && next.id !== snapshot.selectedId) view.select(next.id);
              } else if (event.key === "Enter" && selected !== null && editable) {
                event.preventDefault();
                openEditor(selected, event.currentTarget);
              }
            }}
          >
            {findings.map((f) => {
              const near = nearIds.has(f.id);
              return (
                <li
                  key={f.id}
                  id={`option-${f.id}`}
                  role="option"
                  aria-selected={f.id === snapshot.selectedId}
                  className={`finding${near ? " near" : ""}${f.id === snapshot.selectedId ? " active" : ""}`}
                  onClick={() => {
                    if (f.id !== snapshot.selectedId) view.select(f.id);
                  }}
                >
                  <span className="label">{f.label}</span>
                  <span className="line">
                    <StatusWord status={f.status} />
                    <span>
                      Clearance <span className="figure">{metres2(f.clearance_m)}</span>
                    </span>
                    {near && <span className="near-tag">Near playhead</span>}
                  </span>
                  <span />
                  <span className="line meta">
                    <span>{f.span.label}</span>
                    <span>
                      chainage <span className="figure">{chainageText(f.chainage_m)}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div role="tabpanel" id="panel-assets" aria-labelledby="tab-assets" hidden={tab !== "assets"}>
        {staff.role === "survey_processor" && (
          <div className="rail-tools">
            <button type="button" className="button" onClick={(event) => openDialog({ kind: "upload", opener: event.currentTarget })}>
              <Upload size={16} aria-hidden="true" />
              Upload assets
            </button>
          </div>
        )}
        {uploadProgress > 0 && (
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${Math.round(uploadProgress * 100)}%` }} />
          </div>
        )}
        <AssetsPanel
          assets={assets}
          expanded={expandedAssets}
          onToggle={(id) =>
            setExpandedAssets((open) => {
              const next = new Set(open);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          fileUrl={(asset, path) => `/api/assets/${asset.id}/files/${path}?download=1`}
        />
      </div>
    </>
  );

  return (
    <div className="corridor-app">
      <a className="skip" href="#span-ribbon-slider" onClick={(event) => {
        event.preventDefault();
        document.getElementById("span-ribbon-slider")?.focus();
      }}>
        Skip to span ribbon
      </a>
      <header className="cw-header">
        <div className="cw-title">
          <p className="crumbs">
            <a href="/corridors" onClick={(event) => { event.preventDefault(); navigate("/corridors"); }}>
              Corridors
            </a>
          </p>
          <h1>{corridor.name}</h1>
          <p className="cw-facts">
            <span className="fact">{corridor.utility.name}</span>
            <span className="fact mono">{corridor.voltage_kv} kV</span>
            <span className="fact">{inspectionDueLine(corridor.inspection_due, corridor.utility.time_zone)}</span>
            {corridor.overdue && <OverdueBadge />}
            <span className="fact state-word">{setStateLabel(set?.state)}</span>
          </p>
          {link !== null && (
            <p className="link-line">
              <span className="clause">{linkExpiryLine(link.expires_at, corridor.utility.time_zone)}</span>
              <span className="clause">{linkSuffix(link)}</span>
            </p>
          )}
        </div>
        <div className="cw-actions">
          {analyst && allowsNewSet(set?.state ?? null) && (
            <button type="button" className="button" onClick={() => void setAction(`/api/corridors/${corridor.id}/findings-sets`, (s) => `Revision ${s.revision} started as a draft.`)}>
              Start findings set
            </button>
          )}
          {editable && (
            <button type="button" className="button primary" onClick={(event) => openDialog({ kind: "submit", opener: event.currentTarget })}>
              <Send size={16} aria-hidden="true" />
              Submit for review
            </button>
          )}
          {analyst && live && (
            <>
              <button type="button" className="button" aria-disabled={pendingLink === "resend"} onClick={() => void linkAction("resend")}>
                Resend link
              </button>
              <button type="button" className="button" aria-disabled={pendingLink === "revoke"} onClick={() => void linkAction("revoke")}>
                Withdraw link
              </button>
            </>
          )}
          {analyst && can("regenerate") && (
            <button type="button" className="button" aria-disabled={pendingLink === "regenerate"} onClick={() => void linkAction("regenerate")}>
              New link
            </button>
          )}
          {analyst && set !== null && can("close") && (
            <button type="button" className="button" onClick={() => void setAction(`/api/findings-sets/${set.id}/close`, () => "Findings set closed.")}>
              Close set
            </button>
          )}
          {analyst && set !== null && can("revise") && (
            <button type="button" className="button" onClick={() => void setAction(`/api/findings-sets/${set.id}/revisions`, (s) => `Revision ${s.revision} started as a draft.`)}>
              Start revision
            </button>
          )}
          <button
            type="button"
            className="button"
            aria-label="Copy view link"
            onClick={() => {
              void navigator.clipboard.writeText(location.href).then(() => say("view", "View link copied."));
            }}
          >
            <Link2 size={16} aria-hidden="true" />
            <span className="phone-hide">Copy view link</span>
          </button>
          <button type="button" className="button quiet" aria-label="Sign out" onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden="true" />
            <span className="phone-hide">Sign out</span>
          </button>
        </div>
      </header>
      <main className="cw-body">
        <GlobeArea
          shape={shape}
          rig={rig}
          assets={detail.active_assets}
          assetUrl={assetUrl}
          storageOk={status.storage !== "unreachable"}
          findings={findings}
          nearIds={nearIds}
          selectedId={snapshot.selectedId}
          drone={drone === null ? null : { lonDeg: drone.lon_deg, latDeg: drone.lat_deg, heightM: drone.height_m }}
          coverage={detail.coverage}
          onStreaming={setStreaming}
          onTerrainTile={onTerrainTile}
          onPick={(pick) => openEditor(null, null, pick)}
          overlays={
            <>
              {!tablet && readout("readout-float")}
              <div className="notices">
                <Notice name="Save status" text={messages.save} />
                <Notice name="Terrain updates" text={messages.terrain} />
                <Notice name="Submit status" text={messages.submit} />
                <Notice name="Link status" text={messages.link} />
                <Notice name="Upload status" text={messages.upload} />
                <Notice name="View status" text={messages.view} />
              </div>
            </>
          }
        />
        <RailSheet phone={phone} expanded={sheetOpen} onExpandedChange={setSheetOpen} summary={<p className="summary">{set === null ? "No findings set" : summaryLine(findings)}</p>}>
          {rail}
        </RailSheet>
      </main>
      <SpanRibbon
        shape={shape}
        coverage={detail.coverage}
        chainageM={snapshot.chainageM}
        glide={snapshot.glide}
        nearCount={nearIds.size}
        onScrub={(c, kind) => view.scrub(c, kind)}
        onRelease={() => view.release()}
      />
      {dialog?.kind === "editor" && set !== null && (
        <FindingEditor
          key={dialog.seq}
          target={dialog.target}
          setId={set.id}
          onSaving={(label) => say("save", `Saving ${label}...`)}
          onSaved={(finding) => {
            replaceFinding(finding);
            say("save", `Saved ${finding.label}. Clearance ${metres2(finding.clearance_m)}, ${finding.status === "violation" ? "Violation" : "Clear"}.`);
          }}
          onInvalid={(label) => say("save", `Could not save ${label}. Check the highlighted fields.`)}
          onDeleted={(finding) => {
            setFindings((list) => list.filter((f) => f.id !== finding.id));
            say("save", `Deleted ${finding.label}.`);
          }}
          onClosed={() => closedDialog(dialog.seq)}
        />
      )}
      {dialog?.kind === "submit" && set !== null && (
        <SubmitDialog
          key={dialog.seq}
          set={set}
          findingCount={counts.finding_count}
          violationCount={counts.violation_count}
          foresterEmail={corridor.utility.forester_email}
          opener={dialog.opener}
          onPending={() => say("submit", `Submitting revision ${set.revision}...`)}
          onSubmitted={submitted}
          onRefused={submitRefused}
          onClosed={() => closedDialog(dialog.seq)}
        />
      )}
      {dialog?.kind === "upload" && <UploadDialog key={dialog.seq} opener={dialog.opener} onUpload={upload} onClosed={() => closedDialog(dialog.seq)} />}
    </div>
  );
}
