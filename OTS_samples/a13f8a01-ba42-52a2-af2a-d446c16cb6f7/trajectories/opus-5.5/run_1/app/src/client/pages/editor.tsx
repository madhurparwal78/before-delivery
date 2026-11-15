import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { paneNames, type Files, type Pen, type PaneName, type Version } from "../../shared/types";
import { api, idempotencyKey } from "../api";
import { indent, normaliseLineEndings, outdent } from "../codePane";
import { TabList, tabPanelProps } from "../components";
import { forksText, formatTime, likesText, unverifiedText, versionLabel } from "../format";
import { useBand } from "../hooks";
import { Page } from "../layout";
import { useLive } from "../live";
import { ConsoleLog, PreviewRegion, PreviewStatus, usePreview } from "../preview";
import { Link, navigate } from "../router";
import { setFlash, takeFlash, useAppState } from "../store";
import { DeleteDialog, SettingsDialog, ShareDialog } from "./editorDialogs";
import { NotFound } from "./simple";

type Layout = "side" | "stacked" | "preview-first";

interface LayoutPrefs {
  layout: Layout;
  preview: number;
  htmlCss: number;
  cssJs: number;
}

interface Draft {
  files: Files;
  libraries: string[];
  base: number;
  time: number;
}

interface WorkingCopy {
  files: Files;
  libraries: string[];
}

const layoutKey = "ashlar:layout";
const paneLabels: Record<PaneName, string> = { html: "HTML", css: "CSS", js: "JS" };
const layouts: { value: Layout; label: string }[] = [
  { value: "side", label: "Side by side" },
  { value: "stacked", label: "Stacked" },
  { value: "preview-first", label: "Preview first" },
];
const emptyCopy: WorkingCopy = { files: { html: "", css: "", js: "" }, libraries: [] };

function readPrefs(): LayoutPrefs {
  const defaults: LayoutPrefs = { layout: "side", preview: 47, htmlCss: 50, cssJs: 50 };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(layoutKey) ?? "{}") as Partial<LayoutPrefs>) };
  } catch {
    return defaults;
  }
}

const draftKey = (penId: string) => `ashlar:draft:${penId}`;

function readDraft(penId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(penId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function clamp(value: number): number {
  return Math.min(85, Math.max(15, Math.round(value)));
}

function Separator(props: {
  label: string;
  orientation: "vertical" | "horizontal";
  value: number;
  onChange: (value: number) => void;
  fromPointer: (event: PointerEvent) => number;
  hidden?: boolean;
}) {
  return (
    <div
      role="separator"
      tabIndex={props.hidden ? -1 : 0}
      hidden={props.hidden}
      aria-label={props.label}
      aria-orientation={props.orientation}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={props.value}
      class={`separator separator-${props.orientation}`}
      onKeyDown={(event) => {
        const step: Record<string, number> = { ArrowLeft: -5, ArrowUp: -5, ArrowRight: 5, ArrowDown: 5 };
        let next: number | null = null;
        if (event.key in step) next = props.value + (step[event.key] ?? 0);
        else if (event.key === "Home") next = 15;
        else if (event.key === "End") next = 85;
        if (next === null) return;
        event.preventDefault();
        props.onChange(clamp(next));
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        target.focus();
        const move = (moveEvent: PointerEvent) => props.onChange(clamp(props.fromPointer(moveEvent)));
        const stop = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", stop);
          target.removeEventListener("pointercancel", stop);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", stop);
        target.addEventListener("pointercancel", stop);
      }}
    />
  );
}

function ForkCredit({ pen }: { pen: Pen }) {
  const source = pen.forked_from;
  if (source === null) return null;
  if ("removed" in source) return <p class="fork-credit">Forked from a removed pen</p>;
  if ("hidden" in source) return <p class="fork-credit">Forked from a private pen</p>;
  return (
    <p class="fork-credit">
      <Link href={`/pen/${source.pen_id}`}>{`Forked from ${source.title} by ${source.owner}`}</Link>
    </p>
  );
}

export function Editor({ penId }: { penId: string }) {
  const [pen, setPen] = useState<Pen | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void api<Pen>("GET", `/api/pens/${penId}`).then((result) => {
      if (result.ok) setPen(result.data);
      else setMissing(true);
    });
  }, [penId]);
  if (missing) return <NotFound />;
  if (!pen) {
    return (
      <Page class="editor-loading">
        <div class="state-panel">Opening the pen…</div>
      </Page>
    );
  }
  return <EditorScreen initial={pen} />;
}

