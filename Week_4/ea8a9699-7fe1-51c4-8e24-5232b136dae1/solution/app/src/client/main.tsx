import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./styles.css";
import { App } from "./App.js";
import { SessionProvider } from "./lib/session.js";

const root = document.getElementById("root");
if (root) {
  const app = createRoot(root);
  flushSync(() =>
    app.render(
      <SessionProvider>
        <App />
      </SessionProvider>,
    ),
  );
}
