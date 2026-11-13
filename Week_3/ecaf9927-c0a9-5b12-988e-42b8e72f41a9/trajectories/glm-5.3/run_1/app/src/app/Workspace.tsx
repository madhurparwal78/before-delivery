import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Assembly,
  Member,
  Part,
  Plane,
  PurchasedPart,
  WorkspaceInfo
} from "../shared/types.js";
import { api, ApiError, KeyStore } from "./api.js";
import { FeatureTree } from "./FeatureTree.js";
import { AssemblyScreen } from "./AssemblyScreen.js";
import { PartScreen } from "./PartScreen.js";
import { SketchScreen } from "./SketchScreen.js";
import { useReducedMotion } from "./motion.js";
import { bodyStatusChip } from "./copy.js";

/** The workspace shell: mode state, feature tree, properties, alerts. */

export type Mode =
  | { kind: "assembly"; assemblyId: string; tab: "model" | "bom" }
  | { kind: "part"; partId: string; editingFeatureId: string | null }
  | { kind: "sketch"; partId: string; sketchId: string };

export interface SaveFeedback {
  status: "idle" | "saving" | "stored" | "not_stored" | "no_body";
}

export interface WorkspaceState {
  member: Member;
  workspace: WorkspaceInfo | null;
  parts: Part[];
  assemblies: Assembly[];
  purchased: PurchasedPart[];
  materials: { id: string; name: string; density_g_cm3: number }[];
}