function EditorScreen({ initial }: { initial: Pen }) {
  const { user, config } = useAppState();
  const band = useBand();
  const preview = usePreview();
  const penId = initial.id;
  const isOwner = user !== null && user.handle === initial.owner;

  const [pen, setPen] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [head, setHead] = useState(initial.head);
  const [libraries, setLibraries] = useState<string[]>(initial.version?.libraries ?? []);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState(() => takeFlash(`save:${initial.id}`));
  const [exportStatus, setExportStatus] = useState("");
  const [likesNote, setLikesNote] = useState("");
  const [forksNote, setForksNote] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");
  const [conflictHead, setConflictHead] = useState<number | null>(null);
  const [draftOffer, setDraftOffer] = useState<Draft | null>(() => (isOwner ? readDraft(initial.id) : null));
  const [dialog, setDialog] = useState<"settings" | "share" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [prefs, setPrefs] = useState(readPrefs);
  const [paneTab, setPaneTab] = useState("html");
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [forkPending, setForkPending] = useState(false);

  const areas = useRef<Record<PaneName, HTMLTextAreaElement | null>>({ html: null, css: null, js: null });
  const loaded = useRef<WorkingCopy>(initial.version ? { files: initial.version.files, libraries: initial.version.libraries } : emptyCopy);
  const base = useRef(initial.head);
  const librariesRef = useRef(libraries);
  librariesRef.current = libraries;
  const dirtyRef = useRef(false);
  const armedLeave = useRef(false);
  const previewTimer = useRef<number | undefined>(undefined);
  const saving = useRef(false);
  const forkKey = useRef(idempotencyKey());
  const shareButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const keepMineButton = useRef<HTMLButtonElement>(null);
  const editorRoot = useRef<HTMLDivElement>(null);
  const panesRoot = useRef<HTMLDivElement>(null);

  const workingCopy = (): WorkingCopy => {
    const files = { ...loaded.current.files };
    for (const pane of paneNames) {
      const value = areas.current[pane]?.value ?? "";
      if (value !== normaliseLineEndings(loaded.current.files[pane])) files[pane] = value;
    }
    return { files, libraries: librariesRef.current };
  };

  const refreshDirty = () => {
    const copy = workingCopy();
    const changed =
      paneNames.some((pane) => copy.files[pane] !== loaded.current.files[pane]) || copy.libraries.join(",") !== loaded.current.libraries.join(",");
    dirtyRef.current = changed;
    setDirty(changed);
  };

  const putIntoPanes = (files: Files) => {
    for (const pane of paneNames) {
      const area = areas.current[pane];
      if (area) area.value = files[pane];
    }
  };

  const schedulePreview = () => {
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => preview.render(workingCopy()), config.preview_delay_ms);
  };

  const onEdit = () => {
    refreshDirty();
    schedulePreview();
  };

  useLayoutEffect(() => {
    putIntoPanes(loaded.current.files);
    preview.render(loaded.current);
    return () => window.clearTimeout(previewTimer.current);
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    const timer = window.setInterval(() => {
      if (!dirtyRef.current) return;
      const copy = workingCopy();
      const draft: Draft = { files: copy.files, libraries: copy.libraries, base: base.current, time: Date.now() };
      localStorage.setItem(draftKey(penId), JSON.stringify(draft));
    }, config.draft_interval_ms);
    return () => window.clearInterval(timer);
  }, [isOwner, config.draft_interval_ms]);

  useEffect(() => {
    localStorage.setItem(layoutKey, JSON.stringify(prefs));
  }, [prefs]);

  useLive([penId], (event) => {
    if (event.type !== "counts" || event.data.pen_id !== penId) return;
    setPen((current) => ({ ...current, likes: event.data.likes, forks: event.data.forks }));
    setLikesNote("");
    setForksNote("");
  });

  const clearDraft = () => localStorage.removeItem(draftKey(penId));

  const save = async (baseVersion: number) => {
    if (!isOwner || saving.current) return;
    saving.current = true;
    const copy = workingCopy();
    setSaveStatus("Saving…");
    const result = await api<Version>(
      "POST",
      `/api/pens/${penId}/versions`,
      { base_version: baseVersion, files: copy.files, libraries: copy.libraries },
      { "Idempotency-Key": idempotencyKey() },
    );
    saving.current = false;
    if (result.ok) {
      loaded.current = { files: copy.files, libraries: copy.libraries };
      base.current = result.data.number;
      setHead(result.data.number);
      setPen((current) => ({ ...current, head: result.data.number, version: result.data }));
      setConflictHead(null);
      setSaveStatus(`Saved as version ${result.data.number}`);
      clearDraft();
      setDraftOffer(null);
      refreshDirty();
      return;
    }
    const error = result.error;
    if (error.error === "version_conflict" && error.head !== undefined) {
      setSaveStatus("");
      setConflictHead(error.head);
      base.current = error.head;
      window.setTimeout(() => keepMineButton.current?.focus(), 0);
    } else if (error.error === "unverified") {
      setSaveStatus(unverifiedText(user?.email ?? ""));
    } else if (error.error === "validation" && error.fields) {
      const pane = paneNames.find((name) => error.fields?.[name]);
      setSaveStatus(pane ? `The ${paneLabels[pane]} pane is over ${config.pane_limit_bytes} bytes, so this version was not saved.` : error.message);
    } else {
      setSaveStatus("Storage is unreachable, so this version was not saved. Your edits are still here.");
    }
  };

  const loadLatest = async () => {
    const result = await api<Pen>("GET", `/api/pens/${penId}`);
    if (!result.ok || !result.data.version) return;
    const version = result.data.version;
    loaded.current = { files: version.files, libraries: version.libraries };
    base.current = version.number;
    putIntoPanes(version.files);
    setLibraries(version.libraries);
    librariesRef.current = version.libraries;
    setHead(version.number);
    setPen(result.data);
    setConflictHead(null);
    setSaveStatus(`Loaded version ${version.number}`);
    clearDraft();
    refreshDirty();
    window.clearTimeout(previewTimer.current);
    preview.render(loaded.current);
    window.setTimeout(() => areas.current.html?.focus(), 0);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(base.current);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const saveTitle = async () => {
    if (!isOwner || title === pen.title) return;
    const result = await api<Pen>("PATCH", `/api/pens/${penId}`, { title });
    if (result.ok) setPen((current) => ({ ...current, title: result.data.title, updated_at: result.data.updated_at }));
    else setSaveStatus(result.error.fields?.title ?? result.error.message);
  };

  const toggleLike = async () => {
    const result = await api<{ liked: boolean; likes: number }>(pen.liked ? "DELETE" : "PUT", `/api/pens/${penId}/like`);
    if (result.ok) {
      setPen((current) => ({ ...current, liked: result.data.liked, likes: result.data.likes }));
      setLikesNote("");
    } else {
      setLikesNote(result.error.error === "unverified" ? unverifiedText(user?.email ?? "") : result.error.message);
    }
  };

  const fork = async () => {
    if (forkPending) return;
    setForkPending(true);
    const result = await api<Pen>("POST", `/api/pens/${penId}/fork`, undefined, { "Idempotency-Key": forkKey.current });
    setForkPending(false);
    if (result.ok) {
      forkKey.current = idempotencyKey();
      navigate(`/pen/${result.data.id}`);
    } else if (result.error.error === "unverified") {
      setForksNote(unverifiedText(user?.email ?? ""));
    } else if (result.error.error === "storage_unavailable") {
      setForksNote("Storage is unreachable, so the fork was not made.");
    } else {
      setForksNote(result.error.message);
    }
  };

  const exportPen = async () => {
    let response: Response;
    try {
      response = await fetch(`/api/pens/${penId}/export`, { credentials: "same-origin" });
    } catch {
      setExportStatus("Storage is unreachable, so the export was not made. Your pen is unchanged.");
      return;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setExportStatus(
        body?.error === "nothing_to_export" ? "Save a version before exporting." : "Storage is unreachable, so the export was not made. Your pen is unchanged.",
      );
      return;
    }
    const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `${penId}.zip`;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    setExportStatus(`Exported version ${/-v(\d+)\.zip$/.exec(name)?.[1] ?? head}`);
  };

  const deletePen = async () => {
    const result = await api("DELETE", `/api/pens/${penId}`);
    if (result.ok) {
      clearDraft();
      setFlash("dashboard", `Deleted "${pen.title}"`);
      navigate("/dashboard");
      return;
    }
    setDeleteOpen(false);
    setSettingsStatus(result.error.error === "storage_unavailable" ? "Storage is unreachable, so the pen was not deleted." : result.error.message);
  };

  const changeLibraries = (next: string[]) => {
    setLibraries(next);
    librariesRef.current = next;
    onEdit();
  };

  const restoreDraft = () => {
    if (!draftOffer) return;
    putIntoPanes(draftOffer.files);
    changeLibraries(draftOffer.libraries);
    setDraftOffer(null);
    window.setTimeout(() => areas.current.html?.focus(), 0);
  };

  const discardDraft = () => {
    clearDraft();
    setDraftOffer(null);
    window.setTimeout(() => areas.current.html?.focus(), 0);
  };

  const onPaneKeyDown = (event: KeyboardEvent) => {
    const area = event.currentTarget as HTMLTextAreaElement;
    if (event.key === "Escape") {
      armedLeave.current = true;
      return;
    }
    if (event.key === "Tab") {
      if (armedLeave.current) {
        armedLeave.current = false;
        return;
      }
      event.preventDefault();
      if (event.shiftKey) outdent(area);
      else indent(area);
      onEdit();
      return;
    }
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) armedLeave.current = false;
  };

  const narrow = band === "narrow";
  const wide = band === "wide";
  const layout: Layout = wide ? prefs.layout : "side";
  const panesInColumns = layout !== "side";
  const setPref = (patch: Partial<LayoutPrefs>) => setPrefs((current) => ({ ...current, ...patch }));

  const htmlShare = prefs.htmlCss / (100 - prefs.htmlCss);
  const jsShare = (100 - prefs.cssJs) / prefs.cssJs;
  const paneGrow: Record<PaneName, number> = { html: htmlShare, css: 1, js: jsShare };

  const pointerShare = (event: PointerEvent, element: HTMLElement | null, horizontal: boolean): number => {
    const rect = element?.getBoundingClientRect();
    if (!rect) return 50;
    return horizontal ? ((event.clientX - rect.left) / rect.width) * 100 : ((event.clientY - rect.top) / rect.height) * 100;
  };

  const pairShare = (event: PointerEvent, first: PaneName, second: PaneName): number => {
    const a = areas.current[first]?.closest("section")?.getBoundingClientRect();
    const b = areas.current[second]?.closest("section")?.getBoundingClientRect();
    if (!a || !b) return 50;
    if (panesInColumns) return ((event.clientX - a.left) / (b.right - a.left)) * 100;
    return ((event.clientY - a.top) / (b.bottom - a.top)) * 100;
  };

  const style = {
    "--preview-share": String(prefs.preview),
    "--code-share": String(100 - prefs.preview),
  } as Record<string, string>;

  const paneTabs = [
    { id: "html", label: "HTML" },
    { id: "css", label: "CSS" },
    { id: "js", label: "JS" },
    { id: "result", label: "Result" },
    { id: "console", label: "Console", badge: preview.count },
  ];

  return (
    <Page class="editor-page">
      <div ref={editorRoot} class="editor" data-band={band} data-layout={layout} style={style}>
        <div class="editor-toolbar">
          <div class="title-row">
            <input
              type="text"
              class="title-input"
              aria-label="Pen title"
              value={title}
              readOnly={!isOwner}
              onInput={(event) => setTitle(event.currentTarget.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveTitle();
              }}
            />
            <span class="version-label figure">{versionLabel(head)}</span>
            {dirty && <span class="dirty-mark">Unsaved edits</span>}
          </div>
          <div class="toolbar-actions">
            {isOwner && (
              <button type="button" class="primary" onClick={() => void save(base.current)}>
                Save
              </button>
            )}
            {user && (
              <button type="button" aria-pressed={pen.liked ? "true" : "false"} onClick={() => void toggleLike()}>
                Like
              </button>
            )}
            <p role="status" aria-label="Likes" class="count-status figure">
              {likesNote || likesText(pen.likes)}
            </p>
            {user && (
              <button type="button" disabled={forkPending} onClick={() => void fork()}>
                Fork
              </button>
            )}
            <p role="status" aria-label="Forks" class="count-status figure">
              {forksNote || forksText(pen.forks)}
            </p>
            <button type="button" ref={shareButton} onClick={() => setDialog("share")}>
              Share
            </button>
            <Link href={`/pen/${penId}/history`} class="button">
              History
            </Link>
            <button type="button" onClick={() => void exportPen()}>
              Export
            </button>
            {isOwner && (
              <button type="button" ref={settingsButton} onClick={() => setDialog("settings")}>
                Pen settings
              </button>
            )}
          </div>
          <div role="radiogroup" aria-label="Layout" class="radio-row layout-choice" hidden={!wide} inert={!wide}>
            {layouts.map((option) => (
              <label key={option.value} class="radio">
                <input type="radio" name="layout" value={option.value} checked={prefs.layout === option.value} onChange={() => setPref({ layout: option.value })} />
                {option.label}
              </label>
            ))}
          </div>
          <ForkCredit pen={pen} />
          <p role="status" aria-label="Save status" class="quiet-status">
            {saveStatus}
          </p>
          <p role="status" aria-label="Export status" class="quiet-status">
            {exportStatus}
          </p>
        </div>

        {narrow && <TabList label="Panes" tabs={paneTabs} selected={paneTab} onSelect={setPaneTab} idPrefix="panes" />}

        <div class="editor-stage" {...(narrow ? tabPanelProps("panes", "result", paneTab) : {})}>
          <PreviewRegion preview={preview} />
          <PreviewStatus preview={preview} />
        </div>

        <Separator
          label="Resize preview and code"
          orientation={layout === "side" ? "vertical" : "horizontal"}
          value={prefs.preview}
          hidden={!wide}
          onChange={(value) => setPref({ preview: value })}
          fromPointer={(event) => {
            const share = pointerShare(event, editorRoot.current, layout === "side");
            return layout === "stacked" ? 100 - share : share;
          }}
        />

        <div class="editor-panes" ref={panesRoot} data-columns={panesInColumns ? "true" : "false"}>
          {conflictHead !== null && (
            <div role="alert" class="state-panel conflict">
              <p>{`Version ${conflictHead} of this pen was saved somewhere else. Your edits are still here.`}</p>
              <div class="panel-actions">
                <button type="button" class="primary" ref={keepMineButton} onClick={() => void save(conflictHead)}>
                  Keep mine as next version
                </button>
                <button type="button" onClick={() => void loadLatest()}>
                  Load latest
                </button>
              </div>
            </div>
          )}
          {draftOffer && (
            <section role="region" aria-label="Unsaved draft" class="state-panel draft">
              <p>{`You have unsaved edits from ${formatTime(new Date(draftOffer.time))}.`}</p>
              <div class="panel-actions">
                <button type="button" class="primary" onClick={restoreDraft}>
                  Restore draft
                </button>
                <button type="button" onClick={discardDraft}>
                  Discard draft
                </button>
              </div>
            </section>
          )}
          <div class="pane-group">
            {paneNames.map((pane, index) => (
              <Fragment key={pane}>
                {index > 0 && (
                  <Separator
                    label={index === 1 ? "Resize HTML and CSS" : "Resize CSS and JS"}
                    orientation={panesInColumns ? "vertical" : "horizontal"}
                    value={index === 1 ? prefs.htmlCss : prefs.cssJs}
                    hidden={narrow}
                    onChange={(value) => setPref(index === 1 ? { htmlCss: value } : { cssJs: value })}
                    fromPointer={(event) => (index === 1 ? pairShare(event, "html", "css") : pairShare(event, "css", "js"))}
                  />
                )}
                <section class={`pane pane-${pane}`} style={{ flexGrow: paneGrow[pane] }} {...(narrow ? tabPanelProps("panes", pane, paneTab) : {})}>
                  <h2 class="pane-heading">{paneLabels[pane]}</h2>
                  <textarea
                    ref={(element) => {
                      areas.current[pane] = element;
                    }}
                    class="code"
                    aria-label={`${paneLabels[pane]} code`}
                    spellcheck={false}
                    autocapitalize="off"
                    autocomplete="off"
                    wrap="off"
                    onInput={onEdit}
                    onKeyDown={onPaneKeyDown}
                  />
                </section>
              </Fragment>
            ))}
          </div>
        </div>

        <div class="console-band" {...(narrow ? tabPanelProps("panes", "console", paneTab) : {})}>
          <div class="console-controls">
            {!narrow && (
              <button type="button" aria-expanded={consoleOpen ? "true" : "false"} onClick={() => setConsoleOpen((open) => !open)}>
                Console
                <span class="badge figure" aria-hidden="true">
                  {preview.count}
                </span>
              </button>
            )}
            {(narrow || consoleOpen) && (
              <button type="button" class="quiet" onClick={preview.clearConsole}>
                Clear console
              </button>
            )}
          </div>
          <ConsoleLog preview={preview} hidden={!narrow && !consoleOpen} />
        </div>
      </div>

      {dialog === "settings" && (
        <SettingsDialog
          pen={pen}
          libraries={libraries}
          status={settingsStatus}
          onStatus={setSettingsStatus}
          onPen={(updated) => setPen((current) => ({ ...current, visibility: updated.visibility, tags: updated.tags, updated_at: updated.updated_at }))}
          onLibraries={changeLibraries}
          onDelete={() => setDeleteOpen(true)}
          onClose={() => setDialog(null)}
          returnFocus={() => settingsButton.current}
        />
      )}
      {dialog === "settings" && deleteOpen && <DeleteDialog title={pen.title} onConfirm={() => void deletePen()} onCancel={() => setDeleteOpen(false)} />}
      {dialog === "share" && <ShareDialog pen={pen} onClose={() => setDialog(null)} returnFocus={() => shareButton.current} />}
    </Page>
  );
}
