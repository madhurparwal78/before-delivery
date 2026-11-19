import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setDevice } from "./api";

const query = new URLSearchParams(location.search);
const chosen = query.get("device");
if (chosen && !location.pathname.startsWith("/r/")) {
  if (/^DEV-\d+$/.test(chosen)) setDevice(chosen);
  query.delete("device");
  const rest = query.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
