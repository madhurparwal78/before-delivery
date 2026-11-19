import { useEffect, useRef, useState } from 'react';
import { WORKFLOW_VERBS } from '../../shared/copy.js';
import { useOnScreen, useReducedMotion } from '../lib/hooks.js';

const STEP_MS = 3000;

/**
 * The five-verb workflow stack. One filled active verb advances on a timer, the
 * cycle stops while the hero is off-screen and keeps its step, and under reduced
 * motion all five show at once with `Describe.` filled and no cycling.
 */
export function WorkflowStack(): JSX.Element {
  const listRef = useRef<HTMLUListElement | null>(null);
  const onScreen = useOnScreen(listRef);
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reducedMotion || !onScreen) return;
    const timer = window.setInterval(
      () => setActive((step) => (step + 1) % WORKFLOW_VERBS.length),
      STEP_MS,
    );
    return () => window.clearInterval(timer);
  }, [reducedMotion, onScreen]);

  const activeIndex = reducedMotion ? 0 : active;

  return (
    <ul className="workflow-stack" aria-label="Workflow" ref={listRef}>
      {WORKFLOW_VERBS.map((verb, index) => {
        const isActive = index === activeIndex;
        return (
          <li
            key={verb}
            className={`workflow-stack__item${isActive ? ' workflow-stack__item--active' : ''}`}
            {...(isActive ? { 'aria-current': 'step' as const } : {})}
            style={reducedMotion ? undefined : { animationDelay: `${index * 100}ms` }}
          >
            <span className="workflow-stack__verb display">{verb}</span>
            {isActive && <span className="workflow-stack__dot" aria-hidden="true" />}
          </li>
        );
      })}
    </ul>
  );
}
