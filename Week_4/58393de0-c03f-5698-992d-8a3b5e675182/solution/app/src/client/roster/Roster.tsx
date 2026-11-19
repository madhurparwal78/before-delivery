import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { RosterStudent } from "../../shared/types";
import { Doodle } from "../projects/Doodle";
import type { SortOrder } from "./classroomState";
import { RosterTile } from "./RosterTile";

const ORDERS: readonly { value: SortOrder; label: string }[] = [
  { value: "nickname", label: "Nickname (A–Z)" },
  { value: "recent", label: "Most recently saved" },
];

interface RosterProps {
  /** Already in the order the Sort roster select asks for. */
  students: readonly RosterStudent[];
  order: SortOrder;
  onOrder: (order: SortOrder) => void;
  timeZone: string;
  onWatch: (student: RosterStudent) => void;
  onRename: (student: RosterStudent) => void;
  onRemove: (student: RosterStudent) => void;
  /** The page's `Show join code` pill, shown here instead of the header while the roster is empty. */
  joinCodeAction: ReactNode;
}

export function Roster({ students, order, onOrder, timeZone, onWatch, onRename, onRemove, joinCodeAction }: RosterProps) {
  return (
    <section className="roster" aria-labelledby="roster-heading">
      <div className="roster-bar">
        <h2 id="roster-heading">Students</h2>
        <div className="field roster-sort">
          <label htmlFor="sort-roster">Sort roster</label>
          <span className="select-wrap">
            <select id="sort-roster" value={order} onChange={(event) => onOrder(event.currentTarget.value as SortOrder)}>
              {ORDERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={18} strokeWidth={2} />
          </span>
        </div>
      </div>
      {students.length === 0 ? (
        <div className="empty-state roster-empty">
          <Doodle />
          <p>Share the join code with your class. Each Student who joins gets a tile here.</p>
          {joinCodeAction}
        </div>
      ) : null}
      <ul className="card-grid roster-grid" aria-label="Classroom roster">
        {students.map((student) => (
          <RosterTile key={student.id} student={student} timeZone={timeZone} onWatch={onWatch} onRename={onRename} onRemove={onRemove} />
        ))}
      </ul>
    </section>
  );
}
