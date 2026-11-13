// `contentinfo`: dense dark footer. Link columns Work, Delivery, Planning and Account (four columns, two on phones), a 1 px
// rule and the legal line `Coldbrook Signal Works · Spurline`. Every link is a real route: project links use the project of the
// current page, or else the first project from GET /api/me/projects. Signed-out pages only list Account (sign in, sign up).
import { useLayoutEffect } from "preact/hooks";
import { api } from "../api.ts";
import { A, useRoute } from "../router.ts";
import { useUser } from "../session.ts";
import { createStore, useStore } from "../store.ts";
import { asNumber, isRecord } from "../util.ts";

const firstProject = createStore<{ id: number | null; asked: boolean }>({ id: null, asked: false });

function askForProject(): void {
  if (firstProject.get().asked) return;
  firstProject.set({ id: null, asked: true });
  api.get<unknown>("/api/me/projects").then(
    (body) => {
      const list = isRecord(body) && Array.isArray(body.projects) ? body.projects : [];
      const first = list.find(isRecord);
      firstProject.set({ id: first ? asNumber(first.id) : null, asked: true });
    },
    () => firstProject.set({ id: null, asked: false }),
  );
}

interface FooterLink {
  label: string;
  href: string;
}

function columns(projectId: string | null): Array<{ title: string; links: FooterLink[] }> {
  const root = projectId === null ? null : `/projects/${projectId}`;
  const choose: FooterLink = { label: "Choose a project", href: "/" };
  return [
    {
      title: "Work",
      links: [
        { label: "Projects", href: "/" },
        { label: "Search", href: "/search?scope=code&q=" },
        ...(root ? [{ label: "Browse files", href: `${root}/-/files` }, { label: "Revisions", href: `${root}/-/commits` }] : []),
      ],
    },
    {
      title: "Delivery",
      links: root
        ? [
            { label: "Merge requests", href: `${root}/-/merge_requests` },
            { label: "Pipelines", href: `${root}/-/pipelines` },
            { label: "Environments", href: `${root}/-/environments` },
            { label: "Delivery metrics", href: `${root}/-/metrics` },
          ]
        : [choose],
    },
    {
      title: "Planning",
      links: root ? [{ label: "Issues", href: `${root}/-/issues` }, { label: "Wiki", href: `${root}/-/wiki/home` }] : [choose],
    },
    {
      title: "Account",
      links: root
        ? [
            { label: "Project settings", href: `${root}/-/settings` },
            { label: "Audit events", href: `${root}/-/audit` },
            { label: "Export", href: `${root}/-/export` },
            { label: "Import", href: `${root}/-/import` },
          ]
        : [choose],
    },
  ];
}

export function Footer({ signedOut }: { signedOut: boolean }) {
  const user = useUser();
  const route = useRoute();
  const known = useStore(firstProject);
  const bare = signedOut || !user;
  const fromRoute = route.pattern.startsWith("/projects/:id") ? (route.params.id ?? null) : null;
  useLayoutEffect(() => {
    if (!bare && fromRoute === null) askForProject();
  }, [bare, fromRoute]);
  const projectId = fromRoute ?? (known.id === null ? null : String(known.id));
  const groups = bare
    ? [{ title: "Account", links: [{ label: "Sign in", href: "/sign-in" }, { label: "Create account", href: "/sign-up" }] }]
    : columns(projectId);
  return (
    <footer class="sp-footer">
      <div class="sp-container">
        <nav aria-label="Footer" class="sp-footer__columns">
          {groups.map((group) => (
            <div key={group.title} class="sp-footer__column">
              <h2 class="sp-footer__heading">{group.title}</h2>
              <ul>
                {group.links.map((link) => (
                  <li key={link.label}>
                    <A href={link.href}>{link.label}</A>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <hr class="sp-footer__rule" />
        <p class="sp-footer__legal">Coldbrook Signal Works · Spurline</p>
      </div>
    </footer>
  );
}
