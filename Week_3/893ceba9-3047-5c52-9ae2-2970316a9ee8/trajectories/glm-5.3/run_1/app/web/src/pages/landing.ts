import { PageCtx } from "../main";
import { h } from "../ui";
import { heroCollage, hubDiagram, icon, logoMark } from "../illustrations";

const SEC_ITEMS: Array<[string, string]> = [
  ["One session cookie", "A single HttpOnly session cookie keeps you signed in, and nothing tracks you across pages."],
  ["Files kept as submitted", "Every imported file is stored byte for byte as you uploaded it, so the original is never lost."],
  ["Exact restore", "Roll an import or a merge back to the earlier state, with every score and comment intact."],
  ["Erasure on request", "Erasing a client removes its rows, files, tokens and webhook application in one action."],
  ["Signed webhooks", "Publish and review events are signed by the webhook service and retried until your CI acknowledges them."],
  ["Scoped reviewer access", "Invited reviewers see only the projects they were invited to, and act only on their own segments."],
  ["Per-project CI tokens", "Each project's CI pulls its approved locale files with its own bearer token and nothing else."],
  ["Six-month audit log", "Every state change writes one audit entry, kept for six months and exportable as a formula-safe CSV."],
  ["Formula-safe exports", "The audit CSV neutralises formula cells, so the export opens safely in any spreadsheet."],
  ["Same-origin only", "The browser talks only to the app's own origin, with no third-party scripts or fonts loaded."],
  ["Your own storage", "Postgres holds the records and your own S3-compatible bucket holds the files."],
  ["No trackers", "No analytics, no advertising and no third-party requests, on any screen."],
];

export async function renderLandingPage(ctx: PageCtx): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";

  const header = h("header", { class: "site-header" });
  const inner = h("div", { class: "container inner" });
  const logo = h("a", { class: "logo", href: "/" });
  logo.innerHTML = logoMark() + "<span>Interline Desk</span>";
  inner.appendChild(logo);
  inner.appendChild(h("span", { class: "spacer" }));
  inner.appendChild(h("a", { class: "btn-ghost btn", href: "/sign-in" }, "Sign in"));
  inner.appendChild(h("a", { class: "btn btn-primary", href: "/desk" }, "Open the demo desk"));
  header.appendChild(inner);

  const hero = h("section", { class: "hero" });
  const grid = h("div", { class: "container hero-grid" });
  const copy = h("div", { class: "hero-copy" });
  copy.appendChild(h("h1", {}, h("span", {}, "Keep every string."), h("span", {}, "Branch without losing one."), h("span", {}, "Publish what you approved.")));
  copy.appendChild(h("p", { class: "lead" }, "Translation memory, branches, AI drafts and MQM review for the engineer who runs several client apps alone."));
  copy.appendChild(h("div", { class: "cta" }, h("a", { class: "btn btn-primary", href: "/desk" }, "Open the demo desk")));
  grid.appendChild(copy);
  const collage = h("div", { class: "hero-collage-wrap" });
  collage.innerHTML = heroCollage();
  grid.appendChild(collage);
  hero.appendChild(grid);

  const whoRegion = h("section", { class: "section band", role: "region", "aria-label": "Who works here" });
  const whoContainer = h("div", { class: "container" });
  whoContainer.appendChild(h("h2", { class: "visually-hidden" }, "Who works here"));
  const cards = h("div", { class: "grid-2" });
  cards.appendChild(personaCard(
    "The engineer's desk",
    "The localization engineer who runs every client project",
    "One desk holds each client's keys, a working copy per feature branch, a translation memory per project, AI drafts routed per language, and publishing to the client's repository.",
    ["Exact matches reuse before any AI call", "Merges never silently overwrite a string", "Every import and merge can be rolled back", "One audit entry for every state change"],
  ));
  cards.appendChild(personaCard(
    "The client reviewer's queue",
    "The invited linguist or product owner who reviews from a phone",
    "A reviewer signs in with a one-time access key, sees only the projects they were invited to, and works a keyboard-complete queue of the segments assigned to them.",
    ["Only the projects they were invited to", "Only the segments assigned to them", "Approve or correct in two keystrokes", "Works entirely from a phone"],
  ));
  whoContainer.appendChild(cards);
  whoRegion.appendChild(whoContainer);

  const secRegion = h("section", { class: "section", role: "region", "aria-label": "Security and hosting" });
  const secContainer = h("div", { class: "container" });
  secContainer.appendChild(h("div", { style: "text-align:center;margin-bottom:40px" },
    h("h2", { style: "margin:0" }, "How your clients' strings are kept"),
    h("p", { class: "muted", style: "margin-top:10px" }, "A quiet posture, stated plainly, with nothing hidden behind a team plan."),
  ));
  const gridSec = h("div", { class: "sec-grid" });
  for (const [title, body] of SEC_ITEMS) {
    gridSec.appendChild(h("div", { class: "sec-item" },
      h("span", { class: "icon-tile plain", html: glyphFor(title) }),
      h("div", {}, h("h4", {}, title), h("p", {}, body)),
    ));
  }
  secContainer.appendChild(gridSec);
  secContainer.appendChild(h("div", { style: "display:flex;justify-content:center;margin-top:44px" }, h("a", { class: "btn btn-primary", href: "/desk" }, "Open the demo desk")));
  secRegion.appendChild(secContainer);

  const footer = h("footer", { class: "site-footer" });
  footer.appendChild(h("div", { class: "container inner" },
    h("span", {}, "Interline Desk — a translation desk for one engineer and several client apps."),
    h("span", {}, "Marlow & Quill Language Works"),
  ));

  main.appendChild(header);
  main.appendChild(hero);
  main.appendChild(whoRegion);
  main.appendChild(secRegion);
  main.appendChild(footer);
}

function personaCard(title: string, audience: string, body: string, matters: string[], illusHtml?: string): HTMLElement {
  const card = h("article", { class: "card" });
  const illusWrap = h("div", { class: "card-illus" });
  illusWrap.innerHTML = illusHtml || hubDiagram({ repository: "larkspur-cycles/rider-app", tmCount: 6, routes: [["de", "lexa-general"], ["fr", "lexa-general"], ["ja", "lexa-formal"]] });
  card.appendChild(illusWrap);
  card.appendChild(h("h3", { style: "margin-top:18px" }, title));
  card.appendChild(h("p", { class: "lead", style: "font-size:1.02em;margin-top:6px" }, audience));
  card.appendChild(h("p", { class: "muted", style: "margin-top:12px" }, body));
  const list = h("ul", { class: "matters-list" });
  for (const m of matters) list.appendChild(h("li", {}, m));
  card.appendChild(list);
  card.appendChild(h("a", { class: "btn btn-outline btn-sm", style: "margin-top:18px;align-self:flex-start", href: "/desk" }, "Open the demo desk", h("span", { class: "arrow", html: icon("arrow", 15) })));
  return card;
}

function glyphFor(title: string): string {
  const glyphs: Record<string, string> = {
    "One session cookie": icon("globe", 20),
    "Files kept as submitted": icon("doc", 20),
    "Exact restore": icon("undo", 20),
    "Erasure on request": icon("trash", 20),
    "Signed webhooks": icon("bolt", 20),
    "Scoped reviewer access": icon("user", 20),
    "Per-project CI tokens": icon("key", 20),
    "Six-month audit log": icon("list", 20),
    "Formula-safe exports": icon("table", 18),
    "Same-origin only": icon("lock", 20),
    "Your own storage": icon("bucket", 20),
    "No trackers": icon("shield", 20),
  };
  return glyphs[title] || icon("globe", 20);
}
