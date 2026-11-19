import type { RefObject } from "react";
import type { Problem } from "./model.js";

/** The "Problems to fix" group of a refused save: one link per field error, each moving focus to that field. */
export function ProblemsGroup({ problems, groupRef, onPick }: { problems: Problem[]; groupRef: RefObject<HTMLDivElement>; onPick: (field: string) => void }): JSX.Element {
  return (
    <div ref={groupRef} role="group" aria-label="Problems to fix" tabIndex={-1} className="rf-problems">
      <p>{problems.length} problems to fix before saving.</p>
      <ul>
        {problems.map((problem) => (
          <li key={problem.field}>
            <a
              href={`#${problem.field}`}
              onClick={(event) => {
                event.preventDefault();
                onPick(problem.field);
              }}
            >
              {problem.label}: {problem.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
