import { call } from "./api";
import { SORT_LABELS } from "../shared/rules";
import { GROUPS, LAYOUTS, SORTS, type Board, type Group, type Layout, type Sort } from "../shared/types";

const LAYOUT_LABELS: Record<Layout, string> = { columns: "Columns", rows: "Rows" };
const GROUP_LABELS: Record<Group, string> = { section: "By section", author: "By author" };

interface Props {
  board: Board;
  applyBoard: (change: Partial<Board>) => void;
  reload: () => Promise<unknown>;
}

export function Toolbar({ board, applyBoard, reload }: Props) {
  const save = async (change: { layout: Layout } | { sort: Sort } | { group: Group }): Promise<void> => {
    applyBoard(change);
    await call("PATCH", `/api/boards/${board.id}`, change);
    await reload();
  };
  return (
    <div className="toolbar" role="toolbar" aria-label="Board view">
      <div role="radiogroup" aria-label="Layout" className="segmented">
        {LAYOUTS.map((layout) => (
          <label key={layout} className="segment">
            <input type="radio" name="layout" value={layout} checked={board.layout === layout} onChange={() => void save({ layout })} aria-label={LAYOUT_LABELS[layout]} />
            <span>{LAYOUT_LABELS[layout]}</span>
          </label>
        ))}
      </div>
      <select aria-label="Sort posts" value={board.sort} onChange={(event) => void save({ sort: event.target.value as Sort })}>
        {SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </select>
      <select aria-label="Group posts" value={board.group} onChange={(event) => void save({ group: event.target.value as Group })}>
        {GROUPS.map((group) => (
          <option key={group} value={group}>
            {GROUP_LABELS[group]}
          </option>
        ))}
      </select>
    </div>
  );
}
