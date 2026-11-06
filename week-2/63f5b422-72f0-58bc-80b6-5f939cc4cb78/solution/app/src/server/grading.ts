import { documentProblems, slugify } from "../shared/apply.js";
import { invalid } from "../shared/errors.js";
import { sanitizeRichText } from "../shared/richtext.js";
import { walk } from "../shared/tree.js";
import type { Collection, Component, DocBody, DocNode, Field, FieldKind, Page, Role, Token } from "../shared/types.js";
import { createUser } from "./auth.js";
import { newId, one, pool, transaction } from "./db.js";
import { publishPage } from "./publish.js";
import { simulateOutage } from "./storage.js";
import { insertWorkspace } from "./workspaces.js";

type Json = Record<string, unknown>;

const FIELD_KINDS: readonly FieldKind[] = ["text", "rich_text", "image"];

interface SeedNode {
  type: DocNode["type"];
  name: string;
  props?: DocNode["props"];
  styles?: Partial<DocNode["styles"]>;
  children?: SeedNode[];
  shared?: { component: string };
  bind?: DocNode["bind"];
}

function list(value: unknown, path: string): Json[] {
  if (!Array.isArray(value)) throw invalid({ [path]: "Expected a list." });
  return value as Json[];
}

function build(node: SeedNode, components: Map<string, Component>, path: string): DocNode {
  if (typeof node !== "object" || node === null || typeof node.name !== "string") throw invalid({ [path]: "A node has a type and a name." });
  const out: DocNode = {
    id: newId("n"),
    type: node.type,
    name: node.name,
    props: { ...(node.props ?? {}) },
    styles: { desktop: { ...(node.styles?.desktop ?? {}) }, tablet: { ...(node.styles?.tablet ?? {}) }, phone: { ...(node.styles?.phone ?? {}) } },
    children: (node.children ?? []).map((c, i) => build(c, components, `${path}.children.${i}`)),
  };
  if (node.bind) out.bind = { ...node.bind };
  if (node.shared) {
    const component = components.get(node.shared.component);
    if (!component) throw invalid({ [`${path}.shared.component`]: "There is no component with that name." });
    const copy = structuredClone(component.root);
    walk(copy, (n) => (n.id = newId("n")));
    return { ...copy, name: node.name, shared: { componentId: component.id } };
  }
  return out;
}

function buildDocument(raw: Json): Omit<DocBody, "id" | "slug"> {
  if (typeof raw.name !== "string" || raw.name.length < 1 || raw.name.length > 80) throw invalid({ "document.name": "A name is 1 to 80 characters." });
  const components = new Map<string, Component>();
  const componentList = list(raw.components ?? [], "document.components").map((c, i) => {
    const component: Component = { id: newId("cp"), name: String(c.name), root: build(c.root as SeedNode, components, `document.components.${i}.root`) };
    components.set(component.name, component);
    return component;
  });
  const taken = new Set<string>();
  const pages: Page[] = list(raw.pages, "document.pages").map((p, i) => {
    const name = String(p.name);
    const slug = slugify(name, taken);
    taken.add(slug);
    const root = build(p.root as SeedNode, components, `document.pages.${i}.root`);
    return { id: newId("pg"), name, slug, order: i, root };
  });
  const rawCollection = (raw.collection ?? {}) as Json;
  const fields: Field[] = list(rawCollection.fields ?? [], "document.collection.fields").map((f, i) => {
    const kind = FIELD_KINDS.find((k) => k === f.kind);
    if (typeof f.name !== "string" || !kind) throw invalid({ [`document.collection.fields.${i}`]: "A field has a name and a kind of text, rich_text or image." });
    return { name: f.name, kind };
  });
  const collection: Collection = {
    name: typeof rawCollection.name === "string" ? rawCollection.name : "Entries",
    fields: fields.map((f) => ({ name: f.name, kind: f.kind })),
    entries: list(rawCollection.entries ?? [], "document.collection.entries").map((e, i) => {
      const values = Object.fromEntries(
        Object.entries((e.values ?? {}) as Record<string, string>).map(([k, v]) => [k, fields.find((f) => f.name === k)?.kind === "rich_text" ? sanitizeRichText(String(v)) : String(v)]),
      );
      return { id: newId("e"), order: i, values };
    }),
  };
  const tokens: Token[] = list(raw.tokens ?? [], "document.tokens").map((t) =>
    t.kind === "size" ? { name: String(t.name), kind: "size", value: Number(t.value), unit: t.unit === "rem" ? "rem" : "px" } : { name: String(t.name), kind: "color", value: String(t.value) },
  );
  return { name: raw.name, tokens, pages, components: componentList, collection };
}

/** POST /api/grading/seed: users, workspaces with their documents and members, and published pages, in one call. */
export async function seed(body: Json): Promise<Json> {
  const userInputs = list(body.users ?? [], "users");
  const workspaceInputs = list(body.workspaces ?? [], "workspaces");
  const users = await transaction(async (tx) => {
    const created = [];
    for (const u of userInputs) created.push(await createUser(tx, u));
    return created;
  });
  const byEmail = new Map(users.map((u) => [u.email, u.id]));
  const lookup = async (email: unknown, path: string) => {
    const address = String(email ?? "").toLowerCase();
    const id = byEmail.get(address) ?? (await one<{ id: string }>(pool, "SELECT id FROM users WHERE email = $1", [address]))?.id;
    if (!id) throw invalid({ [path]: "There is no user with that email." });
    return id;
  };
  const workspaces: Json[] = [];
  for (const [w, input] of workspaceInputs.entries()) {
    const document = buildDocument((input.document ?? {}) as Json);
    const problems = documentProblems({ ...document, id: "", slug: "" });
    if (Object.keys(problems).length) throw invalid(Object.fromEntries(Object.entries(problems).map(([k, v]) => [`workspaces.${w}.document.${k}`, v])));
    const ownerId = await lookup(input.owner, `workspaces.${w}.owner`);
    const members = await Promise.all(list(input.members ?? [], `workspaces.${w}.members`).map(async (m, i) => ({ id: await lookup(m.email, `workspaces.${w}.members.${i}.email`), role: m.role as Role })));
    const doc = await transaction(async (tx) => {
      const created = await insertWorkspace(tx, document, ownerId);
      for (const m of members) await tx.query("INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [created.id, m.id, m.role]);
      return created;
    });
    for (const pageName of (Array.isArray(input.published) ? input.published : []).map(String)) {
      const page = doc.pages.find((p) => p.name === pageName);
      if (page) await publishPage(doc.id, page.id);
    }
    workspaces.push({
      id: doc.id,
      slug: doc.slug,
      pages: doc.pages.map((p) => {
        const nodes: Record<string, string> = {};
        walk(p.root, (n) => (nodes[n.name] ??= n.id));
        return { id: p.id, name: p.name, slug: p.slug, nodes };
      }),
      components: Object.fromEntries(doc.components.map((c) => [c.name, c.id])),
    });
  }
  return { users: users.map((u) => ({ id: u.id, email: u.email })), workspaces };
}

export function storageOutage(body: Json): void {
  const ms = Number(body.ms);
  if (typeof body.workspaceId !== "string" || !Number.isFinite(ms) || ms < 0) throw invalid({ workspaceId: "Send a workspaceId and ms." });
  simulateOutage(body.workspaceId, ms);
}
