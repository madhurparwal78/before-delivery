import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { canEdit as roleCanEdit, canManage, type Role } from "../../shared/access.js";
import { CELL_WIDTH, GRID_STEP_PX, emptyLayout, syncLayout, type Colour, type Layout } from "../../shared/layout.js";
import type { LiveMessage } from "../../shared/live.js";
import { emptyModel, refText, type Model, type Ref } from "../../shared/model.js";
import { formatError, parseMortise, type LangError } from "../../shared/mortise.js";
import { HERO_SAMPLE, HERO_SAMPLE_START, type Template } from "../../shared/templates.js";
import { appendStarterEntity } from "../../shared/writeback.js";
import { api } from "../api.js";
import { pageConfig } from "../config.js";
import { copy } from "../copy.js";
import { loadMe, type Me } from "../shell.js";
import { Menu, PHONE_QUERY, Status, prefersReducedMotion, useMedia } from "../ui.js";
import { projectBackend, sampleBackend, type Backend, type LayoutPatch, type TextChange } from "./backend.js";
import { outlineItems } from "./describe.js";
import { Diagram } from "./diagram.js";
import {
  EntityDetailDialog,
  GroupDialog,
  ImportDialog,
  KeyboardDialog,
  RenameEntityDialog,
  ReplaceTextDialog,
  SaveVersionDialog,
  ShareDialog,
  VersionsDialog,
  type ImportReply,
  type RestoredProject,
} from "./dialogs.js";
import { TYPE_MS } from "./motion.js";
import { ExportPanel, TemplatesPanel } from "./panels.js";
import { EditSync, LiveChannel, type SaveState } from "./sync.js";
import { TextPane, type TextPaneHandle } from "./text-pane.js";

export interface WorkspaceProps {
  kind: "project" | "shared" | "sample";
  projectId: string | null;
  shareToken: string | null;
  name: string;
  role: Role;
  revision: number;
  text: string;
  layout: Layout;
}

type DialogState =
  | { kind: "save" }
  | { kind: "versions" }
  | { kind: "share" }
  | { kind: "import" }
  | { kind: "group"; error: Record<string, string> | null }
  | { kind: "rename"; entity: string; error: Record<string, string> | null }
  | { kind: "detail"; entity: string }
  | { kind: "keys" }
  | { kind: "replace"; template: Template }
  | null;

const ERROR_CAP = 20;
const SAVE_COPY: Record<SaveState, string> = { idle: "", saving: copy.saving, saved: copy.saved, retrying: copy.retrying };
const capital = (c: string) => c[0]!.toUpperCase() + c.slice(1);

function parse(text: string) {
  return parseMortise(text, pageConfig.limits);
}

