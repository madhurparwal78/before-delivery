import type { Value } from "../../shared/expression.js";
import { stateLabel } from "../../shared/fields.js";
import { saveConfig, type ConfigKind } from "../admin.js";
import { addCartLine, cartLines, checkout, itemById, loadGuide, loadItems, removeCartLine, resolveDefaults, resolveGuide } from "../catalog.js";
import { configDelete, configGet, configList, configPut } from "../store.js";
import { captureChange, backoutSet, commitSet, createSet, exportSet, listSets, previewSet, uploadSet } from "../configsets.js";
import type { Env } from "../env.js";
import { notFound, validation } from "../errors.js";
import { numberParam, reply, requireOperator, requireRole, route, withEnv, type Ctx } from "../http.js";
import { articleJson, createArticle, moveArticle, rank, updateArticle, voteArticle } from "../knowledge.js";
import { publish } from "../live.js";
import { slaViews } from "../sla.js";
import { requireFile } from "../files.js";
import { publishWorkflow, retryRun, runJson, testRun, validateDraft, workflowJson, workflowRowById, type Step, type WorkflowContent } from "../workflows.js";
import { requestState, toRecord } from "../world.js";

const workspaceOf = (ctx: Ctx): "live" | "test" => ctx.session?.workspace ?? "live";

interface Kind {
  path: string;
  kind: ConfigKind;
  plural: string;
  singular: string;
  read: "operator" | "desk" | "signed";
  /** The brief publishes PUT by name for this kind; the others are saved by POST alone. */
  putByName: boolean;
}

const KINDS: Kind[] = [
  { path: "business-rules", kind: "business_rule", plural: "business_rules", singular: "business_rule", read: "operator", putByName: true },
  { path: "access-rules", kind: "access_rule", plural: "access_rules", singular: "access_rule", read: "operator", putByName: true },
  { path: "assignment-rules", kind: "assignment_rule", plural: "assignment_rules", singular: "assignment_rule", read: "operator", putByName: false },
  { path: "form-policies", kind: "form_policy", plural: "form_policies", singular: "form_policy", read: "signed", putByName: false },
  { path: "sla-definitions", kind: "sla_definition", plural: "sla_definitions", singular: "sla_definition", read: "desk", putByName: true },
  { path: "schedules", kind: "schedule", plural: "schedules", singular: "schedule", read: "desk", putByName: true },
];

function allowRead(env: Env, read: Kind["read"]): void {
  if (read === "operator") requireOperator(env);
  else if (read === "desk") requireRole(env, ["operator", "technician"]);
}

for (const k of KINDS) {
  route("GET", `/api/${k.path}`, async (ctx) =>
    withEnv(ctx, async (env) => {
      allowRead(env, k.read);
      return reply(200, { [k.plural]: (await configList<unknown>(k.kind, workspaceOf(ctx), env.tx)).map((r) => r.content) });
    }),
  );
  route("POST", `/api/${k.path}`, async (ctx) =>
    withEnv(ctx, async (env) => {
      requireOperator(env);
      const saved = await saveConfig(env, k.kind, ctx.json(), workspaceOf(ctx));
      if (k.kind === "access_rule") env.tx.after.push(() => publish("session", "rules_changed", {}));
      return reply(saved.created ? 201 : 200, { [k.singular]: saved.content });
    }),
  );
  if (k.putByName)
    route("PUT", `/api/${k.path}/:name`, async (ctx) =>
      withEnv(ctx, async (env) => {
        requireOperator(env);
        const saved = await saveConfig(env, k.kind, ctx.json(), workspaceOf(ctx), ctx.params.name!);
        if (k.kind === "access_rule") env.tx.after.push(() => publish("session", "rules_changed", {}));
        return reply(200, { [k.singular]: saved.content });
      }),
    );
}

route("GET", "/api/catalog/items", async (ctx) => withEnv(ctx, async (env) => reply(200, { items: (await loadItems(env)).map((i) => resolveDefaults(env, i)) })));

route("GET", "/api/catalog/items/:id", async (ctx) =>
  withEnv(ctx, async (env) => {
    const item = await itemById(env, ctx.params.id!);
    return item ? reply(200, { item: resolveDefaults(env, item) }) : notFound();
  }),
);

async function saveItem(ctx: Ctx, id: string | null, status: 200 | 201): Promise<ReturnType<typeof reply>> {
  return withEnv(ctx, async (env) => {
    requireOperator(env);
    const body = ctx.json<Record<string, unknown>>();
    const previous = id ? await itemById(env, id) : undefined;
    if (id && !previous) return notFound();
    const saved = await saveConfig(env, "catalog_item", id ? { ...body, id } : body, workspaceOf(ctx));
    if (previous && previous.name !== (saved.content as { name: string }).name) {
      await configDelete(env.tx, workspaceOf(ctx), "catalog_item", previous.name);
      if (workspaceOf(ctx) === "test") await captureChange(env, "catalog_item", previous.name);
    }
    return reply(previous ? 200 : status, { item: saved.content });
  });
}

