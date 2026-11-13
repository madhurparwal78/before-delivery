import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("missing root element");

/** The first paint already uses the bundled faces, so no line re-wraps when a font arrives late. */
const FACES: [string, URL][] = [
  ["Work Sans", new URL("./fonts/WorkSans-Regular-latin.woff2", import.meta.url)],
  ["Sometype Mono", new URL("./fonts/SometypeMono-Regular-latin.woff2", import.meta.url)],
];

async function loadFaces(): Promise<void> {
  await Promise.all(
    FACES.map(async ([family, url]) => {
      const face = new FontFace(family, `url(${url.href}) format("woff2")`, { style: "normal", weight: "400" });
      document.fonts.add(await face.load());
    }),
  );
}

const fontWait = new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
void Promise.race([loadFaces().catch(() => undefined), fontWait]).then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
