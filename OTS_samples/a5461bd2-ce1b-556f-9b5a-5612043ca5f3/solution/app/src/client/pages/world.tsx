import { useLayoutEffect, useRef } from "react";
import type { World } from "../../shared/types";
import { catalog } from "../boot";
import { displayFamily, metaLine } from "../format";
import { focusClear } from "../focus";
import { hasNavigated, Link, navigate } from "../router";
import { StageBand } from "../stage/views";
import { Swatches } from "../swatches";

/** Previous and next follow ring order and never wrap. */
function NeighbourLinks({ world }: { world: World }) {
  const previous = catalog.worlds[world.index - 2];
  const next = catalog.worlds[world.index];
  return (
    <p className="neighbours">
      {previous && <Link className="button button--outline" href={`/worlds/${previous.slug}`}>Previous world: {previous.name}</Link>}
      {next && <Link className="button button--outline" href={`/worlds/${next.slug}`}>Next world: {next.name}</Link>}
    </p>
  );
}

export function WorldPage({ world }: { world: World }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (hasNavigated()) focusClear(heading.current);
  }, [world.slug]);

  return (
    <>
      <StageBand world={world} />
      <article className="world" data-world={world.slug} style={{ background: world.colours.ground, color: world.colours.ink }}>
        <div className="world-inner">
          <h1 ref={heading} tabIndex={-1} style={{ fontFamily: displayFamily(world.display_face) }}>{world.name}</h1>
          <p className="world-meta">{metaLine(world)}</p>
          <h2>Overview</h2>
          <p className="prose">{world.overview}</p>
          <h2>Visual identity</h2>
          <Swatches colours={world.colours} />
          <p>Display face: {world.display_face}</p>
          <h2>Design decisions</h2>
          <ol className="decisions">
            {world.decisions.map((decision) => (
              <li key={decision.title}>
                <h3>{decision.title}</h3>
                <p className="prose">{decision.text}</p>
              </li>
            ))}
          </ol>
          <h2>Deliverables</h2>
          <ul className="deliverables">
            {world.deliverables.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p><Link className="button button--outline" href={`/work/${world.slug}`}>Read the full case study</Link></p>
          <NeighbourLinks world={world} />
          <p><button type="button" className="button button--outline" onClick={() => navigate("/")}>Back to all worlds</button></p>
        </div>
      </article>
    </>
  );
}
