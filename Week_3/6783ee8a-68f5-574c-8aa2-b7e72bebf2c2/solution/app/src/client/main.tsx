import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionProvider } from "./session";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/notebook.css";
import "./styles/landing.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <SessionProvider>
    <App />
  </SessionProvider>,
);
