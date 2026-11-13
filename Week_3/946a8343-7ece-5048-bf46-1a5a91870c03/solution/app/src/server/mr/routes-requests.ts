// Creating, reading and editing a merge request.
import { intParam, json, type Router } from "../http.ts";
import { db, withTx, type Tx } from "../db.ts";
import { projectScope, requireAction, type ProjectRow, type UserRow } from "../access.ts";
import { FieldErrors, wrongState } from "../errors.ts";
import { now } from "../clock.ts";
import { carOfRequest, removeFromTrain } from "../train/index.ts";
import * as repo from "../repo/index.ts";
import { cancelAutoMerge, refreshRequest, rememberChecks } from "./engine.ts";
import { evaluateRequest } from "./evaluate.ts";
import { emitRequest, requestWebhook, type RequestChange } from "./notify.ts";
import { bodyRecord, checkTitle, checkUsers, optionalBoolean, optionalString, stringList } from "./input.ts";
import { ALREADY_MERGED, DRAFT_PREFIX, insertSystemNote, isDraft, lockedRequest, openRequest, requireRequest, type MrRow } from "./store.ts";
import { listedRequests, requestBody } from "./view.ts";

const TEMPLATE_PATH = ".spurline/request-template.md";
const STATE_EVENTS = ["close", "reopen", "ready"] as const;
type StateEvent = (typeof STATE_EVENTS)[number];

function isStateEvent(value: string): value is StateEvent {
  return STATE_EVENTS.some((event) => event === value);
}

function bare(title: string): string {
  return title.startsWith(DRAFT_PREFIX) ? title.slice(DRAFT_PREFIX.length) : title;
}

async function checkBranches(tx: Tx, project: ProjectRow, errors: FieldErrors, source: string, target: string): Promise<void> {
  if (source === "" || !(await repo.branchExists(tx, project.id, source))) errors.add("source", "Source branch doesn't exist.");
  if (target === "" || !(await repo.branchExists(tx, project.id, target))) errors.add("target", "Target branch doesn't exist.");
  if (source !== "" && source === target) errors.add("target", "Source and target branches must differ.");
}

async function createRequest(tx: Tx, project: ProjectRow, user: UserRow, rawBody: unknown): Promise<{ iid: number; seq: number }> {
  const body = bodyRecord(rawBody);
  const errors = new FieldErrors();
  const title = (optionalString(body, "title") ?? "").trim();
  checkTitle(errors, title);
  const source = optionalString(body, "source") ?? "";
  const target = optionalString(body, "target") ?? "";
  await checkBranches(tx, project, errors, source, target);
  const assignees = stringList(body, "assignees") ?? [];
  const reviewers = stringList(body, "reviewers") ?? [];
  await checkUsers(tx, errors, "assignees", assignees);
  await checkUsers(tx, errors, "reviewers", reviewers);
  errors.throwIfAny();

  const targetHead = await repo.branchHead(tx, project.id, target);
  const sourceHead = await repo.branchHead(tx, project.id, source);
  if (targetHead === null || sourceHead === null) throw new Error("Branches were checked to exist");
  let description = optionalString(body, "description") ?? "";
  if (description.trim() === "") description = (await repo.readFile(tx, project.id, targetHead, TEMPLATE_PATH)) ?? description;

  const { iid } = await tx.one<{ iid: number }>("UPDATE projects SET next_mr_iid = next_mr_iid + 1 WHERE id = $1 RETURNING next_mr_iid - 1 AS iid", [project.id]);
  const stamp = now();
  const mr = await tx.one<MrRow>(
    `INSERT INTO merge_requests (project_id, iid, author_id, title, description, source, target, state, delete_source_branch, assignees, reviewers, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'opened', $8, $9, $10, $11, $11) RETURNING *`,
    [project.id, iid, user.id, title, description, source, target, optionalBoolean(body, "delete_source_branch") ?? false, assignees, reviewers, stamp],
  );
  const base = await repo.mergeBase(tx, project.id, targetHead, sourceHead);
  await tx.q("INSERT INTO mr_versions (mr_id, number, base, head, start, created_at) VALUES ($1, 1, $2, $3, $4, $5)", [mr.id, base, sourceHead, targetHead, stamp]);
  await rememberChecks(tx, mr, await evaluateRequest(tx, project, mr));
  await emitRequest(tx, project, iid, "opened");
  await requestWebhook(tx, project, mr, "open", user.username);
  return { iid, seq: await tx.currentSeq(project.id) };
}

async function removeCar(tx: Tx, project: ProjectRow, mr: MrRow, user: UserRow): Promise<void> {
  if ((await carOfRequest(tx, project.id, mr.id)) !== null) await removeFromTrain(tx, project, mr.id, `removed by ${user.username}`, user.username);
}

