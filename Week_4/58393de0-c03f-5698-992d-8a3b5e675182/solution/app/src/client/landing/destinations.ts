import { useSession } from "../lib/session";
import type { StarterId } from "../starters";

export type EditorKind = "3d" | "circuit" | "blocks";

/** Where the landing page's calls to action lead: straight into an editor when signed in, to sign-up otherwise. */
export function useDestinations() {
  const { account } = useSession();
  return {
    editor: (kind: EditorKind): string => (account ? `/editor/new?kind=${kind}` : "/signup"),
    starter: (id: StarterId): string => (account ? `/editor/new?kind=3d&starter=${id}` : "/signup"),
    classroom: account?.kind === "educator" ? "/dashboard" : "/signup?type=educator",
  };
}
