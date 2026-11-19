import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/marketing.css";
import "./styles/auth.css";
import "./styles/outline.css";

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<StrictMode><App /></StrictMode>);
