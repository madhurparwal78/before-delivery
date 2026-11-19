import type { BlockSummary, LightNode } from "../../shared/api.ts";
import { LightNodePanel } from "../components/LightNodePanel.tsx";
import { Page } from "../components/Page.tsx";
import { Loading } from "../components/StrandCanvas.tsx";
import { useJson } from "../lib/resource.ts";
import { useWorkspace } from "../lib/workspace.tsx";

export function NodesPage() {
  const { id } = useWorkspace();
  const nodes = useJson<LightNode[]>(`/api/w/${id}/light-nodes`);
  const blocks = useJson<BlockSummary[]>(`/api/w/${id}/blocks`);
  return (
    <Page title="Nodes">
      {nodes.data ? (
        <div className="stack stack--wide">
          {nodes.data.map((node, position) => <LightNodePanel key={node.id} node={node} position={position} latest={blocks.data?.[0]} />)}
        </div>
      ) : <Loading label="Light nodes loading" />}
    </Page>
  );
}