route("POST", "/api/catalog/items", (ctx) => saveItem(ctx, null, 201));
route("PUT", "/api/catalog/items/:id", (ctx) => saveItem(ctx, ctx.params.id!, 200));

route("GET", "/api/catalog/guides/:id", async (ctx) =>
  withEnv(ctx, async (env) => {
    const guide = await loadGuide(env, ctx.params.id!);
    return guide ? reply(200, { guide }) : notFound();
  }),
);

route("POST", "/api/catalog/guides/:id/resolve", async (ctx) =>
  withEnv(ctx, async (env) => {
    const guide = await loadGuide(env, ctx.params.id!);
    if (!guide) return notFound();
    const answers = ctx.json<{ answers?: Record<string, Value> }>().answers ?? {};
    return reply(200, { items: await resolveGuide(env, guide, answers) });
  }),
);

route("GET", "/api/cart", async (ctx) => withEnv(ctx, async (env) => reply(200, { lines: await cartLines(env) })));
route("POST", "/api/cart/lines", async (ctx) => withEnv(ctx, async (env) => reply(201, { line: await addCartLine(env, ctx.json()) })));
route("DELETE", "/api/cart/lines/:id", async (ctx) =>
  withEnv(ctx, async (env) => {
    await removeCartLine(env, numberParam(ctx, "id"));
    return reply(204);
  }),
);

route("POST", "/api/cart/checkout", async (ctx) =>
  withEnv(ctx, async (env) => {
    const key = ctx.req.headers["idempotency-key"];
    const header = Array.isArray(key) ? key[0] : key;
    if (header !== undefined && (header.length < 1 || header.length > 64)) return validation("An Idempotency-Key is 1 to 64 characters.", { "Idempotency-Key": "Use 1 to 64 characters." });
    const body = ctx.json<{ requested_for?: string | null }>();
    const result = await checkout(env, { requested_for: body.requested_for ?? null }, header ?? null);
    return reply(result.status, result.body);
  }),
);

route("GET", "/api/requests/:number", async (ctx) =>
  withEnv(ctx, async (env) => {
    const request = (await env.tx.query("SELECT * FROM requests WHERE number = $1", [ctx.params.number]))[0];
    const desk = env.user.roles.includes("operator") || env.user.roles.includes("technician");
    if (!request || (!desk && request.requester !== env.user.username && request.requested_for !== env.user.username)) return notFound();
    const items = (await env.tx.query("SELECT * FROM records WHERE table_name = 'request_item' AND fields->>'request' = $1 ORDER BY id", [request.number])).map(toRecord);
    const tasks = (await env.tx.query("SELECT * FROM records WHERE table_name = 'task' AND fields->>'parent' = ANY($1) ORDER BY id", [items.map((i) => i.number)])).map(toRecord);
    const catalog = await slaViewsFor(env, items);
    return reply(200, {
      request: {
        number: request.number,
        state: requestState(request.closed as boolean),
        items: items.map((i) => ({
          number: i.number,
          item: i.fields.item,
          state: i.fields.state,
          state_label: stateLabel("request_item", String(i.fields.state)),
          tasks: tasks.filter((t) => t.fields.parent === i.number).map((t) => ({ number: t.number, state: t.fields.state, state_label: stateLabel("task", String(t.fields.state)) })),
          slas: catalog.get(i.number) ?? [],
        })),
      },
    });
  }),
);

async function slaViewsFor(env: Env, items: ReturnType<typeof toRecord>[]): Promise<Map<string, unknown[]>> {
  const out = new Map<string, unknown[]>();
  const catalog = await env.slaCatalog();
  for (const item of items) out.set(item.number, (await slaViews(env.tx, item, env.world, catalog)).filter((v) => v.stage !== "cancelled"));
  return out;
}

