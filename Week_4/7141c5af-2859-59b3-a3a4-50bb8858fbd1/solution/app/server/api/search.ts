import { copy } from "../domain/copy.ts";
import { unavailable } from "../http/errors.ts";
import { json, route } from "../http/router.ts";
import { ProviderDown } from "../providers/call.ts";
import { searchEntries } from "../providers/meili.ts";

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/search",
    handle: async (ctx) => {
      const q = ctx.query.get("q") ?? "";
      if (q.trim() === "") return json(200, { results: [] });
      try {
        const entries = await searchEntries(ctx.deskId, q);
        return json(200, { results: entries.map((entry) => ({ kind: entry.kind, id: entry.refId, label: entry.label, href: entry.href })) });
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("searchDown", copy("F-17"));
        throw error;
      }
    },
  });
}
