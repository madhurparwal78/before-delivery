import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./app.js";

const root = document.getElementById("root");
if (!root) throw new Error("the page has no root element");
createRoot(root).render(<App />);
