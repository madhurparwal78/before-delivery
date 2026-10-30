// The product hierarchy rail: product › component › feature › subfeature, with monospaced counters that
// count to new values and rows that slide to their new rank (components follow their best-ranked feature) (medium tempo, none under reduced motion).
import { ChevronDown, ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Hierarchy } from "../../shared/api.js";
import { countTo, MEDIUM, prefersReducedMotion, SETTLE } from "../motion.js";

/** A numeral whose text the component owns, so it can count from its old value to the new one. */
function Num({ value, label }: { value: number; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    shown.current = value;
    if (from === null) el.textContent = String(value);
    else void countTo(el, from, value);
  }, [value]);
  return <span className="num"><span className="num-label">{label}</span> <span ref={ref} /></span>;
}

interface Props {
  hierarchy: Hierarchy | null;
  collapsed: boolean;
  onToggle: () => void;
  linked: ReadonlySet<string>;
}

export function HierarchyRail({ hierarchy, collapsed, onToggle, linked }: Props) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const tree = useRef<HTMLUListElement>(null);
  const tops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const root = tree.current;
    if (!root) return;
    const next = new Map<string, number>();
    for (const row of root.querySelectorAll<HTMLElement>("[data-flip]")) {
      const id = row.dataset.flip ?? "";
      const top = row.getBoundingClientRect().top;
      const before = tops.current.get(id);
      if (before !== undefined && Math.abs(before - top) > 1 && !prefersReducedMotion()) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], { duration: MEDIUM, easing: SETTLE });
      }
      next.set(id, top);
    }
    tops.current = next;
  }, [hierarchy, closed]);

  const toggle = (id: string): void => setClosed((c) => {
    const n = new Set(c);
    if (!n.delete(id)) n.add(id);
    return n;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const items = Array.from(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []).filter((el) => el.offsetParent !== null);
    const current = items.findIndex((el) => el === document.activeElement);
    const move = (to: number): void => {
      const target = items[Math.max(0, Math.min(items.length - 1, to))];
      items.forEach((el) => { el.tabIndex = -1; });
      if (target) {
        target.tabIndex = 0;
        target.focus();
      }
    };
    if (event.key === "ArrowDown") { event.preventDefault(); move(current + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(current - 1); }
    else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && current >= 0) {
      const item = items[current];
      const id = item?.dataset.branch;
      if (id && (event.key === "ArrowLeft") === !closed.has(id)) { event.preventDefault(); toggle(id); }
    }
  };

  let first = true;
  const tabStop = (): number => {
    const stop = first ? 0 : -1;
    first = false;
    return stop;
  };

  return (
    <aside aria-label="Product hierarchy" className={`rail ${collapsed ? "rail-collapsed" : ""}`}>
      <div className="rail-head">
        {!collapsed && <h3 className="rail-title">Hierarchy</h3>}
        <button type="button" className="icon-button tooltip" onClick={onToggle} aria-label={collapsed ? "Expand hierarchy" : "Collapse hierarchy"}
          data-tip={collapsed ? "Expand hierarchy" : "Collapse hierarchy"}>
          {collapsed ? <PanelRightOpen aria-hidden="true" size={18} /> : <PanelRightClose aria-hidden="true" size={18} />}
        </button>
      </div>
      {!collapsed && <p className="rail-legend">Ins insights · Co companies · Imp impact</p>}
      <ul ref={tree} role="tree" aria-label="Product hierarchy" className="tree" hidden={collapsed} onKeyDown={onKeyDown}>
        {hierarchy?.products.map((product, p) => (
          <Fragment key={product.id}>
            <li role="treeitem" aria-level={1} aria-setsize={hierarchy.products.length} aria-posinset={p + 1} aria-expanded={!closed.has(product.id)}
              data-branch={product.id} data-flip={product.id} tabIndex={tabStop()} className="tree-label tree-label-product" onClick={() => toggle(product.id)}>
              {closed.has(product.id) ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
              {product.name}
            </li>
            {!closed.has(product.id) && product.components.map((component, c) => (
              <Fragment key={component.id}>
                <li role="treeitem" aria-level={2} aria-setsize={product.components.length} aria-posinset={c + 1} aria-expanded={!closed.has(component.id)}
                  data-branch={component.id} data-flip={component.id} tabIndex={-1} className="tree-label tree-label-component" onClick={() => toggle(component.id)}>
                  {closed.has(component.id) ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
                  {component.name}
                </li>
                {!closed.has(component.id) && component.features.length === 0 && <li role="none" className="tree-empty">No features yet.</li>}
                {!closed.has(component.id) && component.features.map((feature, f) => (
                  <Fragment key={feature.id}>
                    <li role="treeitem" aria-level={3} aria-setsize={component.features.length} aria-posinset={f + 1}
                      aria-describedby={`row-figures-${feature.id}`} data-feature-row={feature.id} data-flip={feature.id} tabIndex={-1} className="tree-feature">
                      <div className="feature-row">
                        <span className="feature-row-name">{feature.name}</span>
                        {linked.has(feature.id) && <span aria-hidden="true" className="badge badge-linked">Linked</span>}
                        <span id={`row-figures-${feature.id}`} aria-hidden="true" className="feature-row-figures">
                          <Num value={feature.insightCount} label="Ins" />
                          <Num value={feature.companyCount} label="Co" />
                          <Num value={feature.impact} label="Imp" />
                          <Num value={feature.rank ?? 0} label="Rank" />
                        </span>
                      </div>
                    </li>
                    {feature.subfeatures.map((sub, i) => (
                      <li key={sub.id} role="treeitem" aria-level={4} aria-setsize={feature.subfeatures.length} aria-posinset={i + 1}
                        data-flip={sub.id} tabIndex={-1} className="tree-subfeature">{sub.name}</li>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </Fragment>
        ))}
      </ul>
    </aside>
  );
}