export function WorkspaceShell(props: { member: Member; onSignedOut: () => void }): JSX.Element {
  const [member, setMember] = useState<Member>(props.member);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [purchased, setPurchased] = useState<PurchasedPart[]>([]);
  const [materials, setMaterials] = useState<{ id: string; name: string; density_g_cm3: number }[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>({ status: "idle" });
  const [modelMessage, setModelMessage] = useState<{ text: string; key: number } | null>(null);
  const [storageOutage, setStorageOutage] = useState(false);
  const [saveConflict, setSaveConflict] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [sheet, setSheet] = useState<"feature-tree" | "properties" | null>(null);
  const keys = useRef(new KeyStore());
  const reducedMotion = useReducedMotion();

  const founder = member.role === "founder";

  const sayModel = useCallback((text: string) => {
    setModelMessage({ text, key: Date.now() });
  }, []);

  // ---- Initial load: the product assembly opens first. ----
  useEffect(() => {
    void (async () => {
      const [ws, p, a, pu, m] = await Promise.all([
        api.workspace(),
        api.parts(),
        api.assemblies(),
        api.purchased(),
        api.materials()
      ]);
      setWorkspace(ws);
      setParts(p.parts);
      setAssemblies(a.assemblies);
      setPurchased(pu.purchased);
      setMaterials(m.materials);
      setMode({ kind: "assembly", assemblyId: ws.product.assembly_id, tab: "model" });
      refreshStatus();
    })();
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const reply = await api.status();
      setStorageOutage(reply.storage === "unreachable");
    } catch {
      setStorageOutage(true);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refreshStatus(), 10000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const refreshLists = useCallback(async () => {
    const [p, a, pu] = await Promise.all([api.parts(), api.assemblies(), api.purchased()]);
    setParts(p.parts);
    setAssemblies(a.assemblies);
    setPurchased(pu.purchased);
  }, []);

  const openItem = useCallback(
    (item: { kind: "assembly" | "part" | "sketch" | "feature"; id: string; partId?: string }) => {
      setSheet(null);
      if (item.kind === "assembly") setMode({ kind: "assembly", assemblyId: item.id, tab: "model" });
      if (item.kind === "part") setMode({ kind: "part", partId: item.id, editingFeatureId: null });
      if (item.kind === "sketch" && item.partId)
        setMode({ kind: "sketch", partId: item.partId, sketchId: item.id });
      if (item.kind === "feature" && item.partId) {
        setMode({ kind: "part", partId: item.partId, editingFeatureId: item.id });
      }
    },
    []
  );

  // ---- Error handling: refusals, conflicts, field errors, outages. ----
  const handleError = useCallback(
    (err: unknown): void => {
      if (err instanceof ApiError) {
        if (err.status === 412) {
          setSaveConflict(err.message);
          setSaveFeedback({ status: "idle" });
          return;
        }
        if (err.status === 503) {
          setStorageOutage(true);
          setSaveFeedback({ status: "not_stored" });
          sayModel(err.message);
          return;
        }
        sayModel(err.message);
      } else {
        sayModel("No answer from the server. Your change was not confirmed.");
      }
    },
    [sayModel]
  );

  const reload = useCallback(async () => {
    setSaveConflict(null);
    void refreshLists();
    if (mode?.kind === "assembly") {
      const reply = await api.assembly(mode.assemblyId);
      setAssemblies((prev) => prev.map((a) => (a.id === reply.assembly.id ? reply.assembly : a)));
    } else if (mode?.kind === "part") {
      const reply = await api.part(mode.partId);
      setParts((prev) => prev.map((p) => (p.id === reply.part.id ? reply.part : p)));
    }
  }, [mode, refreshLists]);

  const updatePartInLists = useCallback((part: Part) => {
    setParts((prev) => prev.map((p) => (p.id === part.id ? part : p)));
  }, []);

  const patchMember = useCallback(async (body: { units?: "mm" | "in"; precision?: number }) => {
    const reply = await api.patchMe(body);
    setMember(reply.member);
  }, []);

  // ---- Screens ----
  const screen = useMemo(() => {
    if (!mode) return null;
    if (mode.kind === "assembly") {
      return (
        <AssemblyScreen
          key={mode.assemblyId}
          member={member}
          founder={founder}
          mode={mode}
          setMode={setMode}
          assemblies={assemblies}
          parts={parts}
          purchased={purchased}
          sayModel={sayModel}
          handleError={handleError}
          refreshLists={refreshLists}
          keys={keys.current}
          storageOutage={storageOutage}
          afterPartChange={() => void refreshStatus()}
          setDialog={setDialog}
          propertiesSheet={sheet === "properties"}
          closeSheet={() => setSheet(null)}
        />
      );
    }
    if (mode.kind === "part") {
      const part = parts.find((p) => p.id === mode.partId) ?? null;
      return (
        <PartScreen
          key={mode.partId}
          member={member}
          founder={founder}
          part={part}
          mode={mode}
          setMode={setMode}
          materials={materials}
          storageOutage={storageOutage}
          sayModel={sayModel}
          handleError={handleError}
          saveFeedback={saveFeedback}
          setSaveFeedback={setSaveFeedback}
          updatePartInLists={updatePartInLists}
          refreshLists={refreshLists}
          keys={keys.current}
          afterPartChange={() => void refreshStatus()}
          setDialog={setDialog}
          propertiesSheet={sheet === "properties"}
          closeSheet={() => setSheet(null)}
        />
      );
    }
    const part = parts.find((p) => p.id === mode.partId) ?? null;
    return (
      <SketchScreen
        key={mode.sketchId}
        member={member}
        founder={founder}
        part={part}
        mode={mode}
        setMode={setMode}
        sayModel={sayModel}
        handleError={handleError}
        saveFeedback={saveFeedback}
        setSaveFeedback={setSaveFeedback}
        updatePartInLists={updatePartInLists}
        refreshLists={refreshLists}
        keys={keys.current}
        reducedMotion={reducedMotion}
        afterPartChange={() => void refreshStatus()}
        propertiesSheet={sheet === "properties"}
        closeSheet={() => setSheet(null)}
      />
    );
  }, [mode, member, founder, assemblies, parts, purchased, materials, sayModel, handleError, refreshLists, saveFeedback, updatePartInLists, reducedMotion, storageOutage, sheet, setDialog]);

  const dialogNode = useMemo(() => {
    return (
      <DialogHost
        dialog={dialog}
        setDialog={setDialog}
        member={member}
        founder={founder}
        materials={materials}
        parts={parts}
        purchased={purchased}
        assemblies={assemblies}
        sayModel={sayModel}
        handleError={handleError}
        refreshLists={refreshLists}
        updatePartInLists={updatePartInLists}
        setMode={setMode}
        keys={keys.current}
        mode={mode}
      />
    );
  }, [dialog, member, founder, materials, parts, purchased, assemblies, sayModel, handleError, refreshLists, keys, mode]);

  // Sheets: Tab wraps inside the open sheet; Escape closes and returns focus.
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        const opener = sheet === "feature-tree" ? "feature-tree" : "properties";
        setSheet(null);
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent === (opener === "feature-tree" ? "Feature tree" : "Properties")
        );
        button?.focus();
        return;
      }
      if (event.key === "Tab") {
        const visible = Array.from(
          document.querySelectorAll<HTMLElement>(".workspace.sheet-open .feature-tree, .workspace.sheet-open .properties-panel")
        ).find((el) => el.offsetParent !== null);
        if (!visible) return;
        const focusables = Array.from(
          visible.querySelectorAll<HTMLElement>("button, input, select, [tabindex]:not([tabindex='-1'])")
        ).filter((el) => (el as HTMLButtonElement).offsetParent !== null);
        if (focusables.length === 0) return;
        const firstEl = focusables[0]!;
        const lastEl = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [sheet]);

  return (
    <div className={`workspace ${reducedMotion ? "" : "motion"}${sheet ? " sheet-open" : ""}`}>
      <div className="brand-corner">
        <span className="wordmark" style={{ fontSize: 16 }}>Kerfline Bench</span>
        <span>{member.name}</span>
        <button
          onClick={() => {
            void api.signOut().finally(() => props.onSignedOut());
          }}
        >
          Sign out
        </button>
      </div>

      <FeatureTree
        asSheet={sheet === "feature-tree"}
        member={member}
        founder={founder}
        parts={parts}
        assemblies={assemblies}
        purchased={purchased}
        workspace={workspace}
        openItem={openItem}
        setDialog={setDialog}
        sheet={sheet}
        onCloseSheet={() => setSheet(null)}
      />

      {screen}

      {storageOutage ? (
        <div role="alert" aria-label="Storage outage" className="alert">
          Storage is unreachable. Changes are kept, but parts are marked Not stored until a save reaches storage.
        </div>
      ) : null}

      {saveConflict ? (
        <div role="alert" aria-label="Save conflict" className="alert">
          <span>{saveConflict}</span>
          <button onClick={() => void reload()}>Reload</button>
        </div>
      ) : null}

      {modelMessage ? (
        <div
          role="status"
          aria-label="Model message"
          className="model-message"
          key={modelMessage.key}
        >
          {modelMessage.text}
        </div>
      ) : null}

      {dialogNode}

      <CommandStrip
        member={member}
        founder={founder}
        patchMember={patchMember}
        handleError={handleError}
        mode={mode}
        onOpenSheet={(which) => setSheet(which === sheet ? null : which)}
      />
    </div>
  );
}

function CommandStrip(props: {
  member: Member;
  founder: boolean;
  patchMember: (body: { units?: "mm" | "in"; precision?: number }) => Promise<void>;
  handleError: (err: unknown) => void;
  mode: Mode | null;
  onOpenSheet: (which: "feature-tree" | "properties") => void;
}): JSX.Element {
  return (
    <div className="command-strip" role="toolbar" aria-label="Command strip">
      <div id="command-strip-slot" className="group" />
      <div className="bottom-sheet-controls" style={{ display: "contents" }}>
        <button onClick={() => props.onOpenSheet("feature-tree")}>Feature tree</button>
        <button onClick={() => props.onOpenSheet("properties")}>Properties</button>
      </div>
      <div className="units-choice" role="radiogroup" aria-label="Units">
        {(["mm", "in"] as const).map((unit) => (
          <label key={unit} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <input
              type="radio"
              name="units"
              value={unit}
              checked={props.member.units === unit}
              onChange={() => void props.patchMember({ units: unit }).catch(props.handleError)}
            />
            {unit}
          </label>
        ))}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
        <span style={{ color: "var(--ink-soft)" }}>Decimals</span>
        <input
          type="number"
          className="num"
          min={0}
          max={4}
          step={1}
          value={props.member.precision}
          style={{ width: 64 }}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isInteger(value) && value >= 0 && value <= 4) {
              void props.patchMember({ precision: value }).catch(props.handleError);
            }
          }}
          aria-label="Decimals"
          role="spinbutton"
        />
      </label>
    </div>
  );
}

