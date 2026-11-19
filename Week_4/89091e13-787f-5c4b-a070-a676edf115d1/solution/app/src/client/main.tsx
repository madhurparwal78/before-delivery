import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { connectLive } from "./lib/live.ts";
import { SessionProvider } from "./lib/session.tsx";
import "./styles.css";

// A member's page opens the live channel before React renders, so no block is missed while the page first draws.
const liveWorkspace = document.querySelector<HTMLMetaElement>('meta[name="live-workspace"]')?.content;
if (liveWorkspace) connectLive(liveWorkspace);

createRoot(document.getElementById("root") as HTMLElement).render(
  <SessionProvider>
    <App />
  </SessionProvider>,
);
