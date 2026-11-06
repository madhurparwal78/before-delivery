import "@fontsource/instrument-serif/400.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useLocation } from "./router";
import { StoreProvider } from "./store";
import { LenderPage } from "./pages/Lender";
import { RecordPage } from "./pages/Record";
import { Register } from "./pages/Register";
import { Workspace } from "./pages/Workspace";

function StaffPages() {
  const { path } = useLocation();
  const record = /^\/records\/([^/]+)$/.exec(path);
  if (record) return <RecordPage key={record[1]} id={decodeURIComponent(record[1])} />;
  if (path === "/records") return <Register />;
  return <Workspace />;
}

function App() {
  const lender = /^\/p\/([^/]+)$/.exec(location.pathname);
  if (lender) return <LenderPage token={decodeURIComponent(lender[1])} />;
  return (
    <StoreProvider>
      <StaffPages />
    </StoreProvider>
  );
}

// The first paint waits briefly for the web fonts, so no line re-wraps (and nothing below it moves) when
// they swap in for the fallback face.
const FONTS = ['400 1em "Instrument Serif"', '400 1em "Hanken Grotesk"', '500 1em "Hanken Grotesk"', '600 1em "Hanken Grotesk"'];
const FONT_WAIT_MS = 1500;
const fontsReady = Promise.all(FONTS.map((f) => document.fonts.load(f))).catch(() => undefined);
const fontWait = new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS));

void Promise.race([fontsReady, fontWait]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