// ---- Dialogs ----

export type DialogState =
  | null
  | { kind: "new-part" }
  | { kind: "new-assembly" }
  | { kind: "new-purchased" }
  | { kind: "new-sketch"; partId: string }
  | { kind: "add-to-assembly"; assembly: Assembly };

function DialogHost(props: {
  dialog: DialogState;
  setDialog: (dialog: DialogState) => void;
  member: Member;
  founder: boolean;
  materials: { id: string; name: string; density_g_cm3: number }[];
  parts: Part[];
  purchased: PurchasedPart[];
  assemblies: Assembly[];
  sayModel: (text: string) => void;
  handleError: (err: unknown) => void;
  refreshLists: () => Promise<void>;
  updatePartInLists: (part: Part) => void;
  setMode: (mode: Mode) => void;
  keys: KeyStore;
  mode: Mode | null;
}): JSX.Element | null {
  const { dialog, setDialog } = props;
  const close = (): void => setDialog(null);
  const [name, setName] = useState("");
  const [materialId, setMaterialId] = useState(props.materials[0]?.id ?? "");
  const [mass, setMass] = useState("");
  const [plane, setPlane] = useState<Plane>("top");
  const [offset, setOffset] = useState("0");
  const [component, setComponent] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dialog) return;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button"
    );
    first?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>("input, select, textarea, button")
        ).filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const firstEl = focusables[0]!;
        const lastEl = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [dialog]);

  if (!dialog) return null;

  const run = async (action: () => Promise<void>): Promise<void> => {
    setPending(true);
    setFieldError({});
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setFieldError(err.fields);
        const firstKey = Object.keys(err.fields)[0];
        if (firstKey && firstKey !== "component") {
          const el = dialogRef.current?.querySelector<HTMLElement>(`#${cssId(firstKey)}`);
          el?.focus();
        }
        if (err.fields.component) setFieldError({ component: err.fields.component });
      } else {
        props.handleError(err);
      }
    } finally {
      setPending(false);
    }
  };

  const titles: Record<string, string> = {
    "new-part": "New part",
    "new-assembly": "New assembly",
    "new-purchased": "New purchased part",
    "new-sketch": "New sketch",
    "add-to-assembly": "Add to assembly"
  };

  const field = (key: string, label: string, value: string | number, set: (v: string) => void, opts: { type?: string } = {}): JSX.Element => (
    <div key={key}>
      <label htmlFor={`dialog-${key}`}>{label}</label>
      <input
        id={`dialog-${key}`}
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={fieldError[key] ? "true" : undefined}
        aria-describedby={fieldError[key] ? `dialog-${key}-error` : undefined}
        {...opts}
      />
      {fieldError[key] ? (
        <div id={`dialog-${key}-error`} className="field-error">
          {fieldError[key]}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={titles[dialog.kind]}
        ref={dialogRef}
      >
        <h2>{titles[dialog.kind]}</h2>
        {dialog.kind === "new-part" ? (
          <>
            {field("name", "Name", name, setName)}
            <label htmlFor="dialog-material">Material</label>
            <select
              id="dialog-material"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              style={{ width: "100%", minHeight: 34 }}
            >
              {props.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.density_g_cm3.toFixed(2)} g/cm³
                </option>
              ))}
            </select>
            <div className="actions">
              <button onClick={close}>Cancel</button>
              <button
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    const reply = await api.createPart(name, materialId);
                    await props.refreshLists();
                    close();
                    props.sayModel(`${reply.part.name} added.`);
                  })
                }
              >
                Create part
              </button>
            </div>
          </>
        ) : null}
        {dialog.kind === "new-assembly" ? (
          <>
            {field("name", "Name", name, setName)}
            <div className="actions">
              <button onClick={close}>Cancel</button>
              <button
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await api.createAssembly(name);
                    await props.refreshLists();
                    close();
                    props.sayModel(`${name} added.`);
                  })
                }
              >
                Create assembly
              </button>
            </div>
          </>
        ) : null}
        {dialog.kind === "new-purchased" ? (
          <>
            {field("name", "Name", name, setName)}
            {field("declared_mass_g", "Declared mass (g)", mass, setMass)}
            <div className="actions">
              <button onClick={close}>Cancel</button>
              <button
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await api.createPurchased(name, Number(mass));
                    await props.refreshLists();
                    close();
                    props.sayModel(`${name} added.`);
                  })
                }
              >
                Create purchased part
              </button>
            </div>
          </>
        ) : null}
        {dialog.kind === "new-sketch" ? (
          <>
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend>Plane</legend>
              {(["top", "front", "right"] as const).map((p) => (
                <label key={p} style={{ display: "flex", gap: 6, margin: "6px 0", textTransform: "capitalize" }}>
                  <input
                    type="radio"
                    name="plane"
                    value={p}
                    checked={plane === p}
                    onChange={() => setPlane(p)}
                  />
                  {p === "top" ? "Top" : p === "front" ? "Front" : "Right"}
                </label>
              ))}
            </fieldset>
            {field("offset", "Offset", offset, setOffset)}
            <div className="actions">
              <button onClick={close}>Cancel</button>
              <button
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    const part = props.parts.find((p) => p.id === (dialog as { partId: string }).partId);
                    if (!part) return;
                    const reply = await api.createSketch(part.id, {
                      base_revision: part.revision,
                      plane,
                      offset
                    });
                    props.updatePartInLists(reply.part);
                    close();
                    props.setMode({ kind: "sketch", partId: part.id, sketchId: reply.sketch.id });
                  })
                }
              >
                Create sketch
              </button>
            </div>
          </>
        ) : null}
        {dialog.kind === "add-to-assembly" ? (
          <>
            <label htmlFor="dialog-component">Component</label>
            <select
              id="dialog-component"
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              style={{ width: "100%", minHeight: 34 }}
            >
              <option value="">—</option>
              {props.parts.map((p) => (
                <option key={p.id} value={`part:${p.id}`}>
                  {p.name}
                </option>
              ))}
              {props.purchased.map((p) => (
                <option key={p.id} value={`purchased:${p.id}`}>
                  {p.name}
                </option>
              ))}
              {props.assemblies.map((a) => (
                <option key={a.id} value={`assembly:${a.id}`}>
                  {a.name}
                </option>
              ))}
            </select>
            {fieldError.component ? <div className="field-error">{fieldError.component}</div> : null}
            <label htmlFor="dialog-quantity">Quantity</label>
            <input
              id="dialog-quantity"
              type="number"
              min={1}
              max={999}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              role="spinbutton"
            />
            <div className="actions">
              <button onClick={close}>Cancel</button>
              <button
                disabled={pending || !component}
                onClick={() =>
                  void run(async () => {
                    const assembly = (dialog as { assembly: Assembly }).assembly;
                    const [type, id] = component.split(":");
                    const key = props.keys.keyFor(`add:${assembly.id}:${component}`);
                    await api.postInstance(assembly.id, key, {
                      base_revision: assembly.revision,
                      component: { type: type ?? "part", id: id ?? "" },
                      quantity
                    });
                    await props.refreshLists();
                    close();
                    props.sayModel(
                      `${componentName(props, component)} ×${quantity} added to ${assembly.name}.`
                    );
                  })
                }
              >
                {pending ? "Adding…" : "Add"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function componentName(props: {
  parts: Part[];
  purchased: PurchasedPart[];
  assemblies: Assembly[];
}, component: string): string {
  const [type, id] = component.split(":");
  if (type === "part") return props.parts.find((p) => p.id === id)?.name ?? "";
  if (type === "purchased") return props.purchased.find((p) => p.id === id)?.name ?? "";
  return props.assemblies.find((a) => a.id === id)?.name ?? "";
}

function cssId(key: string): string {
  return `dialog-${key.replace(/[^a-z-]/gi, "-")}`;
}

export { bodyStatusChip };
