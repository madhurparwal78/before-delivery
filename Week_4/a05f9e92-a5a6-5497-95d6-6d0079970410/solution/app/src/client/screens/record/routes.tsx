import type { RouteDef } from "../../lib/router.js";
import "../../styles/record.css";
import { BoardAgenda } from "./Agenda.js";
import { ChangeCalendar } from "./Calendar.js";

/** Routes of the record area: the monthly calendar of changes and the agenda of one board. */
export const recordRoutes: RouteDef[] = [
  { pattern: "/desk/changes/calendar", render: () => <ChangeCalendar /> },
  { pattern: "/desk/boards/:id", render: ({ id }) => <BoardAgenda board={id!} /> },
];
