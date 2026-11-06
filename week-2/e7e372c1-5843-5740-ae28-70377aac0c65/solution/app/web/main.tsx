import "./styles.css";
import { createRoot } from "react-dom/client";
import { BoardPage } from "./board/BoardPage.tsx";
import { CitationPage } from "./board/CitationPage.tsx";
import { usePath } from "./router.ts";
import { StaffApp } from "./staff/StaffApp.tsx";

function App() {
  const path = usePath();
  const cite = /^\/cite\/([^/]+)\/([^/]+)$/.exec(path);
  if (cite) return <CitationPage key={path} figureText={cite[1] ?? ""} date={cite[2] ?? ""} />;
  if (path === "/staff" || path.startsWith("/staff/") || path === "/operator") return <StaffApp path={path} />;
  return <BoardPage />;
}

// The first render waits for the faces the page sets text in, so a late swap cannot rewrap it and shift the layout.
const FACES = ['700 1em "Archivo"', '400 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];
const FONT_PATIENCE_MS = 3000;

async function fontsReady(): Promise<void> {
  const loaded = Promise.all(FACES.map((face) => document.fonts.load(face))).then(() => undefined, () => undefined);
  await Promise.race([loaded, new Promise<void>((resolve) => setTimeout(resolve, FONT_PATIENCE_MS))]);
}

const mount = document.getElementById("root");
if (mount) void fontsReady().then(() => createRoot(mount).render(<App />));
