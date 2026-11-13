// The part page (DP-01..DP-22, DP-40..DP-45, DP-62, DP-63, DP-66, DP-67): a live, shareable configuration of one part.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardJson, Finding, LiveEvent, PartJson, PreflightReport, RevisionJson, RevisionListJson, RoomJson, TapeJson } from "../shared/api";
import { NNBSP, bboxText, display, fixed, parseDecimal, volumeText } from "../shared/numbers";
import { buildManifest, defaultValues, parseTine, poseOfSolid, type Model, type Pose, type SolidOp, type Value, type Values } from "../shared/tine";
import { api, get, notifyStorageOutage } from "./api";
import { BuildTape } from "./BuildTape";
import { PageHeading } from "./chrome";
import { EnumField, RadioGroup, Spin, SwitchField, type Units } from "./controls";
import { useEpoch } from "./epoch";
import { isEvaluating, isFailed, useEvaluation } from "./evalMachine";
import { Findings, type FindingOption } from "./Findings";
import { useMedia } from "./hooks";
import { Icon } from "./icons";
import { useLiveEvents } from "./live";
import { clearDrafts, changeLines, buildConfig, paramsOf, parseConfig, partAddress, readDraft, searchOf, writeDraft } from "./partAddress";
import { DOWNLOAD_OUTAGE } from "../shared/copy";
import { ConflictAlert, ForkDialog, ReviewDialog, RestoreDialog, SaveDialog, SignUpDialog, Alert } from "./partDialogs";
import { complete, isModified, modifiedCount, reportStale, sameValues, tapeDisabled } from "./markers";
import { navigate, rewrite, useLocation } from "./router";
import { useConfig, useSession } from "./session";
import { PROCESSES, leadTime } from "../shared/processes";
import { Link, NotFound } from "./shell";
import { useSnapshot } from "./solids";
import { Viewport, type Pin, type ViewportHandle } from "./viewport/Viewport";
import type { Scene } from "./viewport/engine";
import type { LitShape } from "./viewport/geometry";

const GROUPS = ["Dimensions", "Pre-flight", "Revisions", "Review"] as const;
type GroupName = (typeof GROUPS)[number];

export function PartPage({ slug }: { slug: string }) {
  const { search } = useLocation();
  const revision = paramsOf(search).revision ?? null;
  const address = `${slug}:${revision ?? ""}`;
  const [state, setState] = useState<{ address: string; part: PartJson | null } | null>(null);
  useEffect(() => {
    let live = true;
    void get<PartJson>(`/api/parts/${slug}${revision ? `?revision=${revision}` : ""}`).then((reply) => {
      if (live) setState({ address, part: reply.ok ? reply.data : null });
    });
    return () => {
      live = false;
    };
  }, [slug, revision, address]);
  if (state?.address !== address) return <div className="loading-page" aria-busy="true" />;
  if (!state.part) return <NotFound />;
  return <PartView key={address} part={state.part} />;
}

