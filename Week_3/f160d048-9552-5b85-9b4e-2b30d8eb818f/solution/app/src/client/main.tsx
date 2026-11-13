import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/screens.css";
import { publishMotionPreference } from "./motion";
import { SessionProvider } from "./session";
import { App } from "./shell/App";

publishMotionPreference();

const fonts = ["400 1em 'Literata Variable'", "italic 400 1em 'Literata Variable'"];
const loaded = Promise.race([
  Promise.all(fonts.map((font) => document.fonts.load(font, "₹0 Aa"))),
  new Promise((resolve) => setTimeout(resolve, 2500)),
]).catch(() => undefined);

void loaded.then(() => {
  const root = document.getElementById("root");
  if (root) {
    createRoot(root).render(
      <SessionProvider>
        <App />
      </SessionProvider>,
    );
  }
});
