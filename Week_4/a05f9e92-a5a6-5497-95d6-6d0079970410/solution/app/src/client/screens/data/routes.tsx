import type { RouteDef } from "../../lib/router.js";
import "../../styles/data.css";
import { ConfigSets } from "./ConfigSets.js";
import { Dashboard } from "./Dashboard.js";
import { Exports } from "./Exports.js";
import { Imports } from "./Imports.js";

export const dataRoutes: RouteDef[] = [
  { pattern: "/desk/dashboards/:id", render: (params) => <Dashboard id={params.id!} /> },
  { pattern: "/dashboards/:id", render: (params) => <Dashboard id={params.id!} /> },
  { pattern: "/desk/exports", render: () => <Exports /> },
  { pattern: "/desk/imports", render: () => <Imports /> },
  { pattern: "/desk/config-sets", render: () => <ConfigSets /> },
];
