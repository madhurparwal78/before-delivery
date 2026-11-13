// The reports of a request: test summary, coverage, code quality and security findings (DP-44).
import { intParam, json, type Router } from "../http.ts";
import { withTx } from "../db.ts";
import * as repo from "../repo/index.ts";
import { reportsForRequest } from "../ci/index.ts";
import { openRequest } from "./store.ts";

export function registerReportRoutes(router: Router): void {
  router.get("/api/projects/:id/merge_requests/:iid/reports", (ctx) =>
    withTx(async (tx) => {
      const { project, mr } = await openRequest(tx, ctx.user, intParam(ctx, "id"), intParam(ctx, "iid"), "mr.read");
      const sourceHead = await repo.branchHead(tx, project.id, mr.source);
      const targetHead = await repo.branchHead(tx, project.id, mr.target);
      const mergeBaseSha = sourceHead !== null && targetHead !== null ? await repo.mergeBase(tx, project.id, targetHead, sourceHead) : null;
      const reports = await reportsForRequest(tx, { project, mrId: mr.id, headSha: sourceHead ?? "", mergeBaseSha, target: mr.target });
      return json(200, reports);
    }),
  );
}
