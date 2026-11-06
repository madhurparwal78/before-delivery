import { renderSignIn } from "./signin.ts";
import { renderDesk } from "./desk.ts";
import { renderDrop } from "./drop.ts";
import { renderInspect } from "./inspect.ts";

function route(): void {
  const path = window.location.pathname;
  const app = document.getElementById("app")!;
  if (path === "/" || path === "") {
    renderSignIn(app);
    return;
  }
  if (path.startsWith("/inspect/")) {
    const token = decodeURIComponent(path.slice("/inspect/".length)) || "none";
    renderInspect(app, token);
    return;
  }
  if (path.startsWith("/desk/drops/")) {
    const dropId = decodeURIComponent(path.slice("/desk/drops/".length));
    renderDrop(app, dropId);
    return;
  }
  if (path === "/desk" || path.startsWith("/desk/")) {
    renderDesk(app);
    return;
  }
  window.history.replaceState({}, "", "/");
  renderSignIn(app);
}

window.addEventListener("popstate", () => route());
route();
