import { loadMe, buildShell, dashboardView, scenesView, membersView, agentsView, auditView } from "./views/app";
import { billingView, settingsView } from "./views/billing";
import { editorView } from "./views/editor";
import { homeView, pricingView, signupView, loginView, inviteView } from "./views/public";
import { reviewView, embedView } from "./views/scene-pages";
import { el } from "./dom";

async function route(): Promise<void> {
  const root = document.getElementById("root")!;
  const path = window.location.pathname;
  root.textContent = "";

  // Public pages
  if (path === "/" || path === "") return homeView(root);
  if (path === "/pricing") return pricingView(root);
  if (path === "/signup") return signupView(root);
  if (path === "/login") return loginView(root);
  if (path.startsWith("/invite/")) return inviteView(root, path.slice("/invite/".length));
  if (path.startsWith("/review/")) return reviewView(root, path.slice("/review/".length).split("/")[0]!);
  if (path.startsWith("/embed/")) return embedView(root, path.split("/")[2] ?? "");

  if (path === "/app" || path.startsWith("/app/")) {
    let me;
    try {
      me = await loadMe();
    } catch {
      window.location.replace("/login");
      return;
    }
    if (!me.member) {
      root.append(el("div", { className: "page" }, el("p", { text: "Agents use the API, not the app." })));
      return;
    }
    const shell = await buildShell(me, path);
    if (path === "/app") return dashboardView(me, shell);
    if (path === "/app/scenes") return scenesView(me, shell);
    if (path.startsWith("/app/scenes/")) return editorView(me, shell.page, path.split("/")[3] ?? "");
    if (path === "/app/members") return membersView(me, shell);
    if (path === "/app/agents") return agentsView(me, shell);
    if (path === "/app/audit") return auditView(me, shell);
    if (path === "/app/billing") return billingView(me, shell);
    if (path === "/app/settings") return settingsView(me, shell);
    return dashboardView(me, shell);
  }

  return homeView(root);
}

window.addEventListener("popstate", () => {
  void route();
});
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || !href.startsWith("/")) return;
  if (anchor.target === "_blank") return;
  e.preventDefault();
  history.pushState(null, "", href);
  void route();
});

void route();
