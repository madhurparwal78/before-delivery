import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { start } from "./store";
import "./styles.css";

start();
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
