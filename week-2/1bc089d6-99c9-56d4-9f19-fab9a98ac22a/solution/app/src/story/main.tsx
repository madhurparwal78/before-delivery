import "./styles/fonts.css";
import "lenis/dist/lenis.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/story.css";
import "./styles/player.css";
import "../planner/planner.css";

import { createRoot } from "react-dom/client";

import { Story } from "./Story";

createRoot(document.getElementById("root") as HTMLElement).render(<Story />);
