import type { RouteDef } from "../../lib/router.js";
import "../../styles/votes.css";
import { ApprovalsScreen } from "./Approvals.js";
import { OnCallScreen } from "./OnCall.js";

/** Routes of the votes area: approvals, pages and on call. */
export const votesRoutes: RouteDef[] = [
  { pattern: "/approve", render: () => <ApprovalsScreen /> },
  { pattern: "/pages", render: () => <OnCallScreen pagesFirst /> },
  { pattern: "/desk/oncall", render: () => <OnCallScreen pagesFirst={false} /> },
];
