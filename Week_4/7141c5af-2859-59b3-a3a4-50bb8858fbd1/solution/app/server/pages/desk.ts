import { findClient } from "../api/clients.ts";
import { findPiece } from "../api/resources.ts";
import { turinToday } from "../domain/time.ts";
import { type Ctx, html, redirect, type Reply, route } from "../http/router.ts";
import { document } from "./document.ts";
import { notFoundPage } from "./notFound.ts";

const SUFFIX = " — Semenza Desk";

/** Finds a page's heading text, or null for an address this desk has no record for. */
type Heading = (ctx: Ctx) => Promise<string | null>;

function shell(ctx: Ctx, heading: string): Reply {
  const session = ctx.session as NonNullable<Ctx["session"]>;
  return html(200, document({
    title: `${heading}${SUFFIX}`,
    script: "desk",
    body: `<div id="app"></div>`,
    fonts: true,
    boot: { session: { deskId: session.deskId, name: session.name, email: session.email, today: turinToday() } },
  }));
}

function deskPage(pattern: string, heading: Heading): void {
  route({
    method: "GET",
    pattern,
    access: "public",
    handle: async (ctx) => {
      if (!ctx.session) {
        const search = ctx.query.toString();
        return redirect(`/sign-in?returnTo=${encodeURIComponent(`${ctx.path}${search ? `?${search}` : ""}`)}`);
      }
      const text = await heading(ctx);
      return text === null ? html(404, notFoundPage()) : shell(ctx, text);
    },
  });
}

function pieceHeading(prefix: string): Heading {
  return async (ctx) => {
    const piece = await findPiece(ctx.deskId, ctx.params.id as string);
    return piece ? `${prefix}${piece.title}` : null;
  };
}

export function register(): void {
  for (const [path, heading] of [
    ["/pieces", "Pieces"],
    ["/clients", "Clients"],
    ["/library", "Material library"],
    ["/bench", "Bench"],
    ["/workbook", "Old workbook"],
    ["/rates", "Labour rates"],
  ] as const) {
    deskPage(path, async () => heading);
  }
  deskPage("/pieces/:id", pieceHeading(""));
  for (const [sub, prefix] of [
    ["condition", "Condition of "],
    ["photographs", "Photographs of "],
    ["hide", "Hide for "],
    ["estimate", "Estimate for "],
    ["collection", "Collection of "],
    ["dossier", "Dossier for "],
  ] as const) {
    deskPage(`/pieces/:id/${sub}`, pieceHeading(prefix));
  }
  deskPage("/clients/:id", async (ctx) => (await findClient(ctx.deskId, ctx.params.id as string))?.name ?? null);
}
