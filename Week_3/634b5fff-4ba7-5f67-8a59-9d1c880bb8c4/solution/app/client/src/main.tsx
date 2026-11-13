import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { App } from "./App.js";
import { watchMotions } from "./ui.js";

watchMotions();
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
