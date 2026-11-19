import type { BlockDetail, BlockShares } from "../../shared/api.ts";
import { getJson } from "./api.ts";
import { useResource, type Resource } from "./resource.ts";
import { useWorkspace } from "./workspace.tsx";

interface BlockSquare {
  block: BlockDetail;
  shares: BlockShares;
}

/** A block and its served shares, fetched together so the square always matches its roots. */
export function useBlockSquare(height: number | null, keepPrevious = false): Resource<BlockSquare> {
  const { id } = useWorkspace();
  return useResource<BlockSquare>(
    height === null ? null : `${id}/${height}`,
    async () => {
      const [block, shares] = await Promise.all([
        getJson<BlockDetail>(`/api/w/${id}/blocks/${height}`),
        getJson<BlockShares>(`/api/w/${id}/blocks/${height}/shares`),
      ]);
      return { block, shares };
    },
    keepPrevious,
  );
}
