import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { PANES, PANE_LABEL, type Files, type PaneKey, type Pen, type Version } from "../../shared/types.js";
import { ApiFailure, api, download, messageOf } from "../api.js";
import { useAccount } from "../account.js";
import { CodePane } from "../components/code-pane.js";
import { ConsoleBand, EMPTY_CONSOLE, pushEntry, type ConsoleState } from "../components/console-band.js";
import { Icon } from "../components/icons.js";
import { StatePanel } from "../components/panels.js";
import { PreviewRegion, type Renderer } from "../components/render-frame.js";
import { Separator } from "../components/separator.js";
import { SettingsDialog } from "../components/settings-dialog.js";
import { ShareDialog } from "../components/share-dialog.js";
import { Shell } from "../components/shell.js";
import { useConfig } from "../config.js";
import { countLabel, formatClock } from "../format.js";
import { useLive } from "../live.js";
import { Link, navigate, takeFlash } from "../router.js";
import { useBand } from "../use-media.js";
import { usePrefs, type LayoutName } from "../use-prefs.js";
import { NotFoundBody } from "./not-found.js";
import type { ClientConfig } from "../../shared/types.js";

interface Working {
  files: Files;
  libraries: string[];
}

interface Draft extends Working {
  savedAt: number;
}

const BLANK: Working = { files: { html: "", css: "", js: "" }, libraries: [] };
const LAYOUTS: readonly (readonly [LayoutName, string])[] = [
  ["side", "Side by side"],
  ["stacked", "Stacked"],
  ["first", "Preview first"],
];
const PHONE_TABS = ["html", "css", "js", "result", "console"] as const;
type PhoneTab = (typeof PHONE_TABS)[number];
const PHONE_LABEL: Record<PhoneTab, string> = { html: "HTML", css: "CSS", js: "JS", result: "Result", console: "Console" };

const sameContent = (a: Working, b: Working): boolean => PANES.every((pane) => a.files[pane] === b.files[pane]) && a.libraries.join(",") === b.libraries.join(",");
const contentOf = (pen: Pen): Working => (pen.version ? { files: pen.version.files, libraries: pen.version.libraries } : BLANK);
const draftKey = (id: string): string => `ashlar-draft:${id}`;

function readDraft(id: string, loaded: Working): Draft | null {
  const stored = localStorage.getItem(draftKey(id));
  if (stored === null) return null;
  const draft = JSON.parse(stored) as Draft;
  if (sameContent(draft, loaded)) {
    localStorage.removeItem(draftKey(id));
    return null;
  }
  return draft;
}

function randomKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function EditorPage({ id }: { id: string }): React.JSX.Element {
  const config = useConfig();
  const [pen, setPen] = useState<Pen | null>(null);
  const [problem, setProblem] = useState<{ missing: boolean; message: string } | null>(null);

  useEffect(() => {
    api.get<Pen>(`/api/pens/${id}`).then(setPen, (error: unknown) =>
      setProblem({ missing: error instanceof ApiFailure && error.status === 404, message: messageOf(error) }),
    );
  }, [id]);

  if (problem?.missing) {
    return (
      <Shell>
        <NotFoundBody />
      </Shell>
    );
  }
  if (problem !== null) {
    return (
      <Shell>
        <section className="wide-page narrow-measure">
          <StatePanel drawing={false}>{problem.message}</StatePanel>
        </section>
      </Shell>
    );
  }
  if (pen === null || config === null) {
    return (
      <Shell>
        <section className="wide-page narrow-measure">
          <StatePanel drawing={false}>Opening the pen…</StatePanel>
        </section>
      </Shell>
    );
  }
  return <Editor initial={pen} config={config} />;
}

