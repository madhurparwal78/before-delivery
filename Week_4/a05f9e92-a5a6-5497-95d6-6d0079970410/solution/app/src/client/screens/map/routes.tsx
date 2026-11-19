import type { RouteDef } from "../../lib/router.js";
import "../../styles/map.css";
import { MajorIncident } from "./MajorIncident.js";
import { ServiceMap } from "./ServiceMap.js";

export const mapRoutes: RouteDef[] = [
  { pattern: "/desk/map", render: () => <ServiceMap /> },
  { pattern: "/desk/major/:number", render: (params) => <MajorIncident key={params.number} number={params.number!} /> },
];
