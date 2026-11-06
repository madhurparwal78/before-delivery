import "./fonts/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/inbox.css";
import "./styles/pages.css";
import "./styles/board.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
