import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ToastProvider } from "./components/Toast.js";
import { SessionProvider } from "./session.js";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/screens.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <SessionProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </SessionProvider>,
);
