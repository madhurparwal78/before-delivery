import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/fonts.css";
import "./styles/app.css";

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
