// The train's HTTP surface: the train of a target branch, a car's stored tree, and joining, leaving and merging out of order.
import type { Router } from "../http.ts";
import { intParam, json } from "../http.ts";
import { db, withTx, type Queryable, type Tx } from "../db.ts";
import { onDue } from "../deadlines.ts";
import { findProject, projectScope, requireAction, type Action, type ProjectRow, type UserRow } from "../access.ts";
import { conflict, notFound } from "../errors.ts";
import { getPipelineBrief } from "../ci/index.ts";
import { findMergeRequest } from "../mr/index.ts";
import { snapshot } from "../repo/index.ts";
import { treeIdFromFiles } from "../lib/objects.ts";
import { addToTrain, expireStalledCars, mergeNow, removeFromTrain } from "./operations.ts";
import { carByIid, carByRequest, listCars } from "./store.ts";

async function trainBody(q: Queryable, projectId: number, target: string) {
  const cars = [];
  for (const car of await listCars(q, projectId, target)) {
    const pipeline = car.pipeline_id === null ? null : await getPipelineBrief(q, car.pipeline_id);
    cars.push({ iid: car.mr_iid, position: car.position, sha: car.sha, pipeline_id: car.pipeline_id, pipeline_status: pipeline?.status ?? null });
  }
  return { target, cars };
}

// 404 for an unreadable project, 403 below the action's role, then the project lock; the project is read again under the lock.
async function lockedProject(tx: Tx, user: UserRow, projectId: number, action: Action) {
  const scope = await projectScope(tx, user, projectId);
  requireAction(scope.access, action);
  await tx.lockProject(projectId);
  const project: ProjectRow | undefined = await findProject(tx, projectId);
  if (project === undefined) throw notFound();
  return { project, access: scope.access };
}

export function registerTrainRoutes(router: Router): void {
  onDue(expireStalledCars);

  router.get("/api/projects/:id/train", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "mr.read");
    return json(200, await trainBody(db, project.id, ctx.query.get("target") ?? project.default_branch));
  });

  router.get("/api/projects/:id/train/:iid/tree", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "mr.read");
    const car = await carByIid(db, project.id, intParam(ctx, "iid"));
    if (car === undefined) throw notFound();
    const files = await snapshot(db, project.id, car.sha);
    return json(200, { sha: car.sha, tree: treeIdFromFiles(files), files: Object.fromEntries(files) });
  });

  router.post("/api/projects/:id/merge_requests/:iid/train", async (ctx) => {
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, access } = await lockedProject(tx, ctx.user, intParam(ctx, "id"), "mr.write");
      const request = await findMergeRequest(tx, project.id, iid);
      if (request === undefined) throw notFound();
      const car = await addToTrain(tx, { project, access, actor: { id: ctx.user.id, username: ctx.user.username }, mrId: request.id, iid });
      return json(201, { ...(await trainBody(tx, project.id, request.target)), position: car.position, sha: car.sha, pipeline_id: car.pipeline_id, seq: await tx.currentSeq(project.id) });
    });
  });

  router.delete("/api/projects/:id/merge_requests/:iid/train", async (ctx) => {
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project } = await lockedProject(tx, ctx.user, intParam(ctx, "id"), "mr.write");
      const request = await findMergeRequest(tx, project.id, iid);
      if (request === undefined) throw notFound();
      if ((await carByRequest(tx, project.id, request.id)) === undefined) throw conflict("wrong_state", "This merge request isn't on the merge train.");
      await removeFromTrain(tx, project, request.id, `removed by ${ctx.user.username}`, ctx.user.username);
      return json(200, { ...(await trainBody(tx, project.id, request.target)), seq: await tx.currentSeq(project.id) });
    });
  });

  router.post("/api/projects/:id/merge_requests/:iid/train/merge_now", async (ctx) => {
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, access } = await lockedProject(tx, ctx.user, intParam(ctx, "id"), "train.manage");
      const { target } = await mergeNow(tx, { project, access, actor: { id: ctx.user.id, username: ctx.user.username }, iid });
      return json(200, { ...(await trainBody(tx, project.id, target)), seq: await tx.currentSeq(project.id) });
    });
  });
}