async function editRequest(tx: Tx, project: ProjectRow, user: UserRow, mr: MrRow, rawBody: unknown): Promise<void> {
  const body = bodyRecord(rawBody);
  const rawEvent = optionalString(body, "state_event");
  const event = rawEvent === undefined || isStateEvent(rawEvent) ? rawEvent : null;
  const newTarget = optionalString(body, "target");
  const retarget = newTarget !== undefined && newTarget !== mr.target ? newTarget : null;

  if (mr.state === "merged" && (event !== undefined || retarget !== null)) throw wrongState(ALREADY_MERGED);
  if (event === "close" && mr.state === "closed") throw wrongState("This merge request is already closed.");
  if (event === "reopen" && mr.state === "opened") throw wrongState("This merge request isn't closed.");
  if (event === "ready" && !isDraft(mr.title)) throw wrongState("This merge request isn't a draft.");

  const errors = new FieldErrors();
  if (event === null) errors.add("state_event", "State event must be close, reopen or ready.");
  let title = (optionalString(body, "title") ?? mr.title).trim();
  if (event === "ready") title = bare(title);
  if (body["title"] !== undefined || event === "ready") checkTitle(errors, title);
  if (retarget !== null) await checkBranches(tx, project, errors, mr.source, retarget);
  const assignees = stringList(body, "assignees") ?? mr.assignees;
  const reviewers = stringList(body, "reviewers") ?? mr.reviewers;
  await checkUsers(tx, errors, "assignees", assignees.filter((name) => !mr.assignees.includes(name)));
  await checkUsers(tx, errors, "reviewers", reviewers.filter((name) => !mr.reviewers.includes(name)));
  errors.throwIfAny();

  const description = optionalString(body, "description") ?? mr.description;
  const target = retarget ?? mr.target;
  const wasDraft = isDraft(mr.title);
  const nowDraft = isDraft(title);
  const state = event === "close" ? "closed" : event === "reopen" ? "opened" : mr.state;

  const texts: string[] = [];
  if (event === "close") texts.push("Closed.");
  if (event === "reopen") texts.push("Reopened.");
  if (wasDraft !== nowDraft) texts.push(nowDraft ? "Marked as draft." : "Marked as ready.");
  if (bare(title) !== bare(mr.title)) texts.push(`Changed title to ${title}.`);
  if (retarget !== null) texts.push(`Changed target from ${mr.target} to ${retarget}.`);
  for (const name of assignees) if (!mr.assignees.includes(name)) texts.push(`Assigned @${name}.`);
  for (const name of mr.assignees) if (!assignees.includes(name)) texts.push(`Unassigned @${name}.`);
  if (texts.length === 0 && description === mr.description && reviewers.join() === mr.reviewers.join()) return;

  if (event === "close" || retarget !== null) await removeCar(tx, project, mr, user);
  const canceled: string[] = [];
  if (!wasDraft && nowDraft) {
    const text = await cancelAutoMerge(tx, mr, "the merge request became a draft", user.username);
    if (text !== null) canceled.push(text);
  }
  if (retarget !== null) {
    const text = await cancelAutoMerge(tx, mr, "the target branch changed", user.username);
    if (text !== null) canceled.push(text);
  }
  await tx.q(
    "UPDATE merge_requests SET title = $2, description = $3, target = $4, assignees = $5, reviewers = $6, state = $7, updated_at = $8 WHERE id = $1",
    [mr.id, title, description, target, assignees, reviewers, state, now()],
  );
  for (const text of texts) await insertSystemNote(tx, mr.id, user.username, text);

  let change: RequestChange = "updated";
  if (event === "close") change = "closed";
  else if (event === "reopen") change = "reopened";
  else if (wasDraft !== nowDraft) change = nowDraft ? "draft" : "ready";
  else if (retarget !== null) change = "retargeted";
  await emitRequest(tx, project, mr.iid, change, [...texts, ...canceled]);
  await requestWebhook(tx, project, { ...mr, title, target, state }, event === "close" ? "close" : event === "reopen" ? "reopen" : "update", user.username);
  await refreshRequest(tx, project, mr.id, { autoMerge: true, rulesMessage: true });
}

export function registerRequestRoutes(router: Router): void {
  router.post("/api/projects/:id/merge_requests", async (ctx) => {
    const projectId = intParam(ctx, "id");
    return withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, projectId);
      requireAction(access, "mr.write");
      await tx.lockProject(project.id);
      return json(201, await createRequest(tx, project, ctx.user, ctx.body));
    });
  });

  router.get("/api/projects/:id/merge_requests", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "mr.read");
    const state = ctx.query.get("state");
    const known = state === "opened" || state === "closed" || state === "merged" ? state : null;
    return json(200, { merge_requests: await listedRequests(db, project, known) });
  });

  router.get("/api/projects/:id/merge_requests/:iid", async (ctx) => {
    const { project, mr } = await openRequest(db, ctx.user, intParam(ctx, "id"), intParam(ctx, "iid"), "mr.read");
    return json(200, await requestBody(db, project, mr, ctx.user.id));
  });

  router.patch("/api/projects/:id/merge_requests/:iid", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.write");
      await editRequest(tx, project, ctx.user, mr, ctx.body);
      const fresh = await requireRequest(tx, project.id, iid);
      return json(200, { ...(await requestBody(tx, project, fresh, ctx.user.id)), seq: await tx.currentSeq(project.id) });
    });
  });
}
