import { User, Project, api, RequestError } from "./api";
import { h, clearEl, Feedback, restoreFocus } from "./ui";
import { icon, logoMark } from "./illustrations";

export interface ShellCtx {
  user: User | null;
  projects: Project[];
  fb: Feedback;
  currentProjectSlug: () => string | null;
  currentLanguage: () => string | null;
  onLanguageChange: (lang: string) => void;
}

const langMenuName = "Target language";

export function buildShell(ctx: ShellCtx): { header: HTMLElement; statusRegion: HTMLElement; notice: HTMLElement; refresh: (projects: Project[]) => void } {
  const isOwner = ctx.user?.role === "owner";
  const header = h("header", { class: "site-header" });
  const inner = h("div", { class: "container inner" });
  header.appendChild(inner);

  const logo = h("a", { class: "logo", href: ctx.user ? (isOwner ? "/desk" : "/review") : "/" });
  logo.innerHTML = logoMark() + "<span>Interline Desk</span>";
  inner.appendChild(logo);

  // desktop nav
  const nav = h("nav", { class: "desk-nav", "aria-label": "Workspace" });
  const actions = h("div", { class: "actions" });
  const refresh = (projects: Project[]) => rebuildNav(projects);

  function groups(projects: Project[]): Array<{ name: string; groups: Array<{ label: string; links: Array<[string, string]> }> }> {
    if (isOwner) {
      const byClient = new Map<string, Project[]>();
      for (const p of projects) {
        const arr = byClient.get(p.client) || [];
        arr.push(p);
        byClient.set(p.client, arr);
      }
      const projGroups = Array.from(byClient.entries()).map(([client, ps]) => ({
        label: client,
        links: ps.map((p) => [p.name, `/projects/${p.slug}`] as [string, string]),
      }));
      const branchesByProject = projects.map((p) => ({
        label: p.name,
        links: [], // filled by openBranches via async fetch at open time
      }));
      void branchesByProject;
      return [
        {
          name: "Projects",
          groups: [
            ...projGroups,
            { label: "", links: [["New project", "#new-project"]] },
          ],
        },
        { name: "Branches", groups: branchesByProject.length ? awaitBranches(projects) : [{ label: "", links: [] }] },
        { name: "Review", groups: [{ label: "", links: [["Review queue", "/review"]] }] },
        {
          name: "Workspace",
          groups: projects.map((p) => ({
            label: p.name,
            links: [
              ["Translation memory", `/projects/${p.slug}/tm`],
              ["Settings", `/projects/${p.slug}/settings`],
            ],
          })),
        },
      ];
    }
    return [{ name: "Review", groups: [{ label: "", links: [["Review queue", "/review"]] }] }];
  }

  function awaitBranches(projects: Project[]): Array<{ label: string; links: Array<[string, string]> }> {
    // Placeholder replaced at open time.
    return projects.map((p) => ({ label: p.name, links: [] }));
  }

  let openDropdown: { btn: HTMLElement; panel: HTMLElement; nav: HTMLElement } | null = null;

  function closeDropdown(focusBtn = false): void {
    if (!openDropdown) return;
    openDropdown.btn.setAttribute("aria-expanded", "false");
    openDropdown.panel.remove();
    openDropdown.nav.classList.remove("dd-open");
    if (focusBtn) restoreFocus(openDropdown.btn);
    openDropdown = null;
  }

  function openMega(btn: HTMLElement, navEl: HTMLElement, name: string, gs: Array<{ label: string; links: Array<[string, string]> }>): void {
    if (openDropdown) {
      if (openDropdown.btn === btn) { closeDropdown(); return; }
      closeDropdown();
    }
    const panel = h("div", { class: "mega", role: "navigation", "aria-label": name });
    for (const g of gs) {
      if (g.label) panel.appendChild(h("h5", {}, g.label));
      for (const [text, href] of g.links) {
        if (href === "#new-project") {
          const b = h("button", { class: "link", onclick: () => { closeDropdown(); window.dispatchEvent(new CustomEvent("desk:new-project")); } }, text);
          panel.appendChild(b);
        } else {
          panel.appendChild(h("a", { href, onclick: () => closeDropdown() }, text));
        }
      }
    }
    navEl.classList.add("dd-open");
    navEl.appendChild(panel);
    btn.setAttribute("aria-expanded", "true");
    openDropdown = { btn, panel, nav: navEl };
    const first = panel.querySelector<HTMLElement>("a, button");
    if (first) setTimeout(() => first.focus(), 0);
  }

  function rebuildNav(projects: Project[]): void {
    clearEl(nav);
    const gs = groups(projects);
    for (const g of gs) {
      const wrap = h("div", { style: "position:relative" });
      const btn = h("button", { class: "header-nav-btn", "aria-expanded": "false", "aria-haspopup": "true" }, g.name, h("span", { class: "chev", html: icon("chev", 12) }));
      btn.addEventListener("click", () => openMega(btn, wrap, g.name, g.groups));
      btn.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "ArrowDown" && btn.getAttribute("aria-expanded") === "true") {
          ev.preventDefault();
          const first = wrap.querySelector<HTMLElement>(".mega a, .mega button");
          if (first) first.focus();
        }
      });
      wrap.appendChild(btn);
      if (g.name === "Branches") {
        btn.addEventListener("click", async () => {
          // fill live open branches per project at open time
          const filled: Array<{ label: string; links: Array<[string, string]> }> = [];
          for (const p of projects) {
            try {
              const data = await api<{ branches: Array<{ name: string; state: string; is_main: boolean }> }>(`/api/projects/${p.slug}/branches`);
              const links = data.branches.filter((b) => !b.is_main && (b.state === "open" || b.state === "in_review")).map((b) => [`${b.name}`, `/projects/${p.slug}?branch=${encodeURIComponent(b.name)}`] as [string, string]);
              filled.push({ label: p.name, links });
            } catch {
              filled.push({ label: p.name, links: [] });
            }
          }
          openMega(btn, wrap, g.name, filled);
        }, { once: true });
      }
      nav.appendChild(wrap);
    }
  }

  rebuildNav(ctx.projects);

  // audit link, target language, sign out, new project, import
  if (isOwner) {
    actions.appendChild(h("a", { class: "btn-ghost btn hide-mob", href: "/audit" }, "Audit log"));
  }
  const langBtn = h("button", { class: "icon-btn", "aria-haspopup": "menu", "aria-label": "Target language", title: "Target language", html: icon("globe") });
  actions.appendChild(langBtn);
  actions.appendChild(h("button", { class: "btn-ghost btn hide-mob", onclick: signOut }, "Sign out"));
  if (isOwner) {
    const importBtn = h("a", { class: "btn btn-outline btn-sm hide-mob", href: "#", onclick: (e: Event) => {
      e.preventDefault();
      const slug = ctx.currentProjectSlug() || (ctx.projects[0] ? ctx.projects[0].slug : null);
      if (slug) location.assign(`/projects/${slug}/tm`);
    } }, "Import");
    actions.appendChild(importBtn);
    actions.appendChild(h("button", { class: "btn btn-primary hide-mob", onclick: () => window.dispatchEvent(new CustomEvent("desk:new-project")) }, "New project"));
  }
  inner.appendChild(nav);
  inner.appendChild(h("span", { class: "spacer" }));
  inner.appendChild(actions);

  // mobile hamburger
  const burger = h("button", { class: "icon-btn hide-desk", "aria-label": "Open menu", html: icon("menu") });
  burger.addEventListener("click", () => openMenuSheet());
  inner.appendChild(burger);

  // target language menu
  let langMenu: HTMLElement | null = null;
  let langItems: Array<{ lang: string; el: HTMLElement }> = [];
  langBtn.addEventListener("click", () => {
    if (langMenu) { closeLangMenu(true); return; }
    const slug = ctx.currentProjectSlug();
    const project = ctx.projects.find((p) => p.slug === slug);
    const targets = project ? project.target_languages : [];
    if (targets.length === 0) return;
    langMenu = h("div", { class: "mega", role: "menu", "aria-label": langMenuName, style: "position:absolute;right:0;top:100%" });
    langItems = targets.map((lang) => {
      const current = ctx.currentLanguage() === lang;
      const item = h("button", { class: "mega-item", role: "menuitemradio", "aria-checked": current ? "true" : "false", onclick: () => { ctx.onLanguageChange(lang); closeLangMenu(true); } }, lang);
      item.style.cssText = "display:flex;width:100%;padding:10px 12px;border-radius:9px;text-align:left;font-weight:600";
      if (current) item.style.background = "var(--band)";
      langMenu!.appendChild(item);
      return { lang, el: item };
    });
    const holder = langBtn.parentElement!;
    holder.appendChild(langMenu);
    langBtn.setAttribute("aria-expanded", "true");
    setTimeout(() => langItems[0]?.el.focus(), 0);
  });
  langBtn.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "ArrowDown" && langMenu) { ev.preventDefault(); langItems[0]?.el.focus(); }
  });

  function closeLangMenu(focusBtn = false): void {
    if (!langMenu) return;
    langMenu.remove();
    langMenu = null;
    langBtn.setAttribute("aria-expanded", "false");
    if (focusBtn) restoreFocus(langBtn);
  }

  document.addEventListener("click", (ev) => {
    const target = ev.target as Node;
    if (langMenu && !langMenu.contains(target) && !langBtn.contains(target)) closeLangMenu();
    if (openDropdown) {
      if (!openDropdown.panel.contains(target) && !openDropdown.btn.contains(target)) closeDropdown();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (langMenu) { closeLangMenu(true); }
      if (openDropdown) { closeDropdown(true); }
    }
    if (langMenu && langItems.length) {
      const idx = langItems.findIndex((i) => i.el === document.activeElement);
      if (ev.key === "ArrowDown") { ev.preventDefault(); langItems[(idx + 1) % langItems.length].el.focus(); }
      if (ev.key === "ArrowUp") { ev.preventDefault(); langItems[(idx - 1 + langItems.length) % langItems.length].el.focus(); }
    }
  });

  async function signOut(): Promise<void> {
    try { await api("/api/session", { method: "DELETE" }); } catch { /* ignore */ }
    location.assign("/");
  }

  // mobile menu sheet
  function openMenuSheet(): void {
    const projects = ctx.projects;
    const close = () => { sheet.remove(); document.body.classList.remove("no-scroll"); restoreFocus(burger); };
    const sheet = h("div", { class: "menu-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Menu" });
    const closeBtn = h("button", { class: "btn btn-outline btn-block", onclick: close }, "Close menu");
    const closeRow = h("div", { class: "close-row" }, closeBtn);
    sheet.appendChild(closeRow);

    const groupsData = groups(projects).filter((g) => g.name !== "Branches");
    const accordions = groupsData.map((g) => {
      const panel = h("div", { class: "acc-panel", hidden: true });
      for (const grp of g.groups) {
        for (const [text, href] of grp.links) {
          if (href === "#new-project") panel.appendChild(h("button", { class: "link", onclick: () => { close(); window.dispatchEvent(new CustomEvent("desk:new-project")); } }, text));
          else panel.appendChild(h("a", { href, onclick: close }, text));
        }
      }
      const btn = h("button", { class: "acc-btn", "aria-expanded": "false", onclick: (e: Event) => {
        const b = e.currentTarget as HTMLElement;
        const open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", open ? "false" : "true");
        (b.nextElementSibling as HTMLElement).hidden = open;
      } }, g.name, h("span", { class: "chev", html: icon("chev", 14) }));
      return h("div", { class: "acc-group" }, btn, panel);
    });
    for (const a of accordions) sheet.appendChild(a);

    const bottom = h("div", { class: "bottom" });
    if (isOwner) bottom.appendChild(h("button", { class: "btn btn-primary btn-block", onclick: () => { close(); window.dispatchEvent(new CustomEvent("desk:new-project")); } }, "New project"));
    bottom.appendChild(h("button", { class: "btn btn-outline btn-block", onclick: signOut }, "Sign out"));
    sheet.appendChild(bottom);
    document.body.appendChild(sheet);
    document.body.classList.add("no-scroll");
    closeBtn.focus();
    sheet.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); close(); }
    });
  }

  // service status region
  const statusRegion = h("div", { role: "region", "aria-label": "Service status" });
  const notice = buildNotice();
  return { header, statusRegion, notice, refresh };
}

