import type { RouteDef } from "../../lib/router.js";
import "../../styles/design.css";
import { Admin } from "./Admin.js";
import { Designer } from "./Designer.js";
import { RunView } from "./RunView.js";

/** The workflow designer, the run view and the rules and settings screens. */
export const designRoutes: RouteDef[] = [
  { pattern: "/desk/workflows/:id", render: (params) => <Designer id={params.id!} /> },
  { pattern: "/desk/runs/:id", render: (params) => <RunView id={params.id!} /> },
  { pattern: "/desk/admin/:kind", render: (params) => <Admin slug={params.kind!} /> },
];
