import type { CSSProperties } from "react";
import { Link } from "../lib/router";
import { EDITORS } from "./content";
import { useDestinations } from "./destinations";
import { BlocksPreview, CircuitPreview, WorkshopPreview } from "./previews";

const PREVIEWS = { "3d": WorkshopPreview, circuit: CircuitPreview, blocks: BlocksPreview } as const;

/** Three editor feature rows: eyebrow, heading in the editor's field colour, a paragraph and pill beside a looping demo. Text and media swap sides row by row. */
export function FeatureRows() {
  const { editor } = useDestinations();
  return (
    <div className="column feature-rows">
      {EDITORS.map((info, index) => {
        const Preview = PREVIEWS[info.kind];
        return (
          <article key={info.kind} id={info.row} className={index % 2 === 1 ? "feature feature--flip" : "feature"} style={{ "--field": info.field } as CSSProperties}>
            <div className="feature-text">
              <p className="eyebrow">{info.name}</p>
              <h2>{info.headline}</h2>
              <p className="feature-detail">{info.detail}</p>
              <Link to={editor(info.kind)} className={`pill ${info.pill}`}>Open {info.name}</Link>
            </div>
            <Preview />
          </article>
        );
      })}
    </div>
  );
}
