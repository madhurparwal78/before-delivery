import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronDown, Globe } from "lucide-preact";
import { ApiError, api, type Project } from "./api";
import { Link, navigate, projectHref, setQuery, useRoute } from "./router";
import {
  act, complain, integrationsStore, loadProjects, projectsStore, say, sessionStore, useStore,
} from "./store";
import { Button, Dialog, Field, LinkButton, LiveRegions, cx, focusFirstError, useOutside } from "./ui";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useLayoutEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="Interline Desk">
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#09090B" />
        <circle cx="16" cy="9.5" r="2.7" fill="#fff" /><rect x="13.4" y="14.5" width="5.2" height="11" rx="2.6" fill="#fff" />
      </svg>
      <span className="logo-text">Interline Desk</span>
    </Link>
  );
}

function useScrolled(offset: number): boolean {
  const [scrolled, setScrolled] = useState(window.scrollY > offset);
  useLayoutEffect(() => {
    const on = () => setScrolled(window.scrollY > offset);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [offset]);
  return scrolled;
}

/** The simplified sticky header of the public pages. */
export function PublicHeader() {
  const scrolled = useScrolled(10);
  return (
    <header className="site-header" data-scrolled={scrolled}>
      <div className="header-inner header-public">
        <Logo />
        <div className="header-actions">
          <Link href="/sign-in" className="text-link">Sign in</Link>
          <LinkButton variant="primary" href="/sign-in">Open the demo desk</LinkButton>
        </div>
      </div>
    </header>
  );
}

function projectSlugOf(path: string): string | null {
  const m = /^\/projects\/([^/]+)/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

const GROUPS = ["Projects", "Branches", "Review", "Workspace"] as const;
type Group = (typeof GROUPS)[number];

function GroupLinks({ group, projects, onNavigate }: { group: Group; projects: Project[]; onNavigate: () => void }) {
  if (group === "Projects") {
    const byClient = new Map<string, Project[]>();
    projects.forEach((p) => byClient.set(p.client, [...(byClient.get(p.client) ?? []), p]));
    return (
      <>
        {[...byClient].map(([client, list]) => (
          <div key={client} className="mega-group">
            <p className="mega-title">{client}</p>
            <ul>{list.map((p) => <li key={p.id}><Link href={projectHref(p.slug)} onClick={onNavigate}>{p.name}</Link></li>)}</ul>
          </div>
        ))}
      </>
    );
  }
  if (group === "Branches") {
    const withBranches = projects.filter((p) => (p.branches ?? []).length > 0);
    if (!withBranches.length) return <p className="mega-note">No open branches.</p>;
    return (
      <>
        {withBranches.map((p) => (
          <div key={p.id} className="mega-group">
            <p className="mega-title">{p.name}</p>
            <ul>{(p.branches ?? []).map((b) => (
              <li key={b.name}><Link href={projectHref(p.slug, "", { branch: b.name })} onClick={onNavigate}>{b.name}</Link></li>
            ))}</ul>
          </div>
        ))}
      </>
    );
  }
  if (group === "Review") {
    return <div className="mega-group"><ul><li><Link href="/review" onClick={onNavigate}>Review queue</Link></li></ul></div>;
  }
  return (
    <>
      {projects.map((p) => (
        <div key={p.id} className="mega-group">
          <p className="mega-title">{p.name}</p>
          <ul>
            <li><Link href={projectHref(p.slug, "tm")} onClick={onNavigate}>Translation memory</Link></li>
            <li><Link href={projectHref(p.slug, "settings")} onClick={onNavigate}>Settings</Link></li>
          </ul>
        </div>
      ))}
    </>
  );
}

function NavGroup({ group, projects, open, onToggle, onClose }: { group: Group; projects: Project[]; open: boolean; onToggle: (open: boolean) => void; onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [wantFocus, setWantFocus] = useState(false);
  useOutside(wrap, onClose, open);
  useLayoutEffect(() => {
    if (open && wantFocus) {
      panel.current?.querySelector("a")?.focus();
      setWantFocus(false);
    }
  }, [open, wantFocus]);
  const id = `mega-${group.toLowerCase()}`;
  return (
    <div className="nav-item" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="nav-button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onToggle(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (open) panel.current?.querySelector("a")?.focus();
            else {
              onToggle(true);
              setWantFocus(true);
            }
          } else if (e.key === "Escape" && open) {
            onClose();
          }
        }}
      >
        {group}
        <ChevronDown className="chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <nav
          id={id}
          ref={panel}
          className="mega"
          aria-label={group}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
              button.current?.focus();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              const links = [...panel.current!.querySelectorAll("a")];
              const at = links.indexOf(document.activeElement as HTMLAnchorElement);
              const next = links[(at + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length];
              e.preventDefault();
              next?.focus();
            }
          }}
        >
          <GroupLinks group={group} projects={projects} onNavigate={onClose} />
          {group === "Projects" && <NewProjectButton onClick={onClose} />}
        </nav>
      )}
    </div>
  );
}

