import type { RouteDef } from "../../lib/router.js";
import "../../styles/portal.css";
import { Article } from "./Article.js";
import { Cart } from "./Cart.js";
import { Fault } from "./Fault.js";
import { Guide } from "./Guide.js";
import { Inbox } from "./Inbox.js";
import { IncidentPage } from "./IncidentPage.js";
import { ItemPage } from "./ItemPage.js";
import { Portal } from "./Portal.js";
import { RequestPage } from "./RequestPage.js";

/** Routes of the requester portal and the inbox. */
export const portalRoutes: RouteDef[] = [
  { pattern: "/portal", render: () => <Portal /> },
  { pattern: "/portal/items/:id", render: ({ id }) => <ItemPage key={id} id={id!} /> },
  { pattern: "/portal/guides/:id", render: ({ id }) => <Guide key={id} id={id!} /> },
  { pattern: "/portal/cart", render: () => <Cart /> },
  { pattern: "/portal/requests/:number", render: ({ number }) => <RequestPage number={number!} /> },
  { pattern: "/portal/incidents/:number", render: ({ number }) => <IncidentPage key={number} number={number!} /> },
  { pattern: "/portal/fault", render: () => <Fault /> },
  { pattern: "/portal/knowledge/:number", render: ({ number }) => <Article key={number} number={number!} /> },
  { pattern: "/inbox", render: () => <Inbox /> },
];