function Editor({ initial, config }: { initial: Pen; config: ClientConfig }): React.JSX.Element {
  const { user } = useAccount();
  const band = useBand();
  const [prefs, setPrefs] = usePrefs();
  const [pen, setPen] = useState(initial);
  const isOwner = user !== null && user.handle === pen.owner;

  const start = contentOf(initial);
  const [working, setWorking] = useState(start);
  const [loaded, setLoaded] = useState(start);
  const [loadedVersion, setLoadedVersion] = useState(initial.head);
  const workingRef = useRef(start);
  const loadedRef = useRef(start);
  const baseRef = useRef(initial.head);
  const savingRef = useRef(false);

  const [title, setTitle] = useState(initial.title);
  const [titleProblem, setTitleProblem] = useState("");
  const [saveStatus, setSaveStatus] = useState(() => takeFlash() ?? "");
  const [likesMessage, setLikesMessage] = useState("");
  const [forksMessage, setForksMessage] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [conflict, setConflict] = useState<{ message: string } | null>(null);
  const [draft, setDraft] = useState(() => readDraft(initial.id, start));
  const [console_, setConsole] = useState<ConsoleState>(EMPTY_CONSOLE);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [forking, setForking] = useState(false);
  const [tab, setTab] = useState<PhoneTab>("html");

  const preview = useRef<Renderer>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const htmlField = useRef<HTMLTextAreaElement>(null);
  const forkKey = useRef(randomKey());
  const timer = useRef<number | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const stageCell = useRef<HTMLDivElement>(null);
  const panesGroup = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<PaneKey, HTMLElement | null>>({ html: null, css: null, js: null });
  const phoneTabs = useRef<Record<PhoneTab, HTMLButtonElement | null>>({ html: null, css: null, js: null, result: null, console: null });

  const renderNow = (): void =>
    preview.current?.start({ kind: "files", files: workingRef.current.files, libraries: workingRef.current.libraries });

  const schedule = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      renderNow();
    }, config.preview_delay_ms);
  };

  const edit = (next: Working): void => {
    workingRef.current = next;
    setWorking(next);
    schedule();
  };

  const adopt = (content: Working, head: number): void => {
    workingRef.current = content;
    loadedRef.current = content;
    baseRef.current = head;
    setWorking(content);
    setLoaded(content);
    setLoadedVersion(head);
    localStorage.removeItem(draftKey(pen.id));
    setConflict(null);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!sameContent(workingRef.current, loadedRef.current)) {
        const draftNow: Draft = { ...workingRef.current, savedAt: Date.now() };
        localStorage.setItem(draftKey(pen.id), JSON.stringify(draftNow));
      }
    }, config.draft_interval_ms);
    return () => window.clearInterval(interval);
  }, [pen.id, config.draft_interval_ms]);

  useEffect(() => {
    const element = editor.current;
    if (element === null) return;
    const measure = (): void => element.style.setProperty("--chrome-h", `${element.getBoundingClientRect().top + window.scrollY}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (conflict !== null) keep.current?.focus();
  }, [conflict]);

  useLive([pen.id], {
    counts: (counts) => {
      if (counts.pen_id === pen.id) setPen((current) => ({ ...current, likes: counts.likes, forks: counts.forks }));
    },
  });

  const save = async (): Promise<void> => {
    if (!isOwner || savingRef.current) return;
    savingRef.current = true;
    setSaveStatus("Saving…");
    const sent = workingRef.current;
    try {
      const version = await api.post<Version>(`/api/pens/${pen.id}/versions`, {
        base_version: baseRef.current,
        files: sent.files,
        libraries: sent.libraries,
      });
      loadedRef.current = sent;
      baseRef.current = version.number;
      setLoaded(sent);
      setLoadedVersion(version.number);
      localStorage.removeItem(draftKey(pen.id));
      setConflict(null);
      setSaveStatus(`Saved as version ${version.number}`);
    } catch (error) {
      if (error instanceof ApiFailure && error.body.error === "version_conflict" && error.body.head !== undefined) {
        baseRef.current = error.body.head;
        setConflict({ message: error.body.message });
        setSaveStatus("");
      } else {
        setSaveStatus(messageOf(error));
      }
    } finally {
      savingRef.current = false;
    }
  };

  const latestSave = useRef(save);
  latestSave.current = save;
  useEffect(() => {
    const press = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void latestSave.current();
      }
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, []);

  const loadLatest = async (): Promise<void> => {
    try {
      const fresh = await api.get<Pen>(`/api/pens/${pen.id}`);
      adopt(contentOf(fresh), fresh.head);
      setSaveStatus(`Loaded version ${fresh.head}`);
      renderNow();
    } catch (error) {
      setSaveStatus(messageOf(error));
    }
  };

  const commitTitle = async (): Promise<void> => {
    if (!isOwner || title === pen.title) return;
    try {
      const saved = await api.patch<Pen>(`/api/pens/${pen.id}`, { title });
      setPen((current) => ({ ...current, title: saved.title }));
      setTitle(saved.title);
      setTitleProblem("");
    } catch (error) {
      setTitleProblem(messageOf(error));
    }
  };

  const toggleLike = async (): Promise<void> => {
    try {
      const answer = pen.liked
        ? await api.delete<{ liked: boolean; likes: number }>(`/api/pens/${pen.id}/like`)
        : await api.put<{ liked: boolean; likes: number }>(`/api/pens/${pen.id}/like`);
      setPen((current) => ({ ...current, liked: answer.liked, likes: answer.likes }));
      setLikesMessage("");
    } catch (error) {
      setLikesMessage(messageOf(error));
    }
  };

  const fork = async (): Promise<void> => {
    setForking(true);
    try {
      const made = await api.post<Pen>(`/api/pens/${pen.id}/fork`, {}, { "Idempotency-Key": forkKey.current });
      forkKey.current = randomKey();
      navigate(`/pen/${made.id}`);
    } catch (error) {
      setForksMessage(messageOf(error));
      setForking(false);
    }
  };

  const exportHead = async (): Promise<void> => {
    try {
      const file = await download(`/api/pens/${pen.id}/export`);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file.blob);
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(link.href);
      setExportStatus(`Exported version ${/-v(\d+)\.zip/.exec(file.filename)?.[1] ?? ""}`);
    } catch (error) {
      setExportStatus(messageOf(error));
    }
  };

  const closeDraft = (): void => {
    setDraft(null);
    htmlField.current?.focus();
  };

  const setPane = (pane: PaneKey, value: string): void => edit({ ...workingRef.current, files: { ...workingRef.current.files, [pane]: value } });

  const share = (first: DOMRect, last: DOMRect, vertical: boolean, x: number, y: number): number =>
    vertical ? ((x - first.left) / (last.right - first.left)) * 100 : ((y - first.top) / (last.bottom - first.top)) * 100;

  const measurePair = (first: PaneKey, last: PaneKey) => (x: number, y: number): number => {
    const a = sections.current[first]?.getBoundingClientRect();
    const b = sections.current[last]?.getBoundingClientRect();
    return a && b ? share(a, b, prefs.layout !== "side", x, y) : 50;
  };

  const measureStage = (x: number, y: number): number => {
    const stage = stageCell.current?.getBoundingClientRect();
    const group = panesGroup.current?.getBoundingClientRect();
    if (!stage || !group) return prefs.stage;
    if (prefs.layout === "side") return ((x - stage.left) / (group.right - stage.left)) * 100;
    if (prefs.layout === "stacked") return ((stage.bottom - y) / (stage.bottom - group.top)) * 100;
    return ((y - stage.top) / (group.bottom - stage.top)) * 100;
  };

  const sideBySide = prefs.layout === "side";
  const vars = {
    "--stage": prefs.stage,
    "--fr-a": `${prefs.htmlCss / (100 - prefs.htmlCss)}fr`,
    "--fr-c": `${(100 - prefs.cssJs) / prefs.cssJs}fr`,
    "--row-stage": `${prefs.stage}fr`,
    "--row-panes": `${100 - prefs.stage}fr`,
  } as CSSProperties;

  const phone = band === "narrow";
  const dirty = !sameContent(working, loaded);
  const likesText = likesMessage !== "" ? likesMessage : countLabel(pen.likes, "like");
  const forksText = forksMessage !== "" ? forksMessage : countLabel(pen.forks, "fork");

  const toolbar = (
    <div className="toolbar">
      <div className="toolbar-title">
        <input
          type="text"
          aria-label="Pen title"
          className="title-input"
          value={title}
          readOnly={!isOwner}
          aria-describedby={titleProblem === "" ? undefined : "title-problem"}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitTitle();
          }}
        />
        <span className="version-label tabular">{loadedVersion === 0 ? "Not saved yet" : `Version ${loadedVersion}`}</span>
      </div>
      {titleProblem !== "" && (
        <p id="title-problem" className="problem-line">
          {titleProblem}
        </p>
      )}
      <div className="credit">
        {pen.forked_from === null ? null : "pen_id" in pen.forked_from ? (
          <Link to={`/pen/${pen.forked_from.pen_id}`}>{`Forked from ${pen.forked_from.title} by ${pen.forked_from.owner}`}</Link>
        ) : (
          <span>{"removed" in pen.forked_from ? "Forked from a removed pen" : "Forked from a private pen"}</span>
        )}
      </div>
      <div className="toolbar-actions">
        {isOwner && (
          <button type="button" className="button primary" onClick={() => void save()}>
            <Icon name="save" />
            Save
          </button>
        )}
        {user !== null && (
          <button type="button" className="button" aria-pressed={pen.liked} onClick={() => void toggleLike()}>
            <Icon name="heart" />
            Like
          </button>
        )}
        {user !== null && (
          <button type="button" className="button" disabled={forking} aria-busy={forking} onClick={() => void fork()}>
            <Icon name="fork" />
            Fork
          </button>
        )}
        <button type="button" className="button" onClick={() => setShareOpen(true)} aria-haspopup="dialog">
          <Icon name="share" />
          Share
        </button>
        <Link to={`/pen/${pen.id}/history`} className="button">
          <Icon name="history" />
          History
        </Link>
        <button type="button" className="button" onClick={() => void exportHead()}>
          <Icon name="download" />
          Export
        </button>
        {isOwner && (
          <button type="button" className="button" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
            <Icon name="settings" />
            Pen settings
          </button>
        )}
      </div>
      <div className="toolbar-meta">
        <div className="toolbar-status">
          <p role="status" aria-label="Likes">
            {likesText}
          </p>
          <p role="status" aria-label="Forks">
            {forksText}
          </p>
          <p role="status" aria-label="Save status">
            {saveStatus}
          </p>
          <p role="status" aria-label="Export status">
            {exportStatus}
          </p>
        </div>
        <div role="radiogroup" aria-label="Layout" className="layout-choice">
          {LAYOUTS.map(([value, label]) => (
            <label key={value} className="choice">
              <input type="radio" name="layout" checked={prefs.layout === value} onChange={() => setPrefs({ layout: value })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
      {conflict !== null && (
        <div role="alert" className="panel conflict">
          <p>{conflict.message}</p>
          <div className="panel-actions">
            <button ref={keep} type="button" className="button primary" onClick={() => void save()}>
              Keep mine as next version
            </button>
            <button type="button" className="button" onClick={() => void loadLatest()}>
              Load latest
            </button>
          </div>
        </div>
      )}
      {draft !== null && (
        <section aria-label="Unsaved draft" className="panel">
          <p>{`You have unsaved edits from ${formatClock(draft.savedAt)}.`}</p>
          <div className="panel-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => {
                edit({ files: draft.files, libraries: draft.libraries });
                closeDraft();
              }}
            >
              Restore draft
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                localStorage.removeItem(draftKey(pen.id));
                closeDraft();
              }}
            >
              Discard draft
            </button>
          </div>
        </section>
      )}
    </div>
  );

  const stage = (
    <div className="stage-cell" ref={stageCell}>
      <PreviewRegion
        ref={preview}
        initial={{ kind: "files", files: start.files, libraries: start.libraries }}
        onStart={() => setConsole(EMPTY_CONSOLE)}
        onMessage={(message) => setConsole((current) => pushEntry(current, message))}
      />
    </div>
  );

  const pane = (key: PaneKey): React.JSX.Element => (
    <section
      className="pane"
      aria-labelledby={`heading-${key}`}
      ref={(element) => {
        sections.current[key] = element;
      }}
    >
      <h2 id={`heading-${key}`}>{PANE_LABEL[key]}</h2>
      <CodePane ref={key === "html" ? htmlField : undefined} label={PANE_LABEL[key]} value={working.files[key]} onChange={(value) => setPane(key, value)} />
    </section>
  );

  const consoleBand = (
    <ConsoleBand
      state={console_}
      open={phone || consoleOpen}
      showToggle={!phone}
      onToggle={() => setConsoleOpen((open) => !open)}
      onClear={() => setConsole(EMPTY_CONSOLE)}
    />
  );

  const walkTabs = (event: KeyboardEvent<HTMLButtonElement>, here: number): void => {
    const target: Record<string, number> = {
      ArrowRight: (here + 1) % PHONE_TABS.length,
      ArrowLeft: (here - 1 + PHONE_TABS.length) % PHONE_TABS.length,
      Home: 0,
      End: PHONE_TABS.length - 1,
    };
    const next = target[event.key];
    if (next === undefined) return;
    event.preventDefault();
    phoneTabs.current[PHONE_TABS[next] as PhoneTab]?.focus();
  };

  const panel = (name: PhoneTab, content: React.JSX.Element): React.JSX.Element => (
    <div key={name} role="tabpanel" id={`panel-${name}`} aria-labelledby={`tab-${name}`} hidden={tab !== name} inert={tab !== name} className="phone-panel" data-panel={name}>
      {content}
    </div>
  );

  return (
    <Shell>
      <div ref={editor} className="editor" data-layout={prefs.layout} data-band={band} data-console={consoleOpen ? "open" : "closed"} style={vars} data-dirty={dirty}>
        <div className="editor-head">{toolbar}</div>
        {phone ? (
          <div className="phone">
            <div role="tablist" aria-label="Panes" className="phone-tabs">
              {PHONE_TABS.map((name, index) => (
                <button
                  key={name}
                  ref={(element) => {
                    phoneTabs.current[name] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${name}`}
                  aria-selected={tab === name}
                  aria-controls={`panel-${name}`}
                  tabIndex={tab === name ? 0 : -1}
                  onClick={() => setTab(name)}
                  onKeyDown={(event) => walkTabs(event, index)}
                >
                  {PHONE_LABEL[name]}
                  {name === "console" && (
                    <span className="badge tabular" aria-hidden="true">
                      {console_.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {panel("html", pane("html"))}
            {panel("css", pane("css"))}
            {panel("js", pane("js"))}
            {panel("result", stage)}
            {panel("console", consoleBand)}
          </div>
        ) : (
          <>
            {stage}
            <Separator
              name="Resize preview and code"
              orientation={sideBySide ? "vertical" : "horizontal"}
              value={prefs.stage}
              onChange={(value) => setPrefs({ stage: value })}
              measure={measureStage}
            />
            <div className="panes" ref={panesGroup}>
              {pane("html")}
              <Separator
                name="Resize HTML and CSS"
                orientation={sideBySide ? "horizontal" : "vertical"}
                value={prefs.htmlCss}
                onChange={(value) => setPrefs({ htmlCss: value })}
                measure={measurePair("html", "css")}
              />
              {pane("css")}
              <Separator
                name="Resize CSS and JS"
                orientation={sideBySide ? "horizontal" : "vertical"}
                value={prefs.cssJs}
                onChange={(value) => setPrefs({ cssJs: value })}
                measure={measurePair("css", "js")}
              />
              {pane("js")}
            </div>
            {consoleBand}
          </>
        )}
      </div>
      {isOwner && (
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          pen={pen}
          libraries={working.libraries}
          onPen={(next) => setPen((current) => ({ ...current, ...next, version: current.version }))}
          onAddLibrary={(libraryId) => {
            if (!workingRef.current.libraries.includes(libraryId)) edit({ ...workingRef.current, libraries: [...workingRef.current.libraries, libraryId] });
          }}
          onRemoveLibrary={(libraryId) => edit({ ...workingRef.current, libraries: workingRef.current.libraries.filter((other) => other !== libraryId) })}
        />
      )}
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} pen={pen} />
    </Shell>
  );
}