function PartView({ part }: { part: PartJson }) {
  const { me, storageDown } = useSession();
  const config = useConfig();
  const slug = part.slug;
  const model = useMemo<Model>(() => {
    const parsed = parseTine(part.source);
    if (!parsed.ok) throw new Error(`stored source does not parse: ${parsed.reason}`);
    return parsed.model;
  }, [part.source]);
  const owner = me?.id === part.owner.id;
  const narrow = useMedia("(max-width: 1023px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  // ---- values, address, draft
  const initial = useMemo(() => {
    const base = buildManifest(model, {});
    const params = paramsOf(window.location.search);
    const found = readDraft(slug);
    if (found && found.head !== part.headRevisionId) return { values: found.draft.values, dropped: [] as string[], draft: found };
    if (params.config !== undefined) return { ...parseConfig(params.config, base), draft: null };
    return { values: complete(base, part.revision.values), dropped: [] as string[], draft: null };
  }, [model, part.headRevisionId, part.revision.values, slug]);
  const [values, setValues] = useState<Values>(initial.values);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const manifest = useMemo(() => buildManifest(model, values), [model, values]);
  const defaults = useMemo(() => defaultValues(model), [model]);
  const [units, setUnitsState] = useState<Units>(() => (window.localStorage.getItem("tinework:units") === "in" ? "in" : "mm"));
  const setUnits = (next: Units) => {
    window.localStorage.setItem("tinework:units", next);
    setUnitsState(next);
  };
  const labels = useMemo(() => Object.fromEntries(manifest.map((m) => [m.name, m.label])), [manifest]);

  const writeAddress = useCallback(
    (next: Values, keepOperation: boolean) => {
      const edits: Record<string, string | null | undefined> = { ...paramsOf(window.location.search), config: buildConfig(manifest, next) };
      if (!keepOperation) edits.operation = null;
      rewrite(`/parts/${slug}${searchOf(edits)}`);
    },
    [manifest, slug],
  );

  // ---- evaluation
  const viewerId = useMemo(() => crypto.randomUUID(), []);
  const [epoch, bumpEpoch] = useEpoch(`tinework:epoch:part:${slug}`);
  const playheadRef = useRef<number | null>(null);
  const evaluation = useEvaluation({
    partSlug: slug,
    revisionId: part.revision.id,
    viewerId,
    debounceMs: config.evalDebounceMs,
    slowMs: config.slowEvalNoticeMs,
    onDebounce: (next) => writeAddress(next, false),
    onApplied: () => {
      if (playheadRef.current === null) bumpEpoch();
    },
  });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    writeAddress(valuesRef.current, true);
    evaluation.start(valuesRef.current);
  }, [evaluation, writeAddress]);

  const commit = (name: string, value: Value) => {
    const next = { ...valuesRef.current, [name]: value };
    valuesRef.current = next;
    setValues(next);
    setPlayhead(null);
    evaluation.commit(next);
  };
  const resetAll = () => {
    const next = { ...defaults };
    valuesRef.current = next;
    setValues(next);
    setPlayhead(null);
    evaluation.commit(next);
  };

  const live = evaluation.view.drawn;
  const defaultPose = useRef<Pose | null>(null);
  if (live && !defaultPose.current) defaultPose.current = poseOfSolid(live.solid);

  // ---- tape
  const [tape, setTape] = useState<TapeJson | null>(null);
  const [playhead, setPlayheadState] = useState<number | null>(null);
  const setPlayhead = (k: number | null) => {
    playheadRef.current = k;
    setPlayheadState(k);
  };
  const { snapshot, lastGood } = useSnapshot(tape, playhead, bumpEpoch);
  useEffect(() => {
    let alive = true;
    void get<TapeJson>(`/api/revisions/${part.revision.id}/tape`).then((reply) => {
      if (!alive || !reply.ok) return;
      setTape(reply.data);
      const asked = paramsOf(window.location.search).operation;
      if (asked === undefined) return;
      const operation = parseDecimal(asked);
      if (operation !== null && Number.isInteger(operation) && operation >= 0 && operation <= reply.data.n) setPlayhead(operation);
      else rewrite(`/parts/${slug}${searchOf({ ...paramsOf(window.location.search), operation: null })}`);
    });
    return () => {
      alive = false;
    };
  }, [part.revision.id, slug]);

  const revisionValues = useMemo(() => complete(manifest, part.revision.values), [manifest, part.revision.values]);
  const tapeOff = tapeDisabled(manifest, values, revisionValues);
  const n = tape?.n ?? 0;
  const k = playhead ?? n;

  // ---- findings, pre-flight
  const [process, setProcess] = useState("fdm-04");
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [running, setRunning] = useState(false);
  const [preStatus, setPreStatus] = useState("");
  const [left, setLeft] = useState(part.preflightLeft);
  const [reportEpoch, bumpReport] = useEpoch(`tinework:epoch:report:${slug}`);
  const stale = report !== null && reportStale(manifest, values, process, { values: report.values, process: report.process });
  const reportState = running ? "running" : !report ? "unrun" : stale ? "stale" : report.status;
  const limit = config.preflightSignedOutLimit;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const viewport = useRef<ViewportHandle>(null);

  const runPreflight = async () => {
    if (running) return;
    setRunning(true);
    const label = PROCESSES.find((p) => p.id === process)?.label ?? process;
    setPreStatus(`Checking against ${label}...`);
    const sent = complete(manifest, valuesRef.current);
    const reply = await api<PreflightReport & { message?: string }>("POST", "/api/preflight", { partSlug: slug, revisionId: part.revision.id, values: sent, process });
    setRunning(false);
    if (reply.status === 201) {
      const body = reply.data;
      setReport({ ...body, values: body.values ?? sent });
      bumpReport();
      if (left !== null) setLeft(Math.max(0, left - 1));
      const { blocking, advisory } = findingCounts(body);
      setPreStatus(body.status === "unsupported" ? (body.message ?? "") : `Pre-flight complete: ${blocking} blocking, ${advisory} advisory.`);
    } else {
      if (reply.status === 429) setLeft(0);
      setPreStatus(reply.data.message ?? "Pre-flight could not run.");
    }
  };

  const options = useMemo<(FindingOption & { finding?: Finding })[]>(() => {
    const out: (FindingOption & { finding?: Finding })[] = [];
    if (isFailed(evaluation.view) && evaluation.view.diagnostic) {
      const d = evaluation.view.diagnostic;
      out.push({ key: keyOf(`Blocking: ${d.message}`), severity: "Blocking", message: d.message, parameters: d.parameter ? [d.parameter] : [] });
    }
    if (initial.dropped.length) {
      const message = `Dropped from the link: ${initial.dropped.join(", ")}`;
      out.push({ key: keyOf(`Advisory: ${message}`), severity: "Advisory", message, parameters: [] });
    }
    for (const f of report?.findings ?? []) out.push({ key: keyOf(`${f.severity}: ${f.message}`), severity: f.severity, message: f.message, parameters: f.parameters, finding: f, dim: stale });
    return out;
  }, [evaluation.view.state, evaluation.view.diagnostic, initial.dropped, report, stale]);
  const selected = options.find((o) => o.key === selectedKey) ?? null;

  const onSelect = (option: FindingOption & { finding?: Finding }) => {
    setSelectedKey(option.key);
    if (option.finding) viewport.current?.glideTo(option.finding.pose);
  };
  const [focusParam, setFocusParam] = useState<string | null>(null);
  const goTo = (name: string) => {
    setOpen((o) => (o.includes("Dimensions") ? o : narrow ? ["Dimensions"] : [...o, "Dimensions"]));
    setFocusParam(name);
  };

  // ---- rail
  const [open, setOpen] = useState<GroupName[]>(() => (window.innerWidth < 1024 ? ["Dimensions"] : [...GROUPS]));
  useEffect(() => {
    if (narrow) setOpen((o) => (o.length > 1 ? [o[0] as GroupName] : o));
  }, [narrow]);
  useEffect(() => {
    if (!focusParam || !open.includes("Dimensions")) return;
    document.querySelector<HTMLElement>(`[data-param="${focusParam}"] input, [data-param="${focusParam}"] button, [data-param="${focusParam}"] select`)?.focus();
    setFocusParam(null);
  }, [focusParam, open]);
  const toggle = (name: GroupName) =>
    setOpen((o) => (o.includes(name) ? o.filter((g) => g !== name) : narrow ? [name] : [...o, name]));

  // ---- revisions, authors, live
  const [revisions, setRevisions] = useState<RevisionJson[]>([]);
  const [authors, setAuthors] = useState(part.authors);
  const [activity, setActivity] = useState(() => window.sessionStorage.getItem(`tinework:announce:${slug}`) ?? "");
  useEffect(() => window.sessionStorage.removeItem(`tinework:announce:${slug}`), [slug]);
  const own = useRef(new Set<string>());
  const [knownHead, setKnownHead] = useState(part.headRevisionId);
  const [likes, setLikes] = useState(part.likes);
  const [liked, setLiked] = useState(part.liked);
  useEffect(() => {
    let alive = true;
    void get<RevisionListJson>(`/api/parts/${slug}/revisions`).then((reply) => alive && reply.ok && setRevisions(reply.data.revisions));
    return () => {
      alive = false;
    };
  }, [slug]);
  useLiveEvents(slug, (event: LiveEvent) => {
    if (event.type === "like" && event.partSlug === slug) setLikes(event.likes);
    if (event.type === "revision") {
      setRevisions((list) => (list.some((r) => r.id === event.revision.id) ? list : [event.revision, ...list]));
      setAuthors((a) => ({ ...a, [event.revision.authorId]: event.authorDisplayName }));
      if (!own.current.has(event.revision.id)) setActivity(`New revision ${event.revision.label} by ${event.authorDisplayName}.`);
    }
  });

  const [rooms, setRooms] = useState<DashboardJson["rooms"]>([]);
  useEffect(() => {
    if (!me) return;
    void get<DashboardJson>("/api/dashboard").then((reply) => reply.ok && setRooms(reply.data.rooms.filter((r) => r.partSlug === slug)));
  }, [me, slug]);

  // ---- dialogs, conflict, save
  type Dialog = null | "save" | "signup" | "fork" | "review" | { restore: RevisionJson };
  const [dialog, setDialog] = useState<Dialog>(null);
  const [conflict, setConflict] = useState<{ head: RevisionJson; message: string; before: Values } | null>(null);
  const [downloadOutage, setDownloadOutage] = useState(false);
  const [draftMessage, setDraftMessage] = useState(initial.draft?.draft.message ?? "");
  const savedSearch = useRef(false);

  const conflictMessage = (head: RevisionJson) => `This part changed since you opened it. ${head.label} is now the latest revision.`;
  const valuesOfHead = (id: string): Values => revisions.find((r) => r.id === id)?.values ?? {};

  useEffect(() => {
    if (!initial.draft || conflict || revisions.length === 0) return;
    const head = revisions.find((r) => r.id === part.headRevisionId);
    const base = revisions.find((r) => r.id === initial.draft?.head);
    if (head) setConflict({ head, message: conflictMessage(head), before: base?.values ?? {} });
    // The draft's alert shows once, after the revision list arrives.
      }, [revisions]);

  useEffect(() => {
    if (savedSearch.current || !me) return;
    const params = paramsOf(window.location.search);
    if (params.save === "1") {
      savedSearch.current = true;
      setDialog("save");
      const rest = { ...params, save: null };
      rewrite(`/parts/${slug}${searchOf(rest)}`);
    }
  }, [me, slug]);

  const openSave = () => setDialog(me ? "save" : "signup");
  const currentConfig = buildConfig(manifest, values);
  const afterSave = (rev: RevisionJson, tag: string) => {
    own.current.add(rev.id);
    setRevisions((list) => (list.some((r) => r.id === rev.id) ? list : [rev, ...list]));
    setKnownHead(tag.replaceAll('"', "") || rev.id);
    setAuthors((a) => ({ ...a, [rev.authorId]: me?.displayName ?? a[rev.authorId] ?? "" }));
    clearDrafts(slug);
    setConflict(null);
    setActivity(`Saved ${rev.label}.`);
    setDialog(null);
  };
  const onConflict = (head: RevisionJson, message: string) => {
    writeDraft(slug, knownHead, { values: valuesRef.current, message });
    setDraftMessage(message);
    setConflict({ head, message: conflictMessage(head), before: valuesOfHead(knownHead) });
    setRevisions((list) => (list.some((r) => r.id === head.id) ? list : [head, ...list]));
    setDialog(null);
  };

  const download = async (kind: "zip" | "tar") => {
    if (storageDown) {
      setDownloadOutage(true);
      return;
    }
    const response = await fetch(`/api/revisions/${part.revision.id}/archive.${kind}`);
    if (response.status === 503) {
      notifyStorageOutage();
      setDownloadOutage(true);
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug}-${part.revision.label}.${kind}`;
    link.click();
    URL.revokeObjectURL(url);
    setDownloadOutage(false);
  };

  const toggleLike = async () => {
    if (!me) return;
    const reply = await api<{ liked: boolean; likes: number }>(liked ? "DELETE" : "PUT", `/api/parts/${slug}/like`);
    if (reply.ok) {
      setLiked(reply.data.liked);
      setLikes(reply.data.likes);
    }
  };

  // ---- viewport inputs
  const shown = snapshot && snapshot !== "outage" ? { digest: snapshot.digest, volume: snapshot.measure.volume, bbox: snapshot.measure.bbox, faces: snapshot.measure.faces } : live;
  const scene = useMemo<Scene | null>(() => {
    if (snapshot && snapshot !== "outage") return snapshot.scene;
    if (!live) return null;
    const finding = selected?.finding;
    if (!finding) return { key: `live:${live.digest}`, solid: live.solid };
    const colour = finding.severity === "Blocking" ? "#ff7f5c" : finding.severity === "Advisory" ? "#f5b83d" : "#6fd49a";
    return { key: `live:${live.digest}:${selected.key}`, solid: live.solid, grey: true, involved: { shapes: involvedShapes(live.solid, finding), color: colour } };
  }, [snapshot, live, selected]);

  const pinReport = report && report.status === "complete" && sameValues(complete(manifest, report.values), revisionValues) ? report : (tape?.preflight ?? null);
  const pins = useMemo<Pin[]>(() => {
    const out: Pin[] = [];
    if (tape && pinReport) {
      for (const f of pinReport.findings) if (f.severity !== "Pass" && f.operation <= k) out.push({ id: `pin-${f.id}`, kind: "finding", position: f.pose.target });
    }
    return out;
  }, [tape, pinReport, k]);

  const sourceLines = useMemo(() => part.source.split("\n").filter((_, i, all) => i < all.length - 1 || all[i] !== ""), [part.source]);
  const activeLine = tape && tape.operations[k]?.line;
  const sourcePane = useRef<HTMLElement>(null);
  useEffect(() => {
    const pane = sourcePane.current;
    const line = pane?.querySelector<HTMLElement>('[data-line][aria-current="true"]');
    if (!pane || !line) return;
    if (line.offsetTop < pane.scrollTop) pane.scrollTop = line.offsetTop;
    else if (line.offsetTop + line.offsetHeight > pane.scrollTop + pane.clientHeight) pane.scrollTop = line.offsetTop + line.offsetHeight - pane.clientHeight;
  }, [activeLine]);

  const modified = modifiedCount(manifest, values);
  const view = evaluation.view;
  const statusText =
    isFailed(view) && view.diagnostic
      ? `Could not evaluate: ${view.diagnostic.message}`
      : view.superseded
        ? "Superseded by a newer change."
        : live
          ? `Updated: ${volumeText(live.volume)}`
          : "";
  const processLabel = PROCESSES.find((p) => p.id === process)?.label ?? "";
  const groups = [...new Set(manifest.map((m) => m.group))];

  return (
    <div className="page part-page">
      {conflict ? (
        <ConflictAlert
          message={conflict.message}
          head={conflict.head}
          lines={changeLines(manifest, conflict.before, conflict.head.values)}
          onOpen={() => {
            clearDrafts(slug);
            setConflict(null);
            navigate(partAddress(slug, { revision: conflict.head.id }));
          }}
          onKeep={() => {
            writeDraft(slug, conflict.head.id, { values: valuesRef.current, message: draftMessage });
            setKnownHead(conflict.head.id);
            setActivity(`Your values now build on ${conflict.head.label}.`);
            setConflict(null);
          }}
        />
      ) : null}
      {downloadOutage ? <Alert>{DOWNLOAD_OUTAGE}</Alert> : null}

      <header className="part-header">
        <PageHeading>{part.title}</PageHeading>
        <p className="by muted">
          by {part.owner.displayName}
        </p>
        <div className="actions">
          <span className="like-group">
            <button type="button" className="like-toggle" aria-pressed={liked} aria-label={`Like ${part.title}`} aria-disabled={me ? undefined : true} aria-describedby={me ? undefined : "like-hint"} onClick={toggleLike}>
              <Icon name="heart" filled={liked} />
            </button>
            <span data-ui="like-count">{likes === 1 ? "1 like" : `${display(likes, 0)} likes`}</span>
            {me ? null : (
              <span role="tooltip" id="like-hint" className="tooltip">
                Sign in to like parts
              </span>
            )}
          </span>
          <button type="button" className="button primary" onClick={openSave}>
            Save revision
          </button>
          <button type="button" className="button" aria-disabled={storageDown ? true : undefined} onClick={() => download("zip")}>
            <Icon name="download" />
            Download ZIP
          </button>
          <button type="button" className="button" aria-disabled={storageDown ? true : undefined} onClick={() => download("tar")}>
            <Icon name="download" />
            Download TAR
          </button>
        </div>
        <p className="activity" role="status" aria-label="Part activity">
          {activity}
        </p>
      </header>

      <div className="part-grid">
        <div className="stage">
          <Viewport
            ref={viewport}
            attrs={{
              "data-eval-state": view.state,
              "data-digest": shown?.digest,
              "data-volume": shown ? fixed(shown.volume, 2) : undefined,
              "data-bbox": shown ? shown.bbox.join(",") : undefined,
              "data-faces": shown?.faces,
              "data-seq": live?.seq ?? 0,
              "data-viewer-id": viewerId,
              "data-tape-operation": snapshot && snapshot !== "outage" ? snapshot.k : undefined,
              "data-epoch": epoch,
              "data-evaluating": isEvaluating(view) ? "true" : undefined,
            }}
            scene={scene}
            defaultPose={defaultPose.current}
            pins={[
              ...pins,
              ...(selected?.finding ? [{ id: "leader", kind: "leader" as const, position: selected.finding.pose.target }] : []),
            ]}
            onFadeEnd={evaluation.fadeEnd}
            outage={snapshot === "outage" ? { lastGood } : null}
            fallback={{ src: `/api/solids/${part.revision.geometryDigest}/thumbnail.svg`, alt: `${part.title}, ${part.revision.label}` }}
          />
          <div className="readouts">
            <dl>
              <div>
                <dt>Volume</dt>
                <dd data-ui="readout-volume">{shown ? volumeText(shown.volume) : "—"}</dd>
              </div>
              <div>
                <dt>Bounding box</dt>
                <dd>{shown ? bboxText(shown.bbox) : "—"}</dd>
              </div>
              <div>
                <dt>Faces</dt>
                <dd>{shown ? display(shown.faces, 0) : "—"}</dd>
              </div>
              <div>
                <dt>Digest</dt>
                <dd className="digest" title={shown?.digest}>
                  {shown ? shown.digest.slice(0, 12) : "—"}
                </dd>
              </div>
            </dl>
            <p className="eval-status" role="status" aria-label="Evaluation">
              {statusText}
            </p>
          </div>
          {view.slow ? (
            <p className="slow-notice" data-ui="slow-notice">
              Still evaluating. Large parts can take a few seconds.
            </p>
          ) : null}

          <section className="findings-region" role="region" aria-label="Findings">
            {stale && report?.findings.length ? (
              <p className="stale-banner">
                <Icon name="info" size={16} />
                These findings describe an earlier configuration.
              </p>
            ) : null}
            <Findings options={options} selectedKey={selectedKey} labels={labels} onSelect={onSelect} onGoTo={goTo} />
          </section>

          {tape ? (
            <section className="tape-region" aria-label="Build tape controls">
              <BuildTape
                tape={tape}
                k={k}
                disabled={tapeOff}
                onChange={setPlayhead}
                onFork={owner ? () => setDialog("fork") : undefined}
              />
              {tapeOff ? <p className="muted small">{`The tape shows ${part.revision.label}; save to record a tape for these values.`}</p> : null}
              {pinReport ? null : <p className="muted small">{`No pre-flight report for ${part.revision.label} yet.`}</p>}
            </section>
          ) : null}
        </div>

        <aside className="rail" aria-label="Part controls">
          <RailGroup name="Dimensions" open={open.includes("Dimensions")} onToggle={() => toggle("Dimensions")} reduced={reduced}>
            <div className="rail-head">
              <RadioGroup
                label="Units"
                name="units"
                value={units}
                options={[
                  { value: "mm", label: "Millimetres", face: "mm" },
                  { value: "in", label: "Inches", face: "in" },
                ]}
                onChange={setUnits}
              />
              <span className="count">{`${modified} modified`}</span>
              <button type="button" className="button" onClick={resetAll}>
                Reset all
              </button>
            </div>
            {groups.map((group) => (
              <div key={group} className="param-group">
                {groups.length > 1 ? <h4>{group}</h4> : null}
                {manifest
                  .filter((m) => m.group === group)
                  .map((entry) => (
                    <div key={entry.name} data-param={entry.name}>
                      {entry.derived ? (
                        <p className="derived">{`${entry.label} ${display(entry.value as number, entry.precision)}${NNBSP}mm`}</p>
                      ) : entry.kind === "boolean" ? (
                        <SwitchField entry={entry} value={entry.value as boolean} modified={isModified(entry, values)} onChange={(v) => commit(entry.name, v)} />
                      ) : entry.kind === "enum" ? (
                        <EnumField entry={entry} value={entry.value as string} modified={isModified(entry, values)} onChange={(v) => commit(entry.name, v)} />
                      ) : (
                        <Spin entry={entry} value={entry.value as number} units={units} modified={isModified(entry, values)} onCommit={(v) => commit(entry.name, v)} />
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </RailGroup>

          <RailGroup name="Pre-flight" open={open.includes("Pre-flight")} onToggle={() => toggle("Pre-flight")} reduced={reduced}>
            <RadioGroup label="Process" name="process" value={process} options={PROCESSES.map((p) => ({ value: p.id, label: p.label }))} onChange={setProcess} />
            <button
              type="button"
              className="button primary run"
              disabled={running || (!me && left === 0)}
              onClick={runPreflight}
            >
              <span className={running ? "busy" : undefined}>
                {me ? "Run pre-flight" : `Run pre-flight (${left ?? limit} of ${limit} left this session)`}
              </span>
            </button>
            {!me && left === 0 ? <p className="field-error"><Icon name="alert" size={16} />Sign in to run more pre-flight reports.</p> : null}
            <p className="muted small" role="status" aria-label="Pre-flight">
              {preStatus}
            </p>
            <ReportRegion report={report} state={reportState} epoch={reportEpoch} processLabel={processLabel} />
          </RailGroup>

          <RailGroup name="Revisions" open={open.includes("Revisions")} onToggle={() => toggle("Revisions")} reduced={reduced}>
            <ul className="revisions" aria-label="Revisions" key={revisions[0]?.id ?? "none"}>
              {revisions.map((rev, index) => (
                <li key={rev.id} aria-current={rev.id === part.revision.id ? "true" : undefined}>
                  <Link to={partAddress(slug, { revision: rev.id })}>{rev.label}</Link>
                  <span className="muted">{` · ${rev.message} · ${authors[rev.authorId] ?? ""}`}</span>
                  <span className="row-actions">
                    {index > 0 ? (
                      <Link to={`/parts/${slug}/compare?base=${rev.id}&head=${revisions[0]?.id}&view=overlay`} aria-label={`Compare ${rev.label} with ${revisions[0]?.label}`}>
                        Compare
                      </Link>
                    ) : null}
                    {owner && index > 0 ? (
                      <button type="button" className="button small" aria-label={`Restore ${rev.label}`} onClick={() => setDialog({ restore: rev })}>
                        Restore
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <Link to={`/tapes/${part.revision.id}`} className="button">
              Open build tape
            </Link>
          </RailGroup>

          <RailGroup name="Review" open={open.includes("Review")} onToggle={() => toggle("Review")} reduced={reduced}>
            {owner ? (
              <button type="button" className="button" onClick={() => setDialog("review")}>
                Start review
              </button>
            ) : null}
            {rooms.length ? (
              <ul className="rooms">
                {rooms.map((room) => (
                  <li key={room.id}>
                    <Link to={`/rooms/${room.id}`}>{room.title}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No review rooms for this part yet.</p>
            )}
          </RailGroup>
        </aside>

        <section className="source" role="region" aria-label="Source" tabIndex={0} ref={sourcePane}>
          <ol>
            {sourceLines.map((text, i) => (
              <li key={i} data-line={i + 1} aria-current={activeLine === i + 1 ? "true" : undefined}>
                <code>{text}</code>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {dialog === "save" && me ? (
        <SaveDialog
          part={part}
          me={me}
          values={complete(manifest, values)}
          storageDown={storageDown}
          knownHead={knownHead}
          initialMessage={draftMessage}
          onClose={() => setDialog(null)}
          onSaved={afterSave}
          onCopied={(copy) => {
            window.sessionStorage.setItem(`tinework:announce:${copy}`, "Saved r1.");
            setDialog(null);
            navigate(partAddress(copy, { config: currentConfig }));
          }}
          onConflict={onConflict}
        />
      ) : null}
      {dialog === "signup" ? (
        <SignUpDialog next={partAddress(slug, { revision: paramsOf(window.location.search).revision ?? null, config: currentConfig, save: "1" })} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === "object" ? (
        <RestoreDialog
          slug={slug}
          revision={dialog.restore}
          knownHead={knownHead}
          storageDown={storageDown}
          onClose={() => setDialog(null)}
          onRestored={(rev) => {
            own.current.add(rev.id);
            setRevisions((list) => (list.some((r) => r.id === rev.id) ? list : [rev, ...list]));
            setKnownHead(rev.id);
            setActivity(`Saved ${rev.label}.`);
            setDialog(null);
          }}
          onConflict={(head) => onConflict(head, draftMessage)}
        />
      ) : null}
      {dialog === "fork" && tape ? (
        <ForkDialog
          revisionId={part.revision.id}
          operation={k}
          bodyIndex={tape.operations.find((o) => o.kind === "body")?.index ?? 0}
          knownHead={knownHead}
          storageDown={storageDown}
          onClose={() => setDialog(null)}
          onForked={(rev) => navigate(partAddress(slug, { revision: rev.id, operation: String(k) }))}
          onConflict={(head) => onConflict(head, draftMessage)}
        />
      ) : null}
      {dialog === "review" ? (
        <ReviewDialog slug={slug} onClose={() => setDialog(null)} onCreated={(room: RoomJson) => navigate(`/rooms/${room.id}`)} />
      ) : null}
    </div>
  );
}

function keyOf(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

function involvedShapes(solid: { ops: SolidOp[] }, finding: Finding): LitShape[] {
  const body = solid.ops[0];
  if (!body) return [];
  const height = body.op === "box" || body.op === "cylinder" ? body.h : 0;
  if (!finding.cutLabel) return [{ kind: "op", op: body, bodyHeight: height }];
  const [cx, cy] = finding.pose.target;
  const cuts = solid.ops.filter((o) => o.op === "hole" || o.op === "slot") as (SolidOp & { x: number; y: number })[];
  const nearest = cuts.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
  return nearest ? [{ kind: "op", op: nearest, bodyHeight: height }] : [];
}

function RailGroup({ name, open, onToggle, children, reduced }: { name: GroupName; open: boolean; onToggle: () => void; children: React.ReactNode; reduced: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.toggleAttribute("inert", !open);
  }, [open]);
  const id = `group-${name.toLowerCase().replace(/[^a-z]/g, "")}`;
  return (
    <section className={open ? "group open" : "group"} data-reduced={reduced ? "true" : undefined}>
      <h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span>{name}</span>
          <Icon name="chevron" />
        </button>
      </h3>
      <div id={id} ref={body} className="group-body" role="region" aria-label={name} aria-hidden={open ? undefined : true}>
        <div className="group-inner">{children}</div>
      </div>
    </section>
  );
}

function ReportRegion({ report, state, epoch, processLabel }: { report: PreflightReport | null; state: string; epoch: number; processLabel: string }) {
  return (
    <section className="report" role="region" aria-label="Pre-flight report" data-state={state} data-epoch={epoch}>
      {state === "unrun" ? <p className="muted small">No report yet. Choose a process and run pre-flight.</p> : null}
      {state === "running" ? <p className="muted small">{`Checking against ${processLabel}...`}</p> : null}
      {state === "stale" ? (
        <p className="stale-banner">
          <Icon name="info" size={16} />
          This report describes an earlier configuration. Run pre-flight again to update it.
        </p>
      ) : null}
      {report && state !== "unrun" && state !== "running" ? (
        report.status === "unsupported" ? (
          <p>{report.message}</p>
        ) : (
          <>
            <p className="summary">{summaryOf(report)}</p>
            <ul className="cost">
              {report.costBands.map((band) => (
                <li key={band.quantity}>
                  <span>{`Quantity ${band.quantity}`}</span> <span>{band.text}</span>
                </li>
              ))}
            </ul>
            <p>{`Typical lead time ${leadTime(report.process)}`}</p>
            <p>{`Confidence: ${report.confidence}`}</p>
            <p className="muted small">Estimate from geometry alone. Not a quote: no supplier has seen this part.</p>
          </>
        )
      ) : null}
    </section>
  );
}

function findingCounts(report: PreflightReport): { blocking: number; advisory: number } {
  return {
    blocking: report.findings.filter((f) => f.severity === "Blocking").length,
    advisory: report.findings.filter((f) => f.severity === "Advisory").length,
  };
}

function summaryOf(report: PreflightReport): string {
  const { blocking, advisory } = findingCounts(report);
  return report.findings.length === 1 && report.findings[0]?.severity === "Pass" ? (report.findings[0]?.message ?? "") : `${blocking} blocking, ${advisory} advisory`;
}
