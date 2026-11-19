import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { ConfigProvider } from "./lib/config";
import { NoticeProvider } from "./lib/notices";
import { RouterProvider } from "./lib/router";
import { SessionProvider } from "./lib/session";
import { StatusProvider } from "./lib/status";
import { StreamProvider } from "./lib/stream";
import "@fontsource/fira-sans/latin-400.css";
import "@fontsource/fira-sans/latin-600.css";
import "@fontsource/fira-sans/latin-700.css";
import "./styles/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// Load every bundled Fira Sans weight before the first render, so narrow pages never reflow when the
// web font swaps in (a layout shift on the auth pages). No timer: a paused test clock cannot hold it up.
const faces = ["400", "600", "700"].map((weight) => document.fonts.load(`${weight} 16px "Fira Sans"`));
await Promise.allSettled(faces);

createRoot(root).render(
  <StrictMode>
    <ConfigProvider>
      <StatusProvider>
        <NoticeProvider>
          <RouterProvider>
            <SessionProvider>
              <StreamProvider>
                <App />
              </StreamProvider>
            </SessionProvider>
          </RouterProvider>
        </NoticeProvider>
      </StatusProvider>
    </ConfigProvider>
  </StrictMode>,
);