export function buildNotice(): HTMLElement {
  const KEY = "desk_notice_hidden";
  const root = h("aside", { role: "region", "aria-label": "Cookie and data notice", class: "notice" });
  const body = h("p", { class: "body" }, "Interline Desk sets one session cookie to keep you signed in. No tracking or advertising cookies.");
  const more = h("p", { class: "more", hidden: true }, "Your choice to hide this notice is remembered in this browser only.");
  const detailsBtn = h("button", { class: "btn btn-outline btn-sm", onclick: () => { more.hidden = !more.hidden; } }, "Details");
  const gotIt = h("button", { class: "btn btn-primary btn-sm", onclick: () => { localStorage.setItem(KEY, "1"); root.remove(); } }, "Got it");
  root.appendChild(body);
  root.appendChild(more);
  root.appendChild(h("div", { class: "row" }, detailsBtn, gotIt));
  if (localStorage.getItem(KEY) === "1") root.remove();
  return root;
}

export interface ServiceStatus { git_host: string; ai_engine: string; webhooks: string; }

export async function fetchServiceStatus(): Promise<ServiceStatus | null> {
  try {
    return await api<ServiceStatus>("/api/integrations");
  } catch (e) {
    if (e instanceof RequestError && e.status === 401) return null;
    return { git_host: "down", ai_engine: "down", webhooks: "down" };
  }
}

export function renderServiceBanners(container: HTMLElement, st: ServiceStatus | null, fb: Feedback, announced: Set<string>): void {
  clearEl(container);
  if (!st) return;
  const banners: Array<[string, string]> = [];
  if (st.git_host === "down") banners.push(["Repository host outage", "The repository host isn't answering. Publishing will fail until it's back; your strings are safe here."]);
  if (st.ai_engine === "down") banners.push(["AI engine outage", "The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated."]);
  if (st.webhooks === "down") banners.push(["Webhook outage", "Webhook delivery is paused. Events are kept and sent once the service is back."]);
  for (const [label, text] of banners) {
    container.appendChild(h("div", { class: "banner" }, h("div", null, h("div", { class: "label" }, label)), h("p", {}, text)));
    if (!announced.has(label)) { fb.setProblem(text); announced.add(label); }
  }
}
