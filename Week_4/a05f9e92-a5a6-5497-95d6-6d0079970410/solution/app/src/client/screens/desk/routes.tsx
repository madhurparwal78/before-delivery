import type { RouteDef } from "../../lib/router.js";
import "../../styles/desk.css";
import { Desk } from "./Desk.js";

/** The ticket workspace: queues, list and record form on one page component. */
export const deskRoutes: RouteDef[] = [
  { pattern: "/desk", render: () => <Desk /> },
  { pattern: "/desk/lists/:table", render: () => <Desk /> },
  { pattern: "/desk/records/new/:table", render: () => <Desk /> },
  { pattern: "/desk/records/:number", render: () => <Desk /> },
];
