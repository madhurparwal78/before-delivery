import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { SessionProvider } from "./session.tsx";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/programme.css";
import "./styles/screens.css";

createRoot(document.getElementById("root")!).render(
  <SessionProvider>
    <App />
  </SessionProvider>,
);
