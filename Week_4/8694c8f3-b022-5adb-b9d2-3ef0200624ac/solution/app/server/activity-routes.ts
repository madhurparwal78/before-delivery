import { requireMember } from "./access.ts";
import { activityPage } from "./activity.ts";
import type { Database } from "./db.ts";
import { validation, writeJson } from "./errors.ts";
import type { Router } from "./http.ts";
import { integerParam } from "./http.ts";

export class ActivityRoutes {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  register(router: Router): void {
    router.add("GET", "/api/sets/:id/activity", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const before = integerParam(ctx.url, "before");
      if (before === null) throw validation({ before: "Before must be an entry id" });
      writeJson(ctx.res, 200, { entries: await activityPage(this.db, membership.setId, before ?? null) });
    });
  }
}
