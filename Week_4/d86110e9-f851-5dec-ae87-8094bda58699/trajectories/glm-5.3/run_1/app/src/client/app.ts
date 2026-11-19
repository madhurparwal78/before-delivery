// The app shell: nav, regions, routing and page mounting.

import { h } from "./runtime";
import type * as preact from "preact";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api, connectStream, navigate, onRouteChange, route, onAnnouncement, onEvent, SHELL } from "./runtime";
import type { Me } from "./runtime";
import { Landing } from "./pages/landing";
import { SignUp, SignIn, ConfirmPage, InvitePage } from "./pages/auth";
import { WorkspaceHome } from "./pages/home";
import { EditorPage } from "./pages/editor";
import { RunsPage } from "./pages/runs";
import { RunDetailPage } from "./pages/run-detail";
import { TablesPage, TableDetailPage } from "./pages/tables";
import { MembersPage } from "./pages/members";
import { FormPage } from "./pages/form";
import { NotFound } from "./pages/notfound";

export function App(): VNode {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [updates, setUpdates] = useState<string[]>([]);
  const [narrow, setNarrow] = useState(window.innerWidth < SHELL.breakpoint);
  const [menuOpen, setMenuOpen] = useState(false);
  const r = route();

  useEffect(() => {
    void api<Me>("/api/me").then(setMe).catch(() => setMe(null)).finally(() => setLoaded(true));
    const off = onRouteChange(() => { setMenuOpen(false); });
    const offAnn = onAnnouncement((s) => {
      setUpdates((prev) => [...prev.slice(-19), s]);
    });
    const onResize = () => setNarrow(window.innerWidth < SHELL.breakpoint);
    window.addEventListener("resize", onResize);
    return () => { off(); offAnn(); window.removeEventListener("resize", onResize); };
  }, []);

  // connect the live stream when signed in
  const wsId = me && r.parts[0] === "w" ? r.parts[1] : null;
  useEffect(() => {
    if (wsId) connectStream(wsId);
  }, [wsId]);

  const parts = r.parts;
  let page: any;
  if (parts.length === 0) {
    page = h(Landing, { me });
  } else if (parts[0] === "sign-up") {
    page = h(SignUp, {});
  } else if (parts[0] === "sign-in") {
    page = h(SignIn, {});
  } else if (parts[0] === "confirm") {
    page = h(ConfirmPage, { token: parts[1] ?? "" });
  } else if (parts[0] === "invite") {
    page = h(InvitePage, { token: parts[1] ?? "" });
  } else if (parts[0] === "forms" && parts.length === 3) {
    page = h(FormPage, { slug: parts[1], path: parts[2] });
  } else if (parts[0] === "w" && parts.length >= 2 && wsId) {
    const section = parts[2];
    if (!section) page = h(WorkspaceHome, { me, wsId });
    else if (section === "automations" && parts[3]) page = h(EditorPage, { me, wsId, aid: parts[3], narrow });
    else if (section === "runs" && parts[3]) page = h(RunDetailPage, { me, wsId, rid: parts[3], narrow });
    else if (section === "runs") page = h(RunsPage, { me, wsId });
    else if (section === "tables" && parts[3]) page = h(TableDetailPage, { me, wsId, tid: parts[3] });
    else if (section === "tables") page = h(TablesPage, { me, wsId });
    else if (section === "members") page = h(MembersPage, { me, wsId });
    else page = h(NotFound, {});
  } else {
    page = h(NotFound, {});
  }

  if (!loaded) {
    return h("div", { class: "shell-loading" }, "");
  }

  return h("div", { class: "app-root" },
    h(Nav, { me, narrow, menuOpen, setMenuOpen }),
    h("main", { class: "page-main", id: "main" }, page),
    h("div", { class: "status-region-wrap", "aria-hidden": "false" },
      h("div", { class: "status-region", role: "status", "aria-label": "Run updates", tabIndex: -1, "data-updates": String(updates.length) },
        updates.map((line, i) => h("p", { key: i, class: "status-line" }, line)))),
    h(Footer, { me }));
}

