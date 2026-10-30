import "../story/styles/fonts.css";
import "../story/styles/tokens.css";
import "../story/styles/base.css";
import "../story/styles/page.css";
import "./planner.css";

import { createRoot } from "react-dom/client";

import { ManagePage } from "./ManagePage";

createRoot(document.getElementById("root") as HTMLElement).render(<ManagePage />);
