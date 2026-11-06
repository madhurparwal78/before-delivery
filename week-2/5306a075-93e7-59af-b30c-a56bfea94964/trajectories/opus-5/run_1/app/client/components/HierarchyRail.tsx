import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { HierarchyResponse } from '../../shared/types';
import { usePrefersReducedMotion } from '../app-state';
import { COUNT_MS } from '../motion';

function AnimatedNumber({
  value,
  reduced,
  label,
}: {
  value: number;
  reduced: boolean;
  label: string;
}): JSX.Element {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    if (reduced || previous.current === value) {
      previous.current = value;
      setShown(value);
      return;
    }
    const from = previous.current;
    previous.current = value;
    const start = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / COUNT_MS);
      setShown(Math.round(from + (value - from) * progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  return (
    <span className="figure" title={label}>
      {shown}
    </span>
  );
}

export interface RailProps {
  hierarchy: HierarchyResponse | null;
  linkedFeatureId: string | null;
  registerRow: (featureId: string, element: HTMLElement | null) => void;
  onDropFeature: (featureId: string) => void;
  dragging: boolean;
}

export function HierarchyRail({
  hierarchy,
  linkedFeatureId,
  registerRow,
  onDropFeature,
  dragging,
}: RailProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const reduced = usePrefersReducedMotion();
  const container = useRef<HTMLDivElement>(null);
  const offsets = useRef(new Map<string, number>());

  const featureIds = (hierarchy?.products ?? []).flatMap((product) =>
    product.components.flatMap((component) => component.features.map((feature) => feature.id)),
  );

  // FLIP: rows slide from their old position to the new one.
  useLayoutEffect(() => {
    const root = container.current;
    if (root === null) return;
    const rows = [...root.querySelectorAll<HTMLElement>('[data-feature-row]')];
    const next = new Map<string, number>();
    for (const row of rows) {
      const id = row.dataset.featureRow as string;
      const top = row.offsetTop;
      next.set(id, top);
      const before = offsets.current.get(id);
      if (before !== undefined && before !== top && !reduced) {
        row.style.transition = 'none';
        row.style.transform = `translateY(${before - top}px)`;
        requestAnimationFrame(() => {
          row.style.transition = `transform ${COUNT_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
          row.style.transform = 'translateY(0)';
        });
      }
    }
    offsets.current = next;
  }, [featureIds.join(','), reduced]);

  return (
    <aside
      className={collapsed ? 'rail collapsed' : 'rail'}
      aria-label="Product hierarchy"
      ref={container as React.RefObject<HTMLDivElement>}
    >
      <div className="rail-head">
        <button
          type="button"
          className="button icon"
          title={collapsed ? 'Expand hierarchy' : 'Collapse hierarchy'}
          aria-label={collapsed ? 'Expand hierarchy' : 'Collapse hierarchy'}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" size={18} /> : <PanelLeftClose aria-hidden="true" size={18} />}
        </button>
      </div>
      {collapsed ? null : (
        <div role="tree" aria-label="Product hierarchy" className="tree">
          {(hierarchy?.products ?? []).map((product) => (
            <div key={product.id} role="treeitem" aria-expanded="true" aria-label={product.name}>
              <p className="tree-product display">{product.name}</p>
              <div role="group">
                {product.components.map((component) => (
                  <div key={component.id} role="treeitem" aria-expanded="true" aria-label={component.name}>
                    <p className="tree-component">{component.name}</p>
                    <div role="group">
                      {component.features.map((feature) => (
                        <div
                          key={feature.id}
                          role="treeitem"
                          aria-label={feature.name}
                          tabIndex={-1}
                          data-feature-row={feature.id}
                          ref={(element) => registerRow(feature.id, element)}
                          className={dragging ? 'feature-row drop-target' : 'feature-row'}
                          onMouseUp={() => dragging && onDropFeature(feature.id)}
                        >
                          <span className="feature-row-name">{feature.name}</span>
                          <span className="feature-row-figures">
                            <AnimatedNumber value={feature.insightCount} reduced={reduced} label="Insights" />
                            <AnimatedNumber value={feature.companyCount} reduced={reduced} label="Companies" />
                            <AnimatedNumber value={feature.impact} reduced={reduced} label="Impact" />
                            <span className="figure rank" title="Rank">
                              {feature.rank ?? '—'}
                            </span>
                          </span>
                          {reduced && linkedFeatureId === feature.id ? (
                            <span className="linked-badge">Linked</span>
                          ) : null}
                          {feature.subfeatures.length > 0 ? (
                            <div role="group" className="subfeatures">
                              {feature.subfeatures.map((subfeature) => (
                                <div key={subfeature.id} role="treeitem" aria-label={subfeature.name}>
                                  <span className="subfeature-name">{subfeature.name}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