function Nav(p: { me: Me | null; narrow: boolean; menuOpen: boolean; setMenuOpen: (v: boolean) => void }): VNode {
  const { me, narrow, menuOpen, setMenuOpen } = p;
  const r = route();
  const wsId = me ? (r.parts[0] === "w" ? r.parts[1] : me.workspaces[0]?.id) : undefined;
  return h("nav", { class: "pill-nav", "aria-label": "Main" },
    h("a", { class: "nav-logo", href: "/", onClick: (e: Event) => { e.preventDefault(); navigate("/"); } }, "Pinbyte Switchyard"),
    narrow
      ? h("button", {
          class: "pill-btn pill-secondary nav-menu-btn",
          "aria-expanded": menuOpen ? "true" : "false",
          "aria-controls": "nav-links",
          onClick: () => setMenuOpen(!menuOpen),
          onKeyDown: (e: KeyboardEvent) => { if (e.key === "Escape") { setMenuOpen(false); (e.target as HTMLElement).focus(); } },
        }, "Menu")
      : null,
    me
      ? h("div", { class: "nav-links", id: "nav-links", style: narrow && !menuOpen ? "display:none" : undefined },
          h("a", { class: "nav-link", href: `/w/${wsId}`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${wsId}`); } }, "Automations"),
          h("a", { class: "nav-link", href: `/w/${wsId}/runs`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${wsId}/runs`); } }, "Runs"),
          h("a", { class: "nav-link", href: `/w/${wsId}/tables`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${wsId}/tables`); } }, "Tables"),
          h("a", { class: "nav-link", href: `/w/${wsId}/members`, onClick: (e: Event) => { e.preventDefault(); navigate(`/w/${wsId}/members`); } }, "Members"),
          h("select", {
            class: "input select nav-ws",
            "aria-label": "Workspace",
            onChange: (e: Event) => navigate(`/w/${(e.target as HTMLSelectElement).value}`),
          }, me.workspaces.map((w) => h("option", { value: w.id, selected: w.id === wsId }, w.name))),
          h("button", {
            class: "pill-btn pill-secondary",
            onClick: () => { void api("/api/auth/sign-out", { method: "POST" }).then(() => { navigate("/"); location.reload(); }); },
          }, "Sign out"))
      : h("div", { class: "nav-links", id: "nav-links", style: narrow && !menuOpen ? "display:none" : undefined },
          h("a", { class: "nav-link", href: "/sign-in", onClick: (e: Event) => { e.preventDefault(); navigate("/sign-in"); } }, "Sign in"),
          h("a", { class: "pill-btn pill-primary", href: "/sign-up", onClick: (e: Event) => { e.preventDefault(); navigate("/sign-up"); } }, "Create a workspace")));
}

function Footer(p: { me: Me | null }): VNode {
  return h("footer", { class: "site-footer" },
    h("div", { class: "footer-cols" },
      h("div", { class: "footer-col" },
        h("p", { class: "footer-head" }, "Product"),
        h("a", { class: "footer-link", href: "/" }, "Landing"),
        h("a", { class: "footer-link", href: "/sign-in" }, "Sign in")),
      h("div", { class: "footer-col" },
        h("p", { class: "footer-head" }, "Workspace"),
        h("a", { class: "footer-link", href: "#" }, "Automations"),
        h("a", { class: "footer-link", href: "#" }, "Runs")),
      h("div", { class: "footer-col" },
        h("p", { class: "footer-head" }, "Company"),
        h("a", { class: "footer-link", href: "#" }, "About"),
        h("a", { class: "footer-link", href: "#" }, "Legal"))),
    h("div", { class: "footer-lattice", "aria-hidden": "true" }),
    h("div", { class: "footer-bottom" },
      p.me ? h("p", { class: "footer-tz" }, `Times are shown in ${SHELL.timeZone}`) : null,
      h("p", { class: "footer-copy" }, "© Pinbyte Switchyard")));
}