export function Workspace(props: WorkspaceProps) {
  const sample = props.kind === "sample";
  const pane = useRef<TextPaneHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const initialText = sample && !prefersReducedMotion() ? HERO_SAMPLE_START : props.text;
  const initial = useMemo(() => parse(initialText), []);

  const [role, setRole] = useState<Role>(props.role);
  const [revoked, setRevoked] = useState(false);
  const editable = roleCanEdit(role) && !revoked;
  const [errors, setErrors] = useState<LangError[]>(initial.errors);
  const [model, setModel] = useState<Model>(initial.errors.length ? emptyModel() : initial.model);
  const modelRef = useRef(model);
  const [layout, setLayoutState] = useState<Layout>(() => (initial.errors.length ? props.layout : syncLayout(props.layout, initial.model)));
  const layoutRef = useRef(layout);
  const [selection, setSelection] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [glideToken, setGlideToken] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [presence, setPresence] = useState<{ people: { userId: string; displayName: string }[]; linkViewers: number }>({
    people: [],
    linkViewers: 0,
  });
  const [me, setMe] = useState<Me | null>(null);
  const [diagramNote, setDiagramNote] = useState("");
  const [studioNote, setStudioNote] = useState("");
  const [alert, setAlert] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [colourMenu, setColourMenu] = useState(false);
  const phone = useMedia(PHONE_QUERY);
  const [tab, setTab] = useState<"text" | "diagram">(props.kind === "shared" ? "diagram" : "text");
  const parseTimer = useRef<number>();
  const sync = useRef<EditSync | null>(null);
  // The arranger's own layout message would land before its reply and skip the glide.
  const arranging = useRef(false);
  const colourButton = useRef<HTMLButtonElement>(null);
  const demo = useRef<{ state: "waiting" | "running" | "done"; finish: () => void }>({
    state: sample && !prefersReducedMotion() ? "waiting" : "done",
    finish: () => undefined,
  });

  const setLayout = (next: Layout) => {
    layoutRef.current = next;
    setLayoutState(next);
  };
  const applyLayout = (next: Layout) => setLayout(syncLayout(next, modelRef.current));

  const runParse = (text: string) => {
    window.clearTimeout(parseTimer.current);
    const result = parse(text);
    setErrors(result.errors);
    if (result.errors.length === 0) {
      modelRef.current = result.model;
      setModel(result.model);
      setLayout(syncLayout(layoutRef.current, result.model));
      setSelection((current) => current.filter((n) => result.model.entities.some((e) => e.name === n)));
    }
  };
  const scheduleParse = () => {
    window.clearTimeout(parseTimer.current);
    parseTimer.current = window.setTimeout(() => runParse(pane.current!.getText()), pageConfig.parseDelayMs);
  };
  const showText = (text: string) => {
    pane.current!.setText(text);
    runParse(text);
  };

  const access = { getText: () => pane.current!.getText(), getLayout: () => layoutRef.current, showText };
  const backend = useRef<Backend | null>(null);

  // Saving and the live channel.
  useEffect(() => {
    void loadMe().then(setMe);
    if (sample) {
      backend.current = sampleBackend(access);
      return;
    }
    let channel: LiveChannel | null = null;
    if (props.kind === "project" && props.projectId) {
      sync.current = new EditSync(props.projectId, props.revision, props.text, pageConfig.parseDelayMs, {
        getText: () => pane.current?.getText() ?? "",
        showText,
        saveState: setSaveState,
        conflict: (by, unit) => setAlert(copy.conflict(by, unit)),
        readOnly: () => setRole("viewer"),
        lost: () => setRevoked(true),
      });
      backend.current = projectBackend(props.projectId, sync.current, access);
    }
    let sharedRevision = props.revision;
    const onMessage = (message: LiveMessage) => {
      switch (message.type) {
        case "hello":
        case "revision":
          if (sync.current) sync.current.receive(message.revision, message.text);
          else if (message.revision > sharedRevision) {
            sharedRevision = message.revision;
            showText(message.text);
          }
          if (message.type === "hello") {
            applyLayout(message.layout);
            setRole(message.access);
          }
          break;
        case "layout":
          if (!arranging.current) applyLayout(message.layout);
          break;
        case "presence":
          setPresence({ people: message.people, linkViewers: message.linkViewers });
          break;
        case "access":
          setAlert(copy.accessNotice(message.access, message.reason));
          if (message.access === "none") {
            setRevoked(true);
            sync.current?.stop();
          } else setRole(message.access);
          break;
      }
    };
    const path = props.kind === "project" ? `/api/projects/${props.projectId}/live` : `/api/shared/${props.shareToken}/live`;
    channel = new LiveChannel(path, { message: onMessage });
    return () => {
      channel?.close();
      sync.current?.stop();
    };
  }, []);

  // Ctrl+S or Cmd+S opens Save version from anywhere on the editor screen.
  useEffect(() => {
    if (props.kind !== "project") return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        if (editableRef.current) setDialog({ kind: "save" });
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  // The landing demo types the rest of the sample once, when a quarter of it is in view.
  useEffect(() => {
    if (!sample || demo.current.state !== "waiting") return;
    let cancelled = false;
    const finish = () => {
      if (demo.current.state === "done") return;
      cancelled = true;
      demo.current.state = "done";
      caret.current?.classList.remove("demo-caret-on");
      showText(HERO_SAMPLE);
    };
    demo.current.finish = finish;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const play = async () => {
      demo.current.state = "running";
      const node = caret.current;
      if (node) {
        placeCaret(HERO_SAMPLE_START);
        node.classList.add("demo-caret-on");
        await node
          .animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }], { duration: 300, iterations: 3 })
          .finished.catch(() => undefined);
      }
      let text = HERO_SAMPLE_START;
      for (const ch of HERO_SAMPLE.slice(HERO_SAMPLE_START.length)) {
        if (cancelled) return;
        text += ch;
        pane.current!.setText(text);
        placeCaret(text);
        await wait(TYPE_MS);
        if (ch === "\n") {
          runParse(text);
          await wait(300);
        }
      }
      if (cancelled) return;
      demo.current.state = "done";
      caret.current?.classList.remove("demo-caret-on");
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.25)) {
          observer.disconnect();
          void play();
        }
      },
      { threshold: [0.25] },
    );
    observer.observe(root.current!);
    return () => {
      observer.disconnect();
      cancelled = true;
    };
  }, []);

  const placeCaret = (text: string) => {
    const node = caret.current;
    const area = pane.current?.textarea();
    if (!node || !area) return;
    const lines = text.split("\n");
    const style = getComputedStyle(area);
    const lineHeight = parseFloat(style.lineHeight);
    const charWidth = parseFloat(style.fontSize) * 0.6;
    node.style.top = `${area.offsetTop + parseFloat(style.paddingTop) + (lines.length - 1) * lineHeight - area.scrollTop}px`;
    node.style.left = `${area.offsetLeft + parseFloat(style.paddingLeft) + lines[lines.length - 1]!.length * charWidth}px`;
    node.style.height = `${lineHeight}px`;
  };

  const onInput = () => {
    scheduleParse();
    sync.current?.schedule();
  };

  const interruptDemo = () => {
    if (demo.current.state === "running") demo.current.finish();
  };

  // ---------------------------------------------------------------------------
  // Diagram writes

  /** Runs a diagram write with incoming revisions held until its text is in place. */
  const held = async (work: () => Promise<void>) => {
    const release = sync.current?.hold();
    try {
      await work();
    } finally {
      release?.();
    }
  };

  const finishChange = async (change: TextChange, typed: boolean) => {
    if (typed) await pane.current!.typeIn(change.before, change.text);
    else pane.current!.setText(change.text);
    if (change.layout) setLayout(change.layout);
    runParse(change.text);
  };

  const requestLink = (from: Ref, to: Ref) =>
    held(async () => {
      const result = await backend.current!.link(from, to);
      if (!result.ok) {
        setDiagramNote(result.message);
        return;
      }
      await finishChange(result.value, true);
      setDiagramNote(copy.linked(refText(from), refText(to)));
    });

  const moveEntity = async (name: string, x: number, y: number) => {
    const current = layoutRef.current.entities[name];
    if (!current) return;
    setLayout({ ...layoutRef.current, entities: { ...layoutRef.current.entities, [name]: { ...current, x, y } } });
    setDiagramNote(copy.moved(name, x, y));
    const result = await backend.current!.layout({ entities: { [name]: { x, y } } });
    if (result.ok) applyLayout(result.value);
  };

  const groupable = selection.length > 0 && selection.every((n) => !model.groups.some((g) => g.entities.includes(n)));
  const openGroup = () => {
    if (editable && groupable) setDialog({ kind: "group", error: null });
  };
  const createGroup = (name: string, colour: Colour) =>
    held(async () => {
      const ordered = model.entities.map((e) => e.name).filter((n) => selection.includes(n));
      const result = await backend.current!.group(name, ordered, colour);
      if (!result.ok) {
        if (result.fields) setDialog({ kind: "group", error: result.fields });
        else {
          setDialog(null);
          setDiagramNote(result.message);
        }
        return;
      }
      setDialog(null);
      await finishChange(result.value, false);
      setDiagramNote(copy.grouped(ordered, name));
    });

  const ungroupTarget = (): string | null => {
    const candidates = focused ? [focused, ...selection] : selection;
    for (const name of candidates) {
      const group = model.groups.find((g) => g.entities.includes(name));
      if (group) return group.name;
    }
    return null;
  };
  const ungroup = () =>
    held(async () => {
      const name = ungroupTarget();
      if (!name) return;
      const result = await backend.current!.ungroup(name);
      if (!result.ok) {
        setDiagramNote(result.message);
        return;
      }
      await finishChange(result.value, false);
      setDiagramNote(copy.ungrouped(name));
    });

  const colourTargets = selection.length ? selection : focused ? [focused] : [];
  const setColour = async (colour: Colour) => {
    const targets = colourTargets.filter((n) => layoutRef.current.entities[n]);
    if (targets.length === 0) return;
    const patch: LayoutPatch = { entities: Object.fromEntries(targets.map((n) => [n, { color: colour }])) };
    const entities = { ...layoutRef.current.entities };
    for (const n of targets) entities[n] = { ...entities[n]!, color: colour };
    setLayout({ ...layoutRef.current, entities });
    setDiagramNote(targets.map((n) => copy.coloured(n, colour)).join(" "));
    const result = await backend.current!.layout(patch);
    if (result.ok) applyLayout(result.value);
  };

  const rename = (from: string, to: string) =>
    held(async () => {
      const result = await backend.current!.rename(from, to);
      if (!result.ok) {
        if (result.fields) setDialog({ kind: "rename", entity: from, error: result.fields });
        else {
          setDialog(null);
          setDiagramNote(result.message);
        }
        return;
      }
      setDialog(null);
      setSelection((s) => s.map((n) => (n === from ? to : n)));
      await finishChange(result.value, false);
      setDiagramNote(copy.renamed(from, to));
    });

  const arrange = async () => {
    arranging.current = true;
    const result = await backend.current!.arrange().finally(() => {
      arranging.current = false;
    });
    if (!result.ok) {
      setDiagramNote(result.message);
      return;
    }
    setGlideToken((t) => t + 1);
    applyLayout(result.value);
    setDiagramNote(copy.arranged(modelRef.current.entities.length));
  };

  const useTemplate = (template: Template) => {
    if (pane.current!.getText().trim() !== "") setDialog({ kind: "replace", template });
    else applyTemplate(template);
  };
  const applyTemplate = (template: Template) => {
    setDialog(null);
    showText(template.text);
    sync.current?.schedule();
    setStudioNote(copy.templateApplied(template.name));
  };

  const addEntity = () => {
    const text = appendStarterEntity(pane.current!.getText(), modelRef.current);
    showText(text);
    sync.current?.schedule();
  };

  const resetSample = () => {
    demo.current.finish();
    setLayout(emptyLayout());
    showText(HERO_SAMPLE);
  };

  const prepare = async () => {
    await sync.current?.flush();
    return sync.current?.revision ?? props.revision;
  };

  const onRestored = (n: number, m: number, project: RestoredProject) => {
    sync.current?.accept(project.revision, project.text);
    pane.current!.setText(project.text);
    runParse(project.text);
    setLayout(project.layout);
    setStudioNote(copy.restored(n, m));
  };

  const onImported = async (reply: ImportReply) => {
    if (!reply.changed || !props.projectId) return;
    const result = await api<{ revision: number; text: string; layout: Layout }>("GET", `/api/projects/${props.projectId}`);
    if (!result.ok) return;
    const fresh = result.data;
    sync.current?.accept(fresh.revision, fresh.text);
    pane.current!.setText(fresh.text);
    runParse(fresh.text);
    applyLayout(fresh.layout);
  };

  // ---------------------------------------------------------------------------
  // Rendering

  const firstError = errors[0];
  const visibleErrors = errors.slice(0, ERROR_CAP);
  const empty = model.entities.length === 0 && errors.length === 0;
  const tabbed = phone && !sample;
  const showTextPane = !tabbed || tab === "text";
  const showDiagram = !tabbed || tab === "diagram";
  const owner = canManage(role) && !revoked;
  const projectKind = props.kind === "project";

  const chip = (label: string, onClick: () => void, extra: Record<string, unknown> = {}) => (
    <button type="button" class="chip" onClick={onClick} {...extra}>
      {label}
    </button>
  );

  const toolbar = (
    <div role="toolbar" aria-label="Editor tools" class="toolbar">
      <div class="toolbar-chips">
        {sample && chip("Reset sample", resetSample)}
        {projectKind && owner && chip("Share", () => setDialog({ kind: "share" }))}
        {!sample && chip("Versions", () => setDialog({ kind: "versions" }))}
        {editable && projectKind && chip("Save version", () => setDialog({ kind: "save" }))}
        {editable && projectKind && chip("Import", () => setDialog({ kind: "import" }))}
        {editable && projectKind && chip("Export", () => setExportOpen(!exportOpen), { "aria-expanded": exportOpen ? "true" : "false" })}
        {editable && chip("Arrange", () => void arrange())}
        {editable && chip("Group selected", openGroup, { disabled: !groupable })}
        {editable && chip("Ungroup", () => void ungroup())}
        {editable && (
          <div class="chip-menu">
            <button
              type="button"
              class="chip"
              ref={colourButton}
              aria-haspopup="menu"
              aria-expanded={colourMenu ? "true" : "false"}
              onClick={() => setColourMenu(!colourMenu)}
            >
              Colour
            </button>
            {colourMenu && (
              <Menu
                label="Entity colour"
                radio
                className="colour-menu"
                items={(["slate", "blue", "violet", "green", "amber", "red"] as const).map((c) => ({
                  label: capital(c),
                  checked: colourTargets[0] !== undefined && layout.entities[colourTargets[0]]?.color === c,
                  onSelect: () => void setColour(c),
                }))}
                onClose={(refocus) => {
                  setColourMenu(false);
                  if (refocus) colourButton.current?.focus();
                }}
              />
            )}
          </div>
        )}
        {!editable && !sample && <span class="view-only-badge">View only</span>}
        {chip("Keyboard help", () => setDialog({ kind: "keys" }))}
      </div>
      <div class="toolbar-end">
        {!sample && (
          <ul aria-label="People here" class="presence">
            {presence.people.map((p) => (
              <li key={p.userId} class="presence-chip">
                {p.userId === me?.id ? `${p.displayName} (you)` : p.displayName}
              </li>
            ))}
            {presence.linkViewers > 0 && (
              <li class="presence-chip presence-viewers">
                {presence.linkViewers === 1 ? "1 link viewer" : `${presence.linkViewers} link viewers`}
              </li>
            )}
          </ul>
        )}
        {!sample && <Status label="Save state" text={SAVE_COPY[saveState]} className="save-state" />}
        {editable &&
          !sample &&
          chip("Templates", () => setTemplatesOpen(!templatesOpen), {
            "aria-pressed": templatesOpen ? "true" : "false",
            class: "chip chip-templates",
          })}
      </div>
    </div>
  );

  return (
    <div class={`workspace workspace-${props.kind} ${templatesOpen ? "with-templates" : ""} ${exportOpen ? "with-export" : ""}`} ref={root}>
      {toolbar}
      {!sample && <h1 class="project-title">{props.name}</h1>}
      <div class="alert-slot">
        {alert && (
          <div role="alert" class="notice-alert">
            {alert}
          </div>
        )}
      </div>
      {phone && !sample && (
        <div role="tablist" aria-label="Workspace" class="tabs">
          {(["text", "diagram"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t ? "true" : "false"}
              tabIndex={tab === t ? 0 : -1}
              class="tab"
              onClick={() => setTab(t)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const next = t === "text" ? "diagram" : "text";
                  setTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
            >
              {t === "text" ? "Text" : "Diagram"}
            </button>
          ))}
        </div>
      )}
      <div class="panes">
        {templatesOpen && editable && (
          <div class="templates-dock">
            <TemplatesPanel onUse={useTemplate} />
          </div>
        )}
        <div class="text-column" hidden={!showTextPane}>
          <TextPane
            handle={pane}
            label={sample ? "Sample schema text" : "Schema text"}
            initialText={initialText}
            readOnly={!editable}
            errors={errors}
            onInput={onInput}
            onKeyDownCapture={interruptDemo}
            onPointerDownCapture={interruptDemo}
          />
          {sample && <span class="demo-caret" ref={caret} aria-hidden="true" />}
        </div>
        <div class="diagram-column" hidden={!showDiagram}>
          <div role="status" aria-label="Diagram out of date" class={errors.length ? "stale-banner" : "visually-hidden"}>
            {errors.length ? copy.outOfDate : ""}
          </div>
          <Diagram
            label={sample ? "Sample diagram" : "Diagram"}
            model={model}
            layout={layout}
            selection={selection}
            canEdit={editable}
            glideToken={glideToken}
            onMove={(n, x, y) => void moveEntity(n, x, y)}
            onSelection={(next, note) => {
              setSelection(next);
              setDiagramNote(note);
            }}
            onLink={(from, to) => void requestLink(from, to)}
            onAnnounce={setDiagramNote}
            onDetail={(entity) => setDialog({ kind: "detail", entity })}
            onRename={(entity) => setDialog({ kind: "rename", entity, error: null })}
            onGroup={openGroup}
            onFocusEntity={setFocused}
            fitWidth={sample ? 3 * CELL_WIDTH * GRID_STEP_PX : undefined}
          >
            {empty && (
              <div class="canvas-empty">
                <span class="badge-round" aria-hidden="true">
                  +
                </span>
                <h2>No entities yet</h2>
                <p>Type an entity in the text, or pick a starter template.</p>
                <p>Everything a template adds stays editable.</p>
                {editable && (
                  <button type="button" class="button-plus" onClick={addEntity}>
                    Add an entity
                  </button>
                )}
              </div>
            )}
          </Diagram>
        </div>
        <section role="region" aria-label="Errors" class="errors" hidden={errors.length === 0 || !showTextPane}>
          {firstError && <p class="error-bar">{formatError(firstError)}</p>}
          <ul aria-label="Errors" class="error-list">
            {visibleErrors.map((error, i) => (
              <li key={i}>
                <button type="button" class="error-button" onClick={() => pane.current!.focusAt(error.line, error.column)}>
                  {formatError(error)}
                </button>
              </li>
            ))}
            {errors.length > ERROR_CAP && <li class="error-more">{copy.moreErrors(errors.length - ERROR_CAP)}</li>}
          </ul>
        </section>
        {exportOpen && editable && props.projectId && (
          <ExportPanel
            projectId={props.projectId}
            model={model}
            canEdit={editable}
            announce={setStudioNote}
            alert={setAlert}
            prepare={prepare}
          />
        )}
      </div>
      <Status label="Editor status" text={copy.editorStatus(errors.length, firstError)} />
      <Status label="Diagram announcements" text={diagramNote} />
      <Status label="Studio announcements" text={studioNote} />
      <ul aria-label="Diagram outline" class="visually-hidden">
        {outlineItems(model).map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <div class="dialog-layer">
        {dialog?.kind === "save" && props.projectId && (
          <SaveVersionDialog
            projectId={props.projectId}
            announce={setStudioNote}
            onClose={() => setDialog(null)}
            onSaved={(n) => {
              setDialog(null);
              setStudioNote(copy.versionSaved(n));
            }}
          />
        )}
        {dialog?.kind === "versions" && (
          <VersionsDialog
            base={props.kind === "project" ? `/api/projects/${props.projectId}` : `/api/shared/${props.shareToken}`}
            canEdit={editable && projectKind}
            onClose={() => setDialog(null)}
            onPending={setStudioNote}
            onRestored={onRestored}
          />
        )}
        {dialog?.kind === "share" && props.projectId && (
          <ShareDialog projectId={props.projectId} onClose={() => setDialog(null)} announce={setStudioNote} alert={setAlert} />
        )}
        {dialog?.kind === "import" && props.projectId && (
          <ImportDialog
            projectId={props.projectId}
            entityNames={model.entities.map((e) => e.name)}
            prepare={prepare}
            onClose={() => setDialog(null)}
            onImported={(reply) => void onImported(reply)}
            announce={setStudioNote}
            alert={setAlert}
          />
        )}
        {dialog?.kind === "group" && (
          <GroupDialog error={dialog.error} onClose={() => setDialog(null)} onCreate={(n, c) => void createGroup(n, c)} />
        )}
        {dialog?.kind === "rename" && (
          <RenameEntityDialog
            entity={dialog.entity}
            error={dialog.error}
            onClose={() => setDialog(null)}
            onRename={(to) => void rename(dialog.entity, to)}
          />
        )}
        {dialog?.kind === "detail" && (
          <EntityDetailDialog
            model={model}
            entity={dialog.entity}
            canEdit={editable}
            onClose={() => setDialog(null)}
            onRename={() => setDialog({ kind: "rename", entity: dialog.entity, error: null })}
          />
        )}
        {dialog?.kind === "keys" && <KeyboardDialog onClose={() => setDialog(null)} />}
        {dialog?.kind === "replace" && (
          <ReplaceTextDialog onClose={() => setDialog(null)} onReplace={() => applyTemplate(dialog.template)} />
        )}
      </div>
    </div>
  );
}
