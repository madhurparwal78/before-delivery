// `/projects/<id>/-/boards/<board id>?label=&assignee=&milestone=&search=`: a project board on the light band. Live: counts and
// cards change for every viewer from `board` messages.
import { useRef } from "preact/hooks";
import { api } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { useRole } from "../role.ts";
import { useRoute } from "../router.ts";
import { LiveMain } from "../shell/main.tsx";
import { useTitle } from "../ui/page.tsx";
import { asNumber } from "../util.ts";
import { BoardScreen } from "./planning/board-screen.tsx";
import { useFilterOptions, useFilterString, useReloadOnChange } from "./planning/filters.ts";
import { readBoard, type BoardData } from "./planning/types.ts";
import "../styles/planning.css";

function ProjectBoard({ projectId, boardId }: { projectId: string; boardId: string }) {
  const filters = useFilterString();
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const number = Number(boardId);
  const resource = useLiveResource<BoardData>({
    project: projectId,
    types: ["board"],
    deps: [projectId, boardId],
    load: async (signal) => readBoard(await api.get<unknown>(`/api/boards/${encodeURIComponent(boardId)}${filtersRef.current ? `?${filtersRef.current}` : ""}`, { signal })),
    match: (message) => {
      const ids = message.data.board_ids;
      return !Array.isArray(ids) || ids.some((id) => asNumber(id) === number);
    },
  });
  useReloadOnChange(resource, filters);
  const options = useFilterOptions({ kind: "project", projectId });
  const { atLeast } = useRole();
  const name = resource.data?.name ?? "";
  useTitle(name === "" ? "Board" : name);
  return (
    <div class="sp-container sp-planning">
      <h1 tabIndex={-1} class="sp-page-title">
        {name === "" ? "Board" : name}
      </h1>
      <BoardScreen resource={resource} boardId={number} projectId={projectId} options={options} canMove={atLeast("reporter")} />
    </div>
  );
}

export default function BoardPage() {
  const { params } = useRoute();
  const projectId = params["id"] ?? "";
  const boardId = params["board"] ?? "";
  return (
    <LiveMain band project={projectId} pageKeys={[`board:${boardId}`]}>
      <ProjectBoard key={boardId} projectId={projectId} boardId={boardId} />
    </LiveMain>
  );
}
