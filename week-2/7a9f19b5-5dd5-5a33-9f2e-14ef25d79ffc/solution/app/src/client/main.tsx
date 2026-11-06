import "./styles/fonts.css";
import "./styles/app.css";
// The dial applies the lighting state to <html> as soon as the bundle runs, before the first render.
import "./lib/dial";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionProvider } from "./lib/session";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
