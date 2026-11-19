import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionProvider } from "./session";
import "./styles.css";

const query = window.matchMedia("(prefers-reduced-motion: reduce)");
const syncMotion = (): void => {
  document.documentElement.dataset["motion"] = query.matches ? "reduced" : "full";
};
syncMotion();
query.addEventListener("change", syncMotion);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <SessionProvider>
      <App />
    </SessionProvider>,
  );
}