const newProjectRequest = { open: () => {} };

function NewProjectButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="mega-foot">
      <Button variant="outline" onClick={() => { onClick(); newProjectRequest.open(); }}>New project</Button>
    </div>
  );
}

function useLanguages(projects: Project[], slug: string | null, path: string): string[] {
  return useMemo(() => {
    if (slug) return projects.find((p) => p.slug === slug)?.target_languages ?? [];
    if (path === "/review") return [...new Set(projects.flatMap((p) => p.target_languages))];
    return [];
  }, [projects, slug, path]);
}

function LanguageMenu({ languages, enabled }: { languages: string[]; enabled: boolean }) {
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useOutside(wrap, () => setOpen(false), open);
  const current = route.query.get("lang") ?? languages[0] ?? "";
  return (
    <div className="nav-item lang-menu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn btn-outline btn-icon"
        aria-label="Target language"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!enabled}
        onClick={() => setOpen(!open)}
      >
        <Globe size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Target language"
          className="mega mega-right"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          {languages.map((lang) => (
            <button
              key={lang}
              type="button"
              role="menuitemradio"
              aria-checked={lang === current}
              className="menu-radio"
              onClick={() => { setQuery({ lang }); setOpen(false); button.current?.focus(); }}
            >
              {lang}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ slug: "", name: "", client: "", source_language: "en", target_languages: "", repository: "", mqm_threshold: "90" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLFormElement>(null);
  const set = (key: keyof typeof form) => (e: Event) => setForm({ ...form, [key]: (e.target as HTMLInputElement).value });
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      slug: form.slug, name: form.name, client: form.client, source_language: form.source_language,
      target_languages: form.target_languages.split(",").map((s) => s.trim()).filter(Boolean),
      repository: form.repository, mqm_threshold: form.mqm_threshold === "" ? undefined : Number(form.mqm_threshold),
    };
    const out = await act("Creating project.", () => api<Project>("POST", "/api/projects", body), (p) => `Created ${p.name}.`);
    setBusy(false);
    if (out.ok) {
      await loadProjects();
      onClose();
      navigate(projectHref(out.value.slug));
      return;
    }
    const fields = out.error.code === "slug_taken" ? { slug: "That slug is already used by another project." } : out.error.fields;
    setErrors(fields);
    focusFirstError(root.current);
  };
  const nameOf = (field: string) => errors[field];
  return (
    <Dialog title="New project" onClose={onClose}>
      <form ref={root} onSubmit={submit} noValidate className="stack">
        <Field label="Slug" error={nameOf("slug")} hint="Lowercase letters, digits and hyphens.">{(p) => <input {...p} type="text" value={form.slug} onInput={set("slug")} autocomplete="off" />}</Field>
        <Field label="Project name" error={nameOf("name")}>{(p) => <input {...p} type="text" value={form.name} onInput={(e) => {
          const name = (e.target as HTMLInputElement).value;
          setForm({ ...form, name, slug: form.slug === slugify(form.name) ? slugify(name) : form.slug });
        }} />}</Field>
        <Field label="Client" error={nameOf("client")}>{(p) => <input {...p} type="text" value={form.client} onInput={set("client")} />}</Field>
        <Field label="Source language" error={nameOf("source_language")}>{(p) => <input {...p} type="text" value={form.source_language} onInput={set("source_language")} autocomplete="off" />}</Field>
        <Field label="Target languages" error={nameOf("target_languages")} hint="Comma-separated codes, such as de, fr, ja.">{(p) => <input {...p} type="text" value={form.target_languages} onInput={set("target_languages")} autocomplete="off" />}</Field>
        <Field label="Repository" error={nameOf("repository")} hint="Owner and repository, such as acme/app.">{(p) => <input {...p} type="text" value={form.repository} onInput={set("repository")} autocomplete="off" />}</Field>
        <Field label="MQM threshold" error={nameOf("mqm_threshold")}>{(p) => <input {...p} type="number" min={0} max={100} step={1} value={form.mqm_threshold} onInput={set("mqm_threshold")} />}</Field>
        <div className="dialog-actions">
          <Button type="submit" busy={busy}>Create project</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

async function signOut() {
  await api("DELETE", "/api/session").catch(() => undefined);
  sessionStore.set(null);
  projectsStore.set(null);
  say("");
  navigate("/");
}

function MobileMenu({ projects, owner, languages, onClose }: { projects: Project[]; owner: boolean; languages: string[]; onClose: () => void }) {
  const route = useRoute();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const groups = owner ? [...GROUPS] : (["Review"] as Group[]);
  const current = route.query.get("lang") ?? languages[0] ?? "";
  return (
    <Dialog title="Menu" onClose={onClose} className="sheet">
      <div className="sheet-top">
        <Button variant="outline" onClick={onClose}>Close menu</Button>
      </div>
      <div className="sheet-groups">
        {groups.map((g) => (
          <div key={g} className="accordion">
            <button type="button" className="nav-button" aria-expanded={openGroup === g} onClick={() => setOpenGroup(openGroup === g ? null : g)}>
              {g}
              <ChevronDown className="chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {openGroup === g && <div className="accordion-panel"><GroupLinks group={g} projects={projects} onNavigate={onClose} /></div>}
          </div>
        ))}
        {owner && <Link href="/audit" className="sheet-link" onClick={onClose}>Audit log</Link>}
        {languages.length > 0 && (route.path === "/review" || projectSlugOf(route.path)) && (
          <div className="accordion">
            <button type="button" className="nav-button" aria-expanded={openGroup === "lang"} onClick={() => setOpenGroup(openGroup === "lang" ? null : "lang")}>
              Language
              <ChevronDown className="chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {openGroup === "lang" && (
              <div className="accordion-panel" role="group" aria-label="Language">
                {languages.map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={l === current} className="menu-radio" onClick={() => { setQuery({ lang: l }); onClose(); }}>{l}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="sheet-foot">
        {owner && <Button onClick={() => { onClose(); newProjectRequest.open(); }}>New project</Button>}
        <Button variant="outline" onClick={() => { onClose(); void signOut(); }}>Sign out</Button>
      </div>
    </Dialog>
  );
}

function Header() {
  const user = useStore(sessionStore);
  const projects = useStore(projectsStore) ?? [];
  const route = useRoute();
  const narrow = useMediaQuery("(max-width: 767px)");
  const scrolled = useScrolled(10);
  const [openGroup, setOpenGroup] = useState<Group | null>(null);
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const slug = projectSlugOf(route.path);
  const languages = useLanguages(projects, slug, route.path);
  const owner = user?.role === "owner";
  newProjectRequest.open = () => setCreating(true);
  useLayoutEffect(() => { setOpenGroup(null); }, [route.path]);
  const groups = owner ? GROUPS : (["Review"] as const);
  const importProject = slug ?? projects[0]?.slug;
  const langEnabled = route.path === "/review" || (!!slug && /^\/projects\/[^/]+(\/editor)?$/.test(route.path));
  return (
    <header className="site-header" data-scrolled={scrolled}>
      <div className="header-inner">
        <Logo href={owner ? "/desk" : "/review"} />
        {narrow ? (
          <button type="button" className="hamburger" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}>
            <span /><span /><span />
          </button>
        ) : (
          <>
            <div className="nav-groups">
              {groups.map((g) => (
                <NavGroup key={g} group={g} projects={projects} open={openGroup === g} onToggle={(o) => setOpenGroup(o ? g : null)} onClose={() => setOpenGroup(null)} />
              ))}
              {owner && <Link href="/audit" className="nav-link">Audit log</Link>}
            </div>
            <div className="header-actions">
              {owner && <LinkButton variant="outline" href={importProject ? projectHref(importProject, "tm") : "/desk"}>Import</LinkButton>}
              {owner && <Button onClick={() => setCreating(true)}>New project</Button>}
              <LanguageMenu languages={languages} enabled={langEnabled} />
              <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
            </div>
          </>
        )}
      </div>
      {menu && <MobileMenu projects={projects} owner={!!owner} languages={languages} onClose={() => setMenu(false)} />}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </header>
  );
}

const BANNERS = [
  { key: "git_host", label: "Repository host outage", text: "The repository host isn't answering. Publishing will fail until it's back; your strings are safe here." },
  { key: "ai_engine", label: "AI engine outage", text: "The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated." },
  { key: "webhooks", label: "Webhook outage", text: "Webhook delivery is paused. Events are kept and sent once the service is back." },
] as const;

function useIntegrations(): void {
  useLayoutEffect(() => {
    let live = true;
    const probe = async () => {
      try {
        const next = await api<NonNullable<ReturnType<typeof integrationsStore.get>>>("GET", "/api/integrations");
        if (!live) return;
        const before = integrationsStore.get();
        integrationsStore.set(next);
        for (const b of BANNERS) {
          if (next[b.key] === "down" && before?.[b.key] !== "down") complain(b.text);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) sessionStore.set(null);
      }
    };
    void probe();
    const timer = setInterval(probe, 15000);
    return () => { live = false; clearInterval(timer); };
  }, []);
}

function ServiceStatus() {
  const integrations = useStore(integrationsStore);
  return (
    <section className="service-status" aria-label="Service status">
      {BANNERS.filter((b) => integrations?.[b.key] === "down").map((b) => (
        <div key={b.key} className="banner">
          <strong>{b.label}</strong>
          <span>{b.text}</span>
        </div>
      ))}
    </section>
  );
}

/** The frame of every signed-in page: header, service status, live regions, then the page. */
export function Shell({ children, wide }: { children: ComponentChildren; wide?: boolean }) {
  const user = useStore(sessionStore);
  useIntegrations();
  useLayoutEffect(() => { void loadProjects(); }, [user?.id]);
  if (!user) return null;
  return (
    <>
      <Header />
      <ServiceStatus />
      <main className={cx("page", wide && "page-wide")}>
        <LiveRegions />
        {children}
      </main>
    </>
  );
}
