import { useLayoutEffect, useState, type KeyboardEvent } from "react";
import { fieldAccepts, hrefProblem, MAIN_PROP } from "../../shared/apply.js";
import { fieldError } from "../../shared/notices.js";
import { cssValue, hasOverride, holdsOwn, isTokenRef, pipState, resolve, rowSource, styleValueProblem, TOKEN_KIND_FOR, valueText } from "../../shared/styles.js";
import { containsInstance, enclosingList, instanceRoot, locateOnPage } from "../../shared/tree.js";
import { BREAKPOINT_LABEL, BREAKPOINTS, FRAME_WIDTH, STYLE_KEYS, type DocNode, type StyleKey } from "../../shared/types.js";
import { Icon } from "../ui/icons.js";
import type { Reversible } from "../ui/motion.js";
import { useEditor } from "./context.js";

/** A text input that keeps the person's uncommitted typing; Enter or blur commits, Escape restores the stored value. */
export function CommitInput({ label, stored, onCommit, className = "", id }: { label: string; stored: string; onCommit: (text: string) => string | null; className?: string; id?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id ?? label.replace(/\W+/g, "-")}-error`;
  const commit = () => {
    if (draft === null) return;
    const problem = draft === stored ? null : onCommit(draft);
    setError(problem);
    if (!problem) setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape" && (draft !== null || error)) {
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      setError(null);
    }
  };
  return (
    <span className={`pl-commit ${className}${error ? " pl-invalid" : ""}`}>
      <input
        id={id}
        className="pl-input"
        aria-label={label}
        value={draft ?? stored}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        spellCheck={false}
      />
      {error && (
        <span className="pl-inline-error" id={errorId}>
          <Icon name="triangle-alert" size={12} />
          {error}
        </span>
      )}
    </span>
  );
}

function FocalSlider({ node, axis }: { node: DocNode; axis: "focalX" | "focalY" }) {
  const { act } = useEditor();
  const value = node.props[axis] ?? 50;
  const set = (next: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    if (clamped !== value) act.setProp(node.id, axis, clamped);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = event.shiftKey ? 1 : 5;
    const moves: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
    if (event.key in moves) set(value + moves[event.key]);
    else if (event.key === "Home") set(0);
    else if (event.key === "End") set(100);
    else return;
    event.preventDefault();
  };
  const label = axis === "focalX" ? "Focal point horizontal" : "Focal point vertical";
  return (
    <label className="pl-prop">
      <span>{axis === "focalX" ? "Focal X" : "Focal Y"}</span>
      <input type="range" min={0} max={100} step={1} value={value} aria-label={label} onKeyDown={onKeyDown} onChange={(e) => set(Number(e.target.value))} />
      <span className="pl-mono">{value}%</span>
    </label>
  );
}

function ContentControls({ node }: { node: DocNode }) {
  const { state, act } = useEditor();
  const found = locateOnPage(state.doc, node.id);
  if (!found) return null;
  const list = enclosingList(found);
  const mainProp = MAIN_PROP[node.type];
  const fields = state.doc.collection.fields.filter((f) => fieldAccepts(node.type, f.kind));
  const canShare = !!found.parent && !instanceRoot(found) && !containsInstance(node);
  return (
    <section className="pl-content" aria-label="Content">
      {(node.type === "heading" || node.type === "text" || node.type === "button") && (
        <label className="pl-prop">
          <span>Text</span>
          <CommitInput
            label="Text"
            stored={node.props.text ?? ""}
            onCommit={(text) => (text.length > 2000 ? "Text is at most 2,000 characters." : (act.setProp(node.id, "text", text), null))}
          />
        </label>
      )}
      {node.type === "heading" && (
        <label className="pl-prop">
          <span>Level</span>
          <select className="pl-select" aria-label="Heading level" value={node.props.level ?? 1} onChange={(e) => act.setProp(node.id, "level", Number(e.target.value))}>
            {[1, 2, 3].map((l) => (
              <option key={l} value={l}>{`Level ${l}`}</option>
            ))}
          </select>
        </label>
      )}
      {node.type === "button" && (
        <label className="pl-prop">
          <span>Link</span>
          <CommitInput label="Link" stored={node.props.href ?? ""} onCommit={(href) => hrefProblem(href) ?? (act.setProp(node.id, "href", href), null)} />
        </label>
      )}
      {node.type === "image" && (
        <>
          <label className="pl-prop">
            <span>Alt</span>
            <CommitInput label="Alt text" stored={node.props.alt ?? ""} onCommit={(alt) => (alt.trim() ? (act.setProp(node.id, "alt", alt), null) : fieldError.altEmpty)} />
          </label>
          <FocalSlider node={node} axis="focalX" />
          <FocalSlider node={node} axis="focalY" />
        </>
      )}
      {list && mainProp && (
        <label className="pl-prop">
          <span>Field</span>
          <select className="pl-select" aria-label="Bind to field" value={node.bind?.[mainProp] ?? ""} onChange={(e) => act.bind(node.id, mainProp, e.target.value || null)}>
            <option value="">Not bound</option>
            {fields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="pl-content-actions">
        {canShare && (
          <button type="button" className="pl-button" onClick={() => act.openDialog({ kind: "component", nodeId: node.id, name: node.name })}>
            <Icon name="layers" />
            Create shared component
          </button>
        )}
        {node.shared && (
          <button type="button" className="pl-button" onClick={() => act.detach(node.id)}>
            <Icon name="unlink" />
            Detach instance
          </button>
        )}
      </div>
    </section>
  );
}

function StyleRow({ node, styleKey }: { node: DocNode; styleKey: StyleKey }) {
  const { state, act } = useEditor();
  const { bp, doc, readOnly } = state;
  const source = rowSource(node.styles, bp, styleKey);
  const found = resolve(node.styles, bp, styleKey);
  const shownText = found ? (cssValue(found.value, doc.tokens) ?? valueText(found.value)) : "";
  const kind = TOKEN_KIND_FOR[styleKey];
  const tokens = kind ? doc.tokens.filter((t) => t.kind === kind) : [];
  const tokenName = found && isTokenRef(found.value) ? found.value.token : "";
  const overridden = hasOverride(node.styles, bp, styleKey);
  const fanOpen = state.fan !== "closed";
  const commit = (text: string) => {
    const value = text.trim();
    if (!value) {
      if (holdsOwn(node.styles, bp, styleKey)) act.clearStyle(node.id, styleKey);
      return null;
    }
    const problem = styleValueProblem(styleKey, value, doc.tokens);
    if (problem) return problem;
    act.setStyle(node.id, styleKey, value);
    return null;
  };
  return (
    <div role="group" aria-label={styleKey} data-source={source} className={`pl-style-row pl-source-${source}`}>
      <span className="pl-style-label">
        <span className={`pl-override-dot${overridden ? " pl-on" : ""}`} aria-hidden="true" />
        <span className="pl-mono">{styleKey}</span>
      </span>
      {readOnly ? (
        <span className="pl-mono pl-style-static">{found ? valueText(found.value) : "—"}</span>
      ) : (
        <CommitInput label={`${styleKey} value`} stored={shownText} onCommit={commit} className="pl-style-value" />
      )}
      {kind && !readOnly && (
        <select
          className="pl-select pl-token-select"
          aria-label={`${styleKey} token`}
          value={tokenName}
          onChange={(e) => {
            if (e.target.value) act.setStyle(node.id, styleKey, { token: e.target.value });
            else if (found && isTokenRef(found.value)) {
              const literal = cssValue(found.value, doc.tokens);
              if (literal) act.setStyle(node.id, styleKey, literal);
            }
          }}
        >
          <option value="">No token</option>
          {tokens.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {overridden && !readOnly && (
        <button type="button" className="pl-icon-button" aria-label={`Clear ${styleKey} override`} title="Clear override" onClick={() => act.clearStyle(node.id, styleKey)}>
          <Icon name="x" size={14} />
        </button>
      )}
      {fanOpen && (
        <span className="pl-pips">
          {BREAKPOINTS.map((b) => {
            const st = pipState(node.styles, b, styleKey);
            const r = resolve(node.styles, b, styleKey);
            const label = st === "unset" ? `${BREAKPOINT_LABEL[b]}: unset` : `${BREAKPOINT_LABEL[b]}: ${st}, ${valueText(r?.value)}`;
            return (
              <span key={b} data-pip={b} role="img" aria-label={label} data-state={st} className={`pl-pip pl-pip-${st}`} title={label}>
                {BREAKPOINT_LABEL[b][0]}
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
}

export function StylePanel({ motion }: { motion: Reversible }) {
  const { state } = useEditor();
  useLayoutEffect(() => {
    const element = document.getElementById("style-panel");
    element?.setAttribute("data-motion", motion.state);
    element?.setAttribute("data-progress", motion.progress.toFixed(2));
  }, [motion]);
  const found = state.selectedId ? locateOnPage(state.doc, state.selectedId) : null;
  const node = found?.owner.page.id === state.page.id ? found.node : null;
  return (
    <aside id="style-panel" aria-label="Style" className="pl-style" inert={!state.stylePanelOpen}>
      <div className="pl-style-inner">
        <div className="pl-panel-head">
          <h2 className="pl-panel-title">Style</h2>
          <span className="pl-mono pl-muted">
            {BREAKPOINT_LABEL[state.bp]} {FRAME_WIDTH[state.bp]}
          </span>
        </div>
        {node ? (
          <>
            <p className="pl-selected-name">
              <span>{node.name}</span> <span className="pl-mono pl-muted">{node.type}</span>
            </p>
            {!state.readOnly && <ContentControls node={node} />}
            <section className="pl-style-rows" aria-label="Style properties">
              {STYLE_KEYS.map((key) => (
                <StyleRow key={key} node={node} styleKey={key} />
              ))}
            </section>
          </>
        ) : (
          <p className="pl-panel-empty">Select an element on the canvas or in the Navigator to style it.</p>
        )}
      </div>
    </aside>
  );
}
