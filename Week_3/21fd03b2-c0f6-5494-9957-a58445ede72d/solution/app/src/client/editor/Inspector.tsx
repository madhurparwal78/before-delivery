import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { SceneObject } from "../../shared/doc";
import { GRAVITY_DEF, MATERIALS, formatSi, paramDefs, type ParamDef } from "../../shared/params";
import { readoutsFor, type Effective } from "../../shared/readouts";
import type { EditorState, EditorStore } from "./store";

const POSITION_DEF = (axis: string): ParamDef => ({ key: `position.${axis}`, label: `Position ${axis.toUpperCase()} (m)`, min: -500, max: 500, default: 0, step: 0.1, group: "length", unit: "m" });
const AXES = ["x", "y", "z"] as const;

interface FieldProps {
  store: EditorStore;
  draftKey: string;
  def: ParamDef;
  value: number;
  editable: boolean;
  apply: (value: number) => void;
}

/** A parameter entry: shows the SI value on blur, parses units on every keystroke, keeps typed text through remote updates. */
function ParamField({ store, draftKey, def, value, editable, apply }: FieldProps): JSX.Element {
  const state = store.getSnapshot();
  const draft = state.drafts[draftKey];
  const id = useId();
  const shown = draft ? draft.text : formatSi(value);
  const error = draft?.error ?? null;
  const type = (text: string): void => store.typeInto(draftKey, text, def, apply);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      store.settleDraft(draftKey, apply);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (!editable) return;
      const base = draft && draft.value !== null ? draft.value : value;
      const next = Math.min(def.max, Math.max(def.min, Math.round((base + (event.key === "ArrowUp" ? def.step : -def.step)) * 1e6) / 1e6));
      store.discardDraft(draftKey);
      apply(next);
    }
  };
  return (
    <div className="field compact">
      <label htmlFor={id}>{def.label}</label>
      <input
        id={id}
        type="text"
        role="spinbutton"
        inputMode="decimal"
        autoComplete="off"
        className="num"
        value={shown}
        readOnly={!editable}
        aria-readonly={!editable}
        aria-valuenow={draft?.value ?? value}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => type(event.target.value)}
        onBlur={() => store.settleDraft(draftKey, apply)}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function effectiveParams(object: SceneObject, drafts: EditorState["drafts"]): Effective {
  const out: Effective = {};
  for (const def of paramDefs(object.kind)) {
    const draft = drafts[`${object.id}.params.${def.key}`];
    out[def.key] = draft ? (draft.error === null ? draft.value : null) : object.params[def.key];
  }
  return out;
}

function MaterialPopover({ store, object, anchor, onClose }: { store: EditorStore; object: SceneObject; anchor: HTMLElement; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight - 4 ? Math.max(4, rect.top - height - 4) : below;
    setPosition({ left: Math.max(4, Math.min(rect.left, window.innerWidth - 200)), top });
    const options = ref.current?.querySelectorAll<HTMLElement>('[role="radio"]');
    const checked = [...(options ?? [])].find((o) => o.getAttribute("aria-checked") === "true");
    (checked ?? options?.[0])?.focus();
  }, [anchor]);
  const close = (): void => {
    onClose();
    anchor.focus();
  };
  const choose = (friction: number): void => {
    store.setParam(object.id, "friction", friction);
    close();
  };
  const onKeyDown = (event: ReactKeyboardEvent): void => {
    const options = [...(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      options[(at + 1) % options.length]?.focus();
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      options[(at - 1 + options.length) % options.length]?.focus();
    } else if (event.key === "Tab") event.preventDefault();
  };
  return createPortal(
    <div ref={ref} className="popover" role="dialog" aria-label="Material" style={position} onKeyDown={onKeyDown}>
      <div role="radiogroup" aria-label="Surface">
        {MATERIALS.map((m) => (
          <button key={m.name} type="button" role="radio" aria-checked={object.params.friction === m.friction} className="menu-item" tabIndex={-1} onClick={() => choose(m.friction)}>
            {m.name}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function InspectorBody({ store, state }: { store: EditorStore; state: EditorState }): JSX.Element {
  const object = state.selection ? state.doc.objects.find((o) => o.id === state.selection) : undefined;
  const sceneEditable = store.editing;
  const editable = store.fieldsEditable(state.selection);
  const notice = store.lockNoticeText();
  const [material, setMaterial] = useState(false);
  const materialButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editable) setMaterial(false);
  }, [editable]);
  const readOnlyView = state.role === "viewer" || state.demoted;
  const gravityDraft = state.drafts["scene.gravity"];
  const gravity = gravityDraft ? (gravityDraft.error === null ? gravityDraft.value : null) : state.doc.gravity;

  if (!object) {
    return readOnlyView ? (
      <div className="values">
        <div>Scene name: {state.doc.name}</div>
        <div>{GRAVITY_DEF.label}: {state.doc.gravity}</div>
      </div>
    ) : (
      <div className="fields">
        <div className="field compact">
          <label htmlFor="scene-name-field">Scene name</label>
          <input id="scene-name-field" type="text" key={state.doc.name} defaultValue={state.doc.name} readOnly={!sceneEditable} onBlur={(e) => store.setSceneName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        </div>
        <ParamField store={store} draftKey="scene.gravity" def={GRAVITY_DEF} value={state.doc.gravity} editable={sceneEditable} apply={(v) => store.setGravity(v)} />
      </div>
    );
  }
  const defs = paramDefs(object.kind);
  const rows = object.kind === "model" ? [] : readoutsFor(object.kind, effectiveParams(object, state.drafts), gravity);
  return (
    <div className="fields">
      {notice ? (
        <div role="status" aria-label="Lock notice" className="lock-notice">
          {notice}
        </div>
      ) : (
        <div role="status" aria-label="Lock notice" className="lock-notice empty" />
      )}
      {readOnlyView ? (
        <div className="values">
          {AXES.map((axis, i) => (
            <div key={axis}>
              {POSITION_DEF(axis).label}: {object.position[i]}
            </div>
          ))}
          {defs.map((def) => (
            <div key={def.key}>
              {def.label}: {object.params[def.key]}
            </div>
          ))}
        </div>
      ) : (
        <>
          {AXES.map((axis, i) => (
            <ParamField key={axis} store={store} draftKey={`${object.id}.position.${axis}`} def={POSITION_DEF(axis)} value={object.position[i]} editable={editable} apply={(v) => store.setPositionAxis(object.id, i, v)} />
          ))}
          {defs.map((def) => (
            <ParamField key={def.key} store={store} draftKey={`${object.id}.params.${def.key}`} def={def} value={object.params[def.key]} editable={editable} apply={(v) => store.setParam(object.id, def.key, v)} />
          ))}
          {object.kind === "ramp" ? (
            <>
              <button ref={materialButton} type="button" className="chip" disabled={!editable} aria-haspopup="dialog" aria-expanded={material} onClick={() => setMaterial((m) => !m)}>
                Material
              </button>
              {material && materialButton.current ? <MaterialPopover store={store} object={object} anchor={materialButton.current} onClose={() => setMaterial(false)} /> : null}
            </>
          ) : null}
        </>
      )}
      {object.kind !== "model" && object.kind !== "crate" ? (
        <div role="region" aria-label="Derived readouts" aria-live="polite" className="readouts">
          {rows.map((row) => (
            <div key={row.label}>
              {row.label}: {row.value}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

