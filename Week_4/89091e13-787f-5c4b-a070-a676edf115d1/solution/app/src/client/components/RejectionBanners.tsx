import type { BlockDetail, BlockSummary } from "../../shared/api.ts";
import { rejectionText } from "../../shared/copy.ts";
import { getJson } from "../lib/api.ts";
import { useResource } from "../lib/resource.ts";
import { useWorkspace } from "../lib/workspace.tsx";

const BANNER_WINDOW = 5;

/** A banner for every rejected block among the latest five heights, newest first. */
export function RejectionBanners({ blocks }: { blocks: BlockSummary[] }) {
  const { id } = useWorkspace();
  const heights = blocks.slice(0, BANNER_WINDOW).filter((block) => block.status === "rejected").map((block) => block.height);
  const details = useResource<BlockDetail[]>(`${id}/banners/${heights.join(",")}`, () =>
    Promise.all(heights.map((height) => getJson<BlockDetail>(`/api/w/${id}/blocks/${height}`))), true);
  return (
    <div className="banners">
      {details.data?.map((block) => block.rejection && (
        <div key={block.height} role="alert" aria-label={`Block ${block.height} rejected`} className="banner">
          {rejectionText(block.height, block.rejection)}
        </div>
      ))}
    </div>
  );
}
