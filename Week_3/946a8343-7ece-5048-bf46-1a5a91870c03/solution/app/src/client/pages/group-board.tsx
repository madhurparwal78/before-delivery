// `/groups/<path>/-/boards/<board id>`: a board over the issues of every project in the group. Cards read
// `Issue <project slug>#<iid>`. There is no single project to follow, so the page follows the live channel of each project that
// has cards on the board.
import { useMemo } from "preact/hooks";
import { api, useResource } from "../api.ts";
import { useRoute } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { useTitle } from "../ui/page.tsx";
import { BoardScreen } from "./planning/board-screen.tsx";
import { mayMove, useFilterOptions, useFilterString, useGroupByPath, useReloadOnChange } from "./planning/filters.ts";
import { useGroupBoardLive } from "./planning/group-live.ts";
import { readBoard, type BoardData } from "./planning/types.ts";
import "../styles/planning.css";

function GroupBoard({ path, boardId }: { path: string; boardId: string }) {
  const filters = useFilterString();
  const number = Number(boardId);
  const resource = useResource<BoardData>(
    async (signal) => readBoard(await api.get<unknown>(`/api/boards/${encodeURIComponent(boardId)}${filters ? `?${filters}` : ""}`, { signal })),
    [boardId],
  );
  useReloadOnChange(resource, filters);
  const group = useGroupByPath(path);
  const options = useFilterOptions({ kind: "group", groupId: group.data?.id ?? null });
  const projectIds = useMemo(() => {
    const ids = new Set<number>();
    for (const list of resource.data?.lists ?? []) for (const card of list.cards) if (card.projectId !== null) ids.add(card.projectId);
    return [...ids].sort((a, b) => a - b);
  }, [resource.data]);
  useGroupBoardLive(projectIds, number, () => void resource.reload());
  const name = resource.data?.name ?? "";
  useTitle(name === "" ? "Board" : name);
  return (
    <div class="sp-container sp-planning">
      <h1 tabIndex={-1} class="sp-page-title">
        {name === "" ? "Board" : name}
      </h1>
      <BoardScreen resource={resource} boardId={number} projectId={null} options={options} canMove={mayMove(options.role)} />
    </div>
  );
}

export default function GroupBoardPage() {
  const { params } = useRoute();
  const boardId = params["id"] ?? "";
  return (
    <Main band>
      <GroupBoard key={boardId} path={params["path"] ?? ""} boardId={boardId} />
    </Main>
  );
}
