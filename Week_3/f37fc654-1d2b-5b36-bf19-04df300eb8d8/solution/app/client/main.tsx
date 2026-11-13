import { createRoot } from "react-dom/client";
import { App } from "./App";
import { watchServices } from "./lib/notices";
import "./styles.css";

watchServices();
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
