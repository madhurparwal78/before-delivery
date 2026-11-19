import { findPage, hasEnded, pageBody } from "../api/clientPages.ts";
import { one } from "../db/pool.ts";
import { clientCopy, clientDate } from "../domain/copy.ts";
import { type Language, directionOf } from "../domain/towns.ts";
import { html, route } from "../http/router.ts";
import { document, escapeHtml } from "./document.ts";
import { notFoundPage } from "./notFound.ts";
import { noteHtml } from "./noteHtml.ts";

type PageBody = Awaited<ReturnType<typeof pageBody>>;

const KIND_COPY = { tear: "C43", crack: "C44", stain: "C45", looseJoint: "C46", woodworm: "C47" } as const;

/** The whole reading of the page in the first response, in its language with no script run. */
function firstResponse(page: PageBody, language: Language): string {
  const say = (id: Parameters<typeof clientCopy>[0]): string => escapeHtml(clientCopy(id, language));
  const notes = page.notes.map((note) => `<li><strong>${say(KIND_COPY[note.kind as keyof typeof KIND_COPY])}</strong> ${noteHtml(note.note)}</li>`).join("");
  const estimate = page.estimate
    ? `<dl><dt>${say("C36")}</dt><dd>${escapeHtml(page.estimate.subtotal)}</dd><dt>${say("C37")}</dt><dd>${escapeHtml(page.estimate.tax)}</dd><dt>${say("C38")}</dt><dd>${escapeHtml(page.estimate.total)}</dd></dl>`
    : `<p>${say("C41")}</p>`;
  const due = page.dueDate ? `<p>${escapeHtml(clientCopy("C19", language, { date: clientDate(page.dueDate, language) }))}</p>` : "";
  return `<div id="app"><main id="main"><h1 tabindex="-1">${say("C01")}</h1>${due}
<section><h2>${say("C42")}</h2>${notes ? `<ul>${notes}</ul>` : `<p>${say("C51")}</p>`}</section>
<section><h2>${say("C05")}</h2>${estimate}</section></main></div>`;
}

function endedDocument(language: Language): string {
  const heading = clientCopy("C20", language);
  return document({
    title: heading,
    lang: language,
    dir: directionOf(language),
    script: "public",
    announcements: clientCopy("C24", language),
    body: `<main id="main"><h1 tabindex="-1">${escapeHtml(heading)}</h1></main>`,
  });
}

export function register(): void {
  route({
    method: "GET",
    pattern: "/c/:token",
    access: "public",
    handle: async (ctx) => {
      const token = ctx.params.token as string;
      const found = await findPage(token);
      if (!found) return html(404, notFoundPage());
      if (hasEnded(found)) return html(410, endedDocument(found.language));
      const page = await pageBody(found);
      const sides = await one<{ before: boolean; after: boolean }>(
        `SELECT bool_or(side = 'before') IS TRUE AS before, bool_or(side = 'after') IS TRUE AS after FROM photographs WHERE piece_id = $1 AND state = 'stored'`,
        [found.piece_id],
      );
      return html(
        200,
        document({
          title: clientCopy("C01", found.language),
          lang: found.language,
          dir: page.dir === "rtl" ? "rtl" : "ltr",
          script: "client",
          announcements: clientCopy("C24", found.language),
          body: firstResponse(page, found.language),
          boot: { token, page, photographs: sides },
        }),
      );
    },
  });
}
