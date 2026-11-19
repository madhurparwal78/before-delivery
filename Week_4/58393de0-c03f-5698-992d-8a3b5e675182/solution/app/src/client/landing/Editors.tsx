import { ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "../lib/router";
import { EDITORS } from "./content";
import { EditorIcon } from "./EditorIcons";

/** The three-editor intro row: an outline picture, the editor's name, one sentence and a link to its feature row. */
export function Editors() {
  return (
    <section id="editors" className="editors" aria-label="Editors">
      <div className="column">
        <ul className="editor-cards">
          {EDITORS.map((editor) => (
            <li key={editor.kind} className="card editor-card" style={{ "--field": editor.field } as CSSProperties}>
              <EditorIcon kind={editor.kind} />
              <h2>{editor.name}</h2>
              <p>{editor.summary}</p>
              <Link to={`/#${editor.row}`} className="editor-link">
                Explore {editor.name}
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
