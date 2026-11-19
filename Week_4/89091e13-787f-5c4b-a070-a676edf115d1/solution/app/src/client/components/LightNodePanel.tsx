import type { BlockSummary, LightNode, NodeSamples } from "../../shared/api.ts";
import { useJson } from "../lib/resource.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { Reveal } from "./Reveal.tsx";
import { Ring } from "./Ring.tsx";
import { LinkPill } from "./Pill.tsx";

function LatestConfidence({ node, height }: { node: LightNode; height: number }) {
  const { id } = useWorkspace();
  const samples = useJson<NodeSamples>(`/api/w/${id}/light-nodes/${node.id}/samples?height=${height}`);
  return <p className="spotlight__confidence">Latest confidence {samples.data?.confidence ?? "0.0000"}% on block {height}</p>;
}

/** One wide panel per light node: copy and a solid pill on one side, luminous ring art on the other; panels alternate sides. */
export function LightNodePanel({ node, position, latest }: { node: LightNode; position: number; latest: BlockSummary | undefined }) {
  const { id } = useWorkspace();
  return (
    <article className={`panel spotlight ${position % 2 === 1 ? "spotlight--flip" : ""}`}>
      <div className="spotlight__copy">
        <Reveal as="h3" className="spotlight__title">{node.name}</Reveal>
        <Reveal index={1}>
          {latest && <LatestConfidence node={node} height={latest.height} />}
          <p className="muted">
            {node.autoSample ? "Samples every new block on its own." : "Samples when you ask it to."} Each sample is drawn from this node's seeded sequence.
          </p>
        </Reveal>
        <Reveal index={2}><LinkPill to={`/w/${id}/nodes/${node.id}`}>Open {node.name}</LinkPill></Reveal>
      </div>
      <div className="spotlight__art"><Ring /></div>
    </article>
  );
}
