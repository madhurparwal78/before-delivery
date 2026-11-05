// Browser entry: fonts and styles, then the app.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./app.js";
import { installPointerFeedback } from "./motion.js";

installPointerFeedback();
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<StrictMode><App /></StrictMode>);