route("GET", "/api/knowledge/articles", async (ctx) => withEnv(ctx, async (env) => reply(200, { articles: await rank(env, ctx.query.get("q") ?? "") })));
route("GET", "/api/knowledge/suggest", async (ctx) => withEnv(ctx, async (env) => reply(200, { articles: await rank(env, ctx.query.get("text") ?? "", 3) })));
route("GET", "/api/knowledge/articles/:number", async (ctx) => withEnv(ctx, async (env) => reply(200, { article: await articleJson(env, ctx.params.number!) })));
route("POST", "/api/knowledge/articles", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    return reply(201, { article: await createArticle(env, ctx.json()) });
  }),
);
route("PUT", "/api/knowledge/articles/:number", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    return reply(200, { article: await updateArticle(env, ctx.params.number!, ctx.json()) });
  }),
);
route("POST", "/api/knowledge/articles/:number/submit", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    return reply(200, { article: await moveArticle(env, ctx.params.number!, "submit") });
  }),
);
route("POST", "/api/knowledge/articles/:number/approve", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, { article: await moveArticle(env, ctx.params.number!, "approve") });
  }),
);
route("POST", "/api/knowledge/articles/:number/retire", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, { article: await moveArticle(env, ctx.params.number!, "retire") });
  }),
);
route("PUT", "/api/knowledge/articles/:number/vote", async (ctx) => withEnv(ctx, async (env) => reply(200, await voteArticle(env, ctx.params.number!, ctx.json<{ helpful?: unknown }>().helpful))));

route("GET", "/api/workflows", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const rows = await configList<WorkflowContent>("workflow", workspaceOf(ctx), env.tx);
    return reply(200, { workflows: await Promise.all(rows.map((r) => workflowJson(env.tx, r))) });
  }),
);

route("POST", "/api/workflows", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const body = ctx.json<Record<string, unknown>>();
    const saved = await saveConfig(env, "workflow", body, workspaceOf(ctx));
    const row = (await configGet<WorkflowContent>("workflow", String((saved.content as WorkflowContent).name), workspaceOf(ctx), env.tx))!;
    return reply(saved.created ? 201 : 200, { workflow: await workflowJson(env.tx, row) });
  }),
);

route("PUT", "/api/workflows/:id/draft", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const row = await workflowRowById(env.tx, numberParam(ctx, "id"));
    if (!row) return notFound();
    const steps = ctx.json<{ steps?: Step[] }>().steps;
    if (!Array.isArray(steps)) return validation("Send the steps as a list.", { steps: "Steps must be a list." });
    validateDraft(row.content, steps);
    const content = { ...row.content, draft: steps };
    await configPut(env.tx, workspaceOf(ctx), "workflow", row.name, content);
    if (workspaceOf(ctx) === "test") await captureChange(env, "workflow", row.name);
    return reply(200, { workflow: await workflowJson(env.tx, { ...row, content }) });
  }),
);

route("POST", "/api/workflows/:id/publish", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const id = numberParam(ctx, "id");
    const version = await publishWorkflow(env, id);
    const row = (await workflowRowById(env.tx, id))!;
    if (workspaceOf(ctx) === "test") await captureChange(env, "workflow", row.name);
    return reply(201, { version });
  }),
);

route("POST", "/api/workflows/:id/test-run", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const record = ctx.json<{ record?: unknown }>().record;
    if (typeof record !== "string") return validation("Name a record.", { record: "Record is required." });
    const id = await testRun(env, numberParam(ctx, "id"), record);
    return reply(201, { run: await runJson(env.tx, id) });
  }),
);

route("GET", "/api/runs/:id", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    const run = await runJson(env.tx, numberParam(ctx, "id"));
    if (!run) return notFound();
    const rows = (await env.tx.query("SELECT steps FROM runs WHERE id = $1", [run.id]))[0]!.steps as Array<{ id: string; name: string; status: string; error: string | null }>;
    return reply(200, { run: { ...run, steps: rows } });
  }),
);

route("POST", "/api/runs/:id/retry", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const id = numberParam(ctx, "id");
    await retryRun(env, id);
    return reply(202, { run: await runJson(env.tx, id) });
  }),
);

route("GET", "/api/config-sets", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, { sets: await listSets(env) });
  }),
);

route("POST", "/api/config-sets", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { set: await createSet(env, ctx.json<{ name?: unknown }>().name) });
  }),
);

route("POST", "/api/config-sets/upload", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { set: await uploadSet(env, requireFile(ctx.multipart().files).data) });
  }),
);

route("POST", "/api/config-sets/:id/export", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { set: await exportSet(env, numberParam(ctx, "id")) });
  }),
);

route("POST", "/api/config-sets/:id/preview", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, await previewSet(env, numberParam(ctx, "id")));
  }),
);

route("POST", "/api/config-sets/:id/commit", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const choices = ctx.json<{ choices?: Record<string, string> }>().choices ?? {};
    return reply(200, await commitSet(env, numberParam(ctx, "id"), choices));
  }),
);

route("POST", "/api/config-sets/:id/backout", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, { set: await backoutSet(env, numberParam(ctx, "id")) });
  }),
);
