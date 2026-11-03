import { sanitizeRichText } from "./richtext.js";
import { isColourName, isTokenRef, sizeTokenProblem, styleValueProblem, tokenNameProblem } from "./styles.js";
import {
  canReceive,
  containsInstance,
  countNodes,
  defaultName,
  enclosingList,
  instanceRoot,
  locate,
  locateOnPage,
  moveProblem,
  nodeAt,
  pathFrom,
  subtreeIds,
  walk,
  type Located,
} from "./tree.js";
import {
  BREAKPOINTS,
  NODE_TYPES,
  STYLE_KEYS,
  type BindableProp,
  type Change,
  type Created,
  type DocBody,
  type DocNode,
  type Field,
  type FieldKind,
  type NodeProps,
  type NodeType,
  type OpFields,
  type OpKind,
  type Page,
  type PropKey,
  type StyleKey,
  type Token,
  type WorkspaceDoc,
} from "./types.js";
import { notice } from "./notices.js";
import { ApiError, invalid, notFound } from "./errors.js";

const LIMITS = { nodesPerPage: 500, pages: 20, tokens: 40, fields: 20, entries: 200, name: 80, text: 2000 } as const;

const invalidMove = (field: "parentId" | "index", why: string) => new ApiError(422, "invalid_move", "That move is not allowed.", { [field]: why });

export interface ExecContext {
  /** Makes a new persistent id; only the server can. */
  newId: (prefix: "n" | "cp" | "e" | "pg") => string;
  /** Image status for the not-found rule and confirmation (server only). */
  image?: (id: string) => "confirmed" | "pending" | "missing";
  /** A node deleted from this workspace: its name and who deleted it (server only). */
  tombstone?: (id: string) => { nodeName: string; by: string } | undefined;
}

export interface Executed {
  changes: Change[];
  /** Applying these in order reverses `changes`. */
  inverse: Change[];
  created?: Created;
  /** Subtrees removed by this operation (for tombstones). */
  removed: DocNode[];
}

// ── Primitive changes ────────────────────────────────────────────────────────────────────────────

function mustLocate(doc: WorkspaceDoc, id: string): Located {
  const found = locate(doc, id);
  if (!found) throw new Error(`node ${id} is missing`);
  return found;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Apply one primitive change in place and return its exact inverse. */
function applyChange(doc: WorkspaceDoc, change: Change): Change {
  switch (change.c) {
    case "prop": {
      const { node } = mustLocate(doc, change.node);
      const before = node.props[change.prop];
      if (change.value === undefined) delete node.props[change.prop];
      else (node.props as Record<string, string | number>)[change.prop] = change.value;
      return { c: "prop", node: change.node, prop: change.prop, value: before };
    }
    case "style": {
      const { node } = mustLocate(doc, change.node);
      const before = node.styles[change.bp][change.key];
      if (change.value === undefined) delete node.styles[change.bp][change.key];
      else node.styles[change.bp][change.key] = clone(change.value);
      return { c: "style", node: change.node, bp: change.bp, key: change.key, value: before };
    }
    case "name": {
      const { node } = mustLocate(doc, change.node);
      const before = node.name;
      node.name = change.name;
      return { c: "name", node: change.node, name: before };
    }
    case "bind": {
      const { node } = mustLocate(doc, change.node);
      const before = node.bind?.[change.prop];
      const bind = { ...node.bind };
      if (change.field === undefined) delete bind[change.prop];
      else bind[change.prop] = change.field;
      if (Object.keys(bind).length) node.bind = bind;
      else delete node.bind;
      return { c: "bind", node: change.node, prop: change.prop, field: before };
    }
    case "shared": {
      const { node } = mustLocate(doc, change.node);
      const before = node.shared?.componentId;
      if (change.componentId === undefined) delete node.shared;
      else node.shared = { componentId: change.componentId };
      return { c: "shared", node: change.node, componentId: before };
    }
    case "insert": {
      const { node: parent } = mustLocate(doc, change.parent);
      parent.children.splice(Math.min(change.index, parent.children.length), 0, clone(change.node));
      return { c: "remove", node: change.node.id };
    }
    case "remove": {
      const found = mustLocate(doc, change.node);
      if (!found.parent) throw new Error("cannot remove a root");
      found.parent.children.splice(found.index, 1);
      return { c: "insert", parent: found.parent.id, index: found.index, node: found.node };
    }
    case "move": {
      const found = mustLocate(doc, change.node);
      if (!found.parent) throw new Error("cannot move a root");
      const back: Change = { c: "move", node: change.node, parent: found.parent.id, index: found.index };
      found.parent.children.splice(found.index, 1);
      const { node: target } = mustLocate(doc, change.parent);
      target.children.splice(Math.min(change.index, target.children.length), 0, found.node);
      return back;
    }
    case "token": {
      const at = doc.tokens.findIndex((t) => t.name === change.name);
      const before = at >= 0 ? doc.tokens[at] : undefined;
      if (at >= 0) doc.tokens.splice(at, 1);
      if (change.token) doc.tokens.splice(Math.min(change.index, doc.tokens.length), 0, clone(change.token));
      return { c: "token", name: change.token?.name ?? change.name, index: at >= 0 ? at : change.index, token: before };
    }
    case "tokenRename": {
      const token = doc.tokens.find((t) => t.name === change.from);
      if (token) token.name = change.to;
      const rewrite = (root: DocNode) =>
        walk(root, (n) => {
          for (const bp of BREAKPOINTS)
            for (const value of Object.values(n.styles[bp])) if (isTokenRef(value) && value.token === change.from) value.token = change.to;
        });
      doc.pages.forEach((p) => rewrite(p.root));
      doc.components.forEach((c) => rewrite(c.root));
      return { c: "tokenRename", from: change.to, to: change.from };
    }
    case "component": {
      const at = doc.components.findIndex((c) => c.id === change.id);
      const before = at >= 0 ? doc.components[at] : undefined;
      if (at >= 0) doc.components.splice(at, 1);
      if (change.component) doc.components.splice(Math.min(change.index, doc.components.length), 0, clone(change.component));
      return { c: "component", id: change.id, index: at >= 0 ? at : change.index, component: before };
    }
    case "fields": {
      const before = doc.collection.fields;
      doc.collection.fields = clone(change.fields);
      return { c: "fields", fields: before };
    }
    case "entry": {
      const entries = doc.collection.entries;
      const at = entries.findIndex((e) => e.id === change.id);
      const before = at >= 0 ? entries[at].values : undefined;
      if (at >= 0) entries.splice(at, 1);
      if (change.values) entries.splice(Math.min(change.index, entries.length), 0, { id: change.id, order: 0, values: clone(change.values) });
      entries.forEach((e, i) => (e.order = i));
      return { c: "entry", id: change.id, index: at >= 0 ? at : change.index, values: before };
    }
    case "page": {
      const at = doc.pages.findIndex((p) => p.id === change.id);
      const before = at >= 0 ? doc.pages[at] : undefined;
      if (at >= 0) doc.pages.splice(at, 1);
      if (change.page) doc.pages.splice(Math.min(change.index, doc.pages.length), 0, clone(change.page));
      doc.pages.forEach((p, i) => (p.order = i));
      return { c: "page", id: change.id, index: at >= 0 ? at : change.index, page: before };
    }
    case "pageName": {
      const page = doc.pages.find((p) => p.id === change.id);
      if (!page) throw new Error(`page ${change.id} is missing`);
      const before = page.name;
      page.name = change.name;
      return { c: "pageName", id: change.id, name: before };
    }
    case "doc": {
      const before: DocBody = { id: doc.id, name: doc.name, slug: doc.slug, tokens: doc.tokens, pages: doc.pages, components: doc.components, collection: doc.collection };
      const next = clone(change.doc);
      Object.assign(doc, { id: next.id, name: next.name, slug: next.slug, tokens: next.tokens, pages: next.pages, components: next.components, collection: next.collection });
      return { c: "doc", doc: before };
    }
  }
}

/** Apply a list of changes in order; returns the list that reverses them. */
export function applyChanges(doc: WorkspaceDoc, changes: readonly Change[]): Change[] {
  const inverse: Change[] = [];
  for (const change of changes) inverse.unshift(applyChange(doc, change));
  return inverse;
}

// ── Reading the document ─────────────────────────────────────────────────────────────────────────

function linkedInstances(doc: Pick<WorkspaceDoc, "pages">, componentId: string): { node: DocNode; page: Page }[] {
  const out: { node: DocNode; page: Page }[] = [];
  for (const page of doc.pages) walk(page.root, (n) => n.shared?.componentId === componentId && out.push({ node: n, page }));
  return out;
}

/** Token uses: style values referencing it on page nodes outside linked instances, plus component nodes once. */
export function tokenUses(doc: WorkspaceDoc, name: string): number {
  let uses = 0;
  const count = (node: DocNode, insideInstance: boolean) => {
    const inside = insideInstance || !!node.shared;
    if (!inside) for (const bp of BREAKPOINTS) for (const value of Object.values(node.styles[bp])) if (isTokenRef(value) && value.token === name) uses += 1;
    node.children.forEach((c) => count(c, inside));
  };
  doc.pages.forEach((p) => count(p.root, false));
  doc.components.forEach((c) =>
    walk(c.root, (n) => {
      for (const bp of BREAKPOINTS) for (const value of Object.values(n.styles[bp])) if (isTokenRef(value) && value.token === name) uses += 1;
    }),
  );
  return uses;
}

function fieldBindings(doc: WorkspaceDoc, field: string): number {
  let bound = 0;
  const visit = (root: DocNode) => walk(root, (n) => (bound += Object.values(n.bind ?? {}).filter((f) => f === field).length));
  doc.pages.forEach((p) => visit(p.root));
  doc.components.forEach((c) => visit(c.root));
  return bound;
}

/** The node and every mirrored copy of it (the component and each linked instance), by tree path. */
function mirrors(doc: WorkspaceDoc, found: Located, includeRoot = true): DocNode[] {
  const root = instanceRoot(found);
  if (!root || (!includeRoot && root === found.node)) return [found.node];
  const path = pathFrom(root, found.node) ?? [];
  const componentId = root.shared?.componentId ?? "";
  const component = doc.components.find((c) => c.id === componentId);
  const roots = [...(component ? [component.root] : []), ...linkedInstances(doc, componentId).map((i) => i.node)];
  const out: DocNode[] = [];
  for (const r of roots) {
    const copy = nodeAt(r, path);
    if (copy && !out.includes(copy)) out.push(copy);
  }
  return out;
}

/** The shared component a node edit reaches, with its linked instance count (for the shared edit notice). */
export function sharedEditScope(doc: WorkspaceDoc, nodeId: string, structural: boolean): { name: string; instances: number } | null {
  const found = locateOnPage(doc, nodeId);
  const root = found && instanceRoot(found);
  if (!found || !root?.shared || (structural && root === found.node)) return null;
  const component = doc.components.find((c) => c.id === root.shared?.componentId);
  return component ? { name: component.name, instances: linkedInstances(doc, component.id).length } : null;
}

// ── Validation helpers ───────────────────────────────────────────────────────────────────────────

const PROPS_BY_TYPE: Record<NodeType, readonly PropKey[]> = {
  page: [],
  section: [],
  stack: [],
  nav: [],
  collection_list: [],
  heading: ["text", "level"],
  text: ["text"],
  button: ["text", "href"],
  image: ["imageId", "alt", "focalX", "focalY"],
};

export const MAIN_PROP: Partial<Record<NodeType, BindableProp>> = { heading: "text", text: "text", button: "text", image: "imageId" };

export function fieldAccepts(type: NodeType, kind: FieldKind): boolean {
  if (type === "image") return kind === "image";
  if (type === "text") return kind === "text" || kind === "rich_text";
  if (type === "heading" || type === "button") return kind === "text";
  return false;
}

export function hrefProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length > LIMITS.text) return "A link takes text up to 2,000 characters.";
  if (/^(https?:|mailto:)/i.test(value) || /^\/(?!\/)/.test(value)) return null;
  return "A link is an http:, https: or mailto: address, or a path starting with /.";
}

function nameProblem(value: unknown): string | null {
  return typeof value === "string" && value.length >= 1 && value.length <= LIMITS.name ? null : "A name is 1 to 80 characters.";
}

function propProblem(type: NodeType, prop: string, value: unknown): string | null {
  if (!(PROPS_BY_TYPE[type] as readonly string[]).includes(prop)) return `A ${type} has no ${prop}.`;
  switch (prop) {
    case "text":
      return typeof value === "string" && value.length <= LIMITS.text ? null : "Text is at most 2,000 characters.";
    case "level":
      return value === 1 || value === 2 || value === 3 ? null : "A heading level is 1, 2 or 3.";
    case "href":
      return hrefProblem(value);
    case "alt":
      return typeof value === "string" && value.length >= 1 && value.length <= LIMITS.text ? null : "Alt text is required.";
    case "focalX":
    case "focalY":
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100 ? null : "A focal point is a whole number from 0 to 100.";
    case "imageId":
      return typeof value === "string" && /^img_[a-z0-9]{12}$/.test(value) ? null : "Choose an uploaded image.";
    default:
      return `Unknown property ${prop}.`;
  }
}

function defaultProps(type: NodeType, name: string): NodeProps {
  if (type === "heading") return { text: name, level: 1 };
  if (type === "text") return { text: name };
  if (type === "button") return { text: name, href: "/" };
  if (type === "image") return { focalX: 50, focalY: 50 };
  return {};
}

function emptyStyles(): DocNode["styles"] {
  return { desktop: {}, tablet: {}, phone: {} };
}

function checkImage(ctx: ExecContext, id: unknown, path: string): void {
  if (!ctx.image || typeof id !== "string") return;
  const status = ctx.image(id);
  if (status === "missing") throw notFound();
  if (status === "pending") throw new ApiError(422, "image_not_confirmed", "That image is not confirmed yet.", { [path]: "This image is not confirmed by storage yet." });
}

/** Validate an untyped operation body: kind, known fields, field types. */
const OP_FIELDS: Record<OpKind, { required: readonly string[]; optional?: readonly string[] }> = {
  insert_node: { required: ["pageId", "parentId", "index", "type"], optional: ["props", "name"] },
  insert_instance: { required: ["pageId", "parentId", "index", "componentId"] },
  move_node: { required: ["nodeId", "parentId", "index"] },
  delete_node: { required: ["nodeId"] },
  duplicate_node: { required: ["nodeId"] },
  rename_node: { required: ["nodeId", "name"] },
  set_prop: { required: ["nodeId", "prop", "value"] },
  set_style: { required: ["nodeId", "breakpoint", "property", "value"] },
  clear_style: { required: ["nodeId", "breakpoint", "property"] },
  set_token: { required: ["name", "value"], optional: ["unit"] },
  rename_token: { required: ["name", "newName"] },
  delete_token: { required: ["name"] },
  create_component: { required: ["nodeId", "name"] },
  detach_instance: { required: ["nodeId"] },
  delete_component: { required: ["componentId"] },
  set_fields: { required: ["fields"] },
  put_entry: { required: ["values"], optional: ["entryId"] },
  move_entry: { required: ["entryId", "index"] },
  delete_entry: { required: ["entryId"] },
  bind_prop: { required: ["nodeId", "prop", "field"] },
  add_page: { required: ["name"] },
  rename_page: { required: ["pageId", "name"] },
  undo: { required: [] },
  redo: { required: [] },
};

type Shape = "string" | "integer" | "object" | "array" | "stringOrNull" | "value";

/** The JSON shape of each operation field; contents are validated against the document in `execute`. */
const SHAPE: Record<string, Shape> = {
  pageId: "string",
  parentId: "string",
  nodeId: "string",
  componentId: "string",
  entryId: "string",
  index: "integer",
  type: "string",
  props: "object",
  name: "string",
  newName: "string",
  prop: "string",
  value: "value",
  breakpoint: "string",
  property: "string",
  unit: "string",
  fields: "array",
  values: "object",
  field: "stringOrNull",
};

function fits(shape: Shape, value: unknown): boolean {
  switch (shape) {
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "stringOrNull":
      return value === null || typeof value === "string";
    case "value":
      return typeof value === "string" || typeof value === "number" || (typeof value === "object" && value !== null && !Array.isArray(value));
  }
}

interface ParsedOp {
  opId: string;
  baseSeq: number;
  op: OpFields;
}

/** Check an operation body's kind, fields and field shapes; the result is a typed operation. */
export function parseOperation(raw: unknown): ParsedOp {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid({ "": "An operation is a JSON object." });
  const { opId, baseSeq, kind, ...fields } = raw as Record<string, unknown>;
  const problems: Record<string, string> = {};
  if (typeof opId !== "string" || opId.length < 1 || opId.length > 64) problems.opId = "opId is 1 to 64 characters.";
  if (!Number.isInteger(baseSeq) || (baseSeq as number) < 0) problems.baseSeq = "baseSeq is the last seq you applied.";
  const spec = typeof kind === "string" ? OP_FIELDS[kind as OpKind] : undefined;
  if (!spec) throw invalid({ ...problems, kind: "Unknown operation kind." });
  for (const [key, value] of Object.entries(fields)) {
    if (!spec.required.includes(key) && !(spec.optional ?? []).includes(key)) problems[key] = `${key} is not a field of ${kind as string}.`;
    else if (!fits(SHAPE[key], value)) problems[key] = `${key} has the wrong type.`;
  }
  for (const key of spec.required) if (!(key in fields)) problems[key] = `${key} is required.`;
  if (Object.keys(problems).length) throw invalid(problems);
  // The one boundary cast: every field's presence and JSON shape was checked above.
  return { opId: opId as string, baseSeq: baseSeq as number, op: { kind, ...fields } as OpFields };
}

// ── Executing an operation ───────────────────────────────────────────────────────────────────────

class Recorder {
  readonly changes: Change[] = [];
  readonly inverse: Change[] = [];
  readonly removed: DocNode[] = [];
  constructor(private readonly doc: WorkspaceDoc) {}
  apply(change: Change): void {
    const back = applyChange(this.doc, change);
    if (back.c === "insert" && change.c === "remove") this.removed.push(back.node);
    this.changes.push(change);
    this.inverse.unshift(back);
  }
}

function pageNode(doc: WorkspaceDoc, ctx: ExecContext, id: string): Located & { owner: { kind: "page"; page: Page } } {
  const found = locateOnPage(doc, id);
  if (found) return found;
  const gone = ctx.tombstone?.(id);
  if (gone) throw new ApiError(409, "node_deleted", notice.deletedBy(gone.nodeName, gone.by));
  throw notFound();
}

function freshCopy(ctx: ExecContext, node: DocNode): DocNode {
  const copy = clone(node);
  walk(copy, (n) => (n.id = ctx.newId("n")));
  return copy;
}

function tooManyNodes(page: Page, adding: number): void {
  if (countNodes(page.root) + adding > LIMITS.nodesPerPage) throw invalid({ "": "A page holds at most 500 nodes." });
}

export function slugify(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Make the new node an `insert_node` asks for, validated against its type's props. */
function newNode(ctx: ExecContext, page: Page, o: Extract<OpFields, { kind: "insert_node" }>): DocNode {
  const type = o.type;
  if (!NODE_TYPES.includes(type) || type === "page") throw invalid({ type: "Choose a component type." });
  const problems: Record<string, string> = {};
  const name = o.name ?? defaultName(page.root, type);
  const nameIssue = nameProblem(name);
  if (nameIssue) problems.name = nameIssue;
  const props: NodeProps = { ...defaultProps(type, name), ...(o.props ?? {}) };
  if (type === "image" && props.alt === undefined) problems["props.alt"] = "Alt text is required.";
  if (type === "image" && props.imageId === undefined) problems["props.imageId"] = "Choose an uploaded image.";
  for (const [key, value] of Object.entries(props)) {
    const issue = propProblem(type, key, value);
    if (issue) problems[`props.${key}`] = issue;
  }
  if (Object.keys(problems).length) throw invalid(problems);
  const node: DocNode = { id: ctx.newId("n"), type, name, props, styles: emptyStyles(), children: [] };
  if (type === "collection_list") node.children.push({ id: ctx.newId("n"), type: "stack", name: defaultName(page.root, "stack"), props: {}, styles: emptyStyles(), children: [] });
  return node;
}

/**
 * Validate an operation against the document and apply it in place as primitive changes.
 * Throws ApiError (404, 409 or 422) and leaves the document untouched when refused.
 */
export function execute(doc: WorkspaceDoc, parsed: ParsedOp, ctx: ExecContext): Executed {
  const o = parsed.op;
  const rec = new Recorder(doc);
  let created: Created | undefined;

  switch (o.kind) {
    case "insert_node":
    case "insert_instance": {
      const page = doc.pages.find((p) => p.id === o.pageId);
      if (!page) throw notFound();
      const parent = pageNode(doc, ctx, o.parentId);
      const component = o.kind === "insert_instance" ? doc.components.find((c) => c.id === o.componentId) : undefined;
      if (o.kind === "insert_instance" && !component) throw notFound();
      if (o.kind === "insert_node" && o.props?.imageId !== undefined) checkImage(ctx, o.props.imageId, "props.imageId");
      const type = component ? component.root.type : o.kind === "insert_node" ? o.type : "section";
      if (parent.owner.page.id !== page.id) throw invalidMove("parentId", "The parent is not on this page.");
      if (!canReceive(parent.node.type, type)) throw invalidMove("parentId", "That parent cannot take this node.");
      if (o.index < 0 || o.index > parent.node.children.length) throw invalidMove("index", "That index is out of range.");
      const inInstance = instanceRoot(parent);
      if (component && inInstance) throw invalidMove("parentId", "A linked instance cannot hold another instance.");
      const node: DocNode = component
        ? { ...freshCopy(ctx, component.root), name: component.root.name, shared: { componentId: component.id } }
        : newNode(ctx, page, o as Extract<OpFields, { kind: "insert_node" }>);
      tooManyNodes(page, countNodes(node));
      for (const target of inInstance ? mirrors(doc, parent) : [parent.node]) {
        rec.apply({ c: "insert", parent: target.id, index: o.index, node: target === parent.node ? node : freshCopy(ctx, node) });
      }
      created = { nodeId: node.id };
      break;
    }
    case "move_node": {
      const moving = pageNode(doc, ctx, o.nodeId);
      pageNode(doc, ctx, o.parentId);
      if (!moving.parent) throw invalidMove("parentId", "The page root cannot move.");
      const problem = moveProblem(doc, moving.node.id, o.parentId, o.index);
      if (problem) throw invalidMove(problem, problem === "index" ? "That index is out of range." : "That parent cannot take this node.");
      const root = instanceRoot(moving);
      if (root && root !== moving.node) {
        const nodePath = pathFrom(root, moving.node) ?? [];
        const parentPath = pathFrom(root, mustLocate(doc, o.parentId).node) ?? [];
        const pairs = mirrors(doc, mustLocate(doc, root.id)).map((r) => [nodeAt(r, nodePath), nodeAt(r, parentPath)] as const);
        for (const [n, p] of pairs) if (n && p) rec.apply({ c: "move", node: n.id, parent: p.id, index: o.index });
      } else rec.apply({ c: "move", node: moving.node.id, parent: o.parentId, index: o.index });
      break;
    }
    case "delete_node": {
      const found = pageNode(doc, ctx, o.nodeId);
      if (!found.parent) throw invalid({ nodeId: "The page root cannot be deleted." });
      for (const target of mirrors(doc, found, false)) rec.apply({ c: "remove", node: target.id });
      break;
    }
    case "duplicate_node": {
      const found = pageNode(doc, ctx, o.nodeId);
      if (!found.parent) throw invalid({ nodeId: "The page root cannot be duplicated." });
      tooManyNodes(found.owner.page, countNodes(found.node));
      for (const target of mirrors(doc, found, false)) {
        const at = mustLocate(doc, target.id);
        const copy = freshCopy(ctx, target);
        if (target === found.node) created = { nodeId: copy.id };
        rec.apply({ c: "insert", parent: at.parent?.id ?? "", index: at.index + 1, node: copy });
      }
      break;
    }
    case "rename_node": {
      const found = pageNode(doc, ctx, o.nodeId);
      const issue = nameProblem(o.name);
      if (issue) throw invalid({ name: issue });
      for (const target of mirrors(doc, found, false)) rec.apply({ c: "name", node: target.id, name: o.name });
      break;
    }
    case "set_prop": {
      const found = pageNode(doc, ctx, o.nodeId);
      if (o.prop === "imageId") checkImage(ctx, o.value, "value");
      const issue = propProblem(found.node.type, o.prop, o.value);
      if (issue) throw invalid({ [(PROPS_BY_TYPE[found.node.type] as readonly string[]).includes(o.prop) ? "value" : "prop"]: issue });
      for (const target of mirrors(doc, found)) rec.apply({ c: "prop", node: target.id, prop: o.prop, value: o.value });
      break;
    }
    case "set_style":
    case "clear_style": {
      const found = pageNode(doc, ctx, o.nodeId);
      const problems: Record<string, string> = {};
      if (!BREAKPOINTS.includes(o.breakpoint)) problems.breakpoint = "breakpoint is desktop, tablet or phone.";
      if (!STYLE_KEYS.includes(o.property)) problems.property = "That is not a style property.";
      else if (o.kind === "set_style") {
        const issue = styleValueProblem(o.property, o.value, doc.tokens);
        if (issue) problems.value = issue;
      }
      if (Object.keys(problems).length) throw invalid(problems);
      const value = o.kind === "set_style" ? clone(o.value) : undefined;
      for (const target of mirrors(doc, found)) rec.apply({ c: "style", node: target.id, bp: o.breakpoint, key: o.property, value });
      break;
    }
    case "set_token": {
      const problems: Record<string, string> = {};
      const nameIssue = tokenNameProblem(o.name);
      if (nameIssue) problems.name = nameIssue;
      const existing = doc.tokens.find((t) => t.name === o.name);
      let token: Token;
      if (typeof o.value === "string") {
        if (!isColourName(o.value)) problems.value = "A colour token takes a CSS named colour.";
        if (o.unit !== undefined) problems.unit = "A colour token has no unit.";
        token = { name: o.name, kind: "color", value: o.value };
      } else {
        const issue = sizeTokenProblem(o.value, o.unit);
        if (issue) problems[o.unit === "px" || o.unit === "rem" ? "value" : "unit"] = issue;
        token = { name: o.name, kind: "size", value: o.value, unit: o.unit === "rem" ? "rem" : "px" };
      }
      if (existing && existing.kind !== token.kind) problems.value = `${existing.name} is a ${existing.kind} token.`;
      if (!existing && doc.tokens.length >= LIMITS.tokens) problems.name = "A workspace holds at most 40 tokens.";
      if (Object.keys(problems).length) throw invalid(problems);
      rec.apply({ c: "token", name: o.name, index: existing ? doc.tokens.indexOf(existing) : doc.tokens.length, token });
      break;
    }
    case "rename_token": {
      const problems: Record<string, string> = {};
      if (!doc.tokens.some((t) => t.name === o.name)) problems.name = "There is no token with that name.";
      const issue = tokenNameProblem(o.newName);
      if (issue) problems.newName = issue;
      else if (doc.tokens.some((t) => t.name === o.newName)) problems.newName = `A token named ${o.newName} already exists.`;
      if (Object.keys(problems).length) throw invalid(problems);
      rec.apply({ c: "tokenRename", from: o.name, to: o.newName });
      break;
    }
    case "delete_token": {
      const token = doc.tokens.find((t) => t.name === o.name);
      if (!token) throw invalid({ name: "There is no token with that name." });
      const uses = tokenUses(doc, token.name);
      if (uses > 0) throw new ApiError(409, "token_in_use", notice.tokenInUse(token.name, uses));
      rec.apply({ c: "token", name: token.name, index: doc.tokens.indexOf(token) });
      break;
    }
    case "create_component": {
      const found = pageNode(doc, ctx, o.nodeId);
      const problems: Record<string, string> = {};
      const issue = nameProblem(o.name);
      if (issue) problems.name = issue;
      if (!found.parent) problems.nodeId = "The page root cannot become a shared component.";
      else if (instanceRoot(found) || containsInstance(found.node)) problems.nodeId = "A shared component cannot hold a linked instance.";
      if (Object.keys(problems).length) throw invalid(problems);
      const id = ctx.newId("cp");
      rec.apply({ c: "component", id, index: doc.components.length, component: { id, name: o.name, root: freshCopy(ctx, found.node) } });
      rec.apply({ c: "shared", node: found.node.id, componentId: id });
      created = { componentId: id };
      break;
    }
    case "detach_instance": {
      const found = pageNode(doc, ctx, o.nodeId);
      if (!found.node.shared) throw invalid({ nodeId: "Only a linked instance root can be detached." });
      rec.apply({ c: "shared", node: found.node.id });
      break;
    }
    case "delete_component": {
      const component = doc.components.find((c) => c.id === o.componentId);
      if (!component) throw notFound();
      const instances = linkedInstances(doc, component.id).length;
      if (instances > 0) throw new ApiError(409, "component_in_use", notice.componentInUse(component.name, instances));
      rec.apply({ c: "component", id: component.id, index: doc.components.indexOf(component) });
      break;
    }
    case "set_fields": {
      const problems: Record<string, string> = {};
      if (o.fields.length > LIMITS.fields) problems.fields = "A collection has at most 20 fields.";
      const seen = new Set<string>();
      o.fields.forEach((field: Partial<Field> | null, i) => {
        if (typeof field !== "object" || field === null || Object.keys(field).some((k) => k !== "name" && k !== "kind")) {
          problems[`fields.${i}`] = "A field has a name and a kind.";
          return;
        }
        const issue = nameProblem(field.name);
        if (issue) problems[`fields.${i}.name`] = issue;
        else if (seen.has(field.name as string)) problems[`fields.${i}.name`] = "Field names are unique.";
        seen.add(field.name as string);
        if (!["text", "rich_text", "image"].includes(field.kind as string)) problems[`fields.${i}.kind`] = "A field kind is text, rich_text or image.";
      });
      const removed = doc.collection.fields.filter((f) => !seen.has(f.name));
      for (const field of removed) {
        const bound = fieldBindings(doc, field.name);
        if (bound > 0) throw new ApiError(409, "field_in_use", notice.fieldInUse(field.name, bound));
      }
      if (Object.keys(problems).length) throw invalid(problems);
      rec.apply({ c: "fields", fields: o.fields.map((f) => ({ name: f.name, kind: f.kind })) });
      doc.collection.entries.forEach((entry, index) => {
        if (removed.some((f) => f.name in entry.values)) {
          rec.apply({ c: "entry", id: entry.id, index, values: Object.fromEntries(Object.entries(entry.values).filter(([k]) => seen.has(k))) });
        }
      });
      break;
    }
    case "put_entry": {
      const entry = o.entryId === undefined ? undefined : doc.collection.entries.find((e) => e.id === o.entryId);
      if (o.entryId !== undefined && !entry) throw notFound();
      const fields = doc.collection.fields;
      const values: Record<string, unknown> = o.values;
      for (const [key, value] of Object.entries(values)) {
        if (fields.find((f) => f.name === key)?.kind === "image" && value !== "") checkImage(ctx, value, `values.${key}`);
      }
      const problems: Record<string, string> = {};
      const next: Record<string, string> = { ...(entry?.values ?? {}) };
      for (const [key, value] of Object.entries(values)) {
        const field = fields.find((f) => f.name === key);
        if (!field) problems[`values.${key}`] = `There is no field named ${key}.`;
        else if (typeof value !== "string") problems[`values.${key}`] = "A value is text.";
        else if (field.kind === "image") {
          if (value !== "" && !/^img_[a-z0-9]{12}$/.test(value)) problems[`values.${key}`] = "Choose an uploaded image.";
          else next[key] = value;
        } else {
          const kept = field.kind === "rich_text" ? sanitizeRichText(value) : value;
          if (kept.length > LIMITS.text) problems[`values.${key}`] = "A value is at most 2,000 characters.";
          else next[key] = kept;
        }
      }
      if (!entry && doc.collection.entries.length >= LIMITS.entries) problems.values = "A collection holds at most 200 entries.";
      if (Object.keys(problems).length) throw invalid(problems);
      const id = entry?.id ?? ctx.newId("e");
      rec.apply({ c: "entry", id, index: entry ? doc.collection.entries.indexOf(entry) : doc.collection.entries.length, values: next });
      if (!entry) created = { entryId: id };
      break;
    }
    case "move_entry": {
      const entries = doc.collection.entries;
      const entry = entries.find((e) => e.id === o.entryId);
      if (!entry) throw notFound();
      if (o.index < 0 || o.index >= entries.length) throw invalid({ index: "That index is out of range." });
      rec.apply({ c: "entry", id: entry.id, index: o.index, values: entry.values });
      break;
    }
    case "delete_entry": {
      const entry = doc.collection.entries.find((e) => e.id === o.entryId);
      if (!entry) throw notFound();
      rec.apply({ c: "entry", id: entry.id, index: doc.collection.entries.indexOf(entry) });
      break;
    }
    case "bind_prop": {
      const found = pageNode(doc, ctx, o.nodeId);
      const problems: Record<string, string> = {};
      if (!enclosingList(found)) problems.nodeId = "Only a node inside a collection list template can be bound.";
      if (MAIN_PROP[found.node.type] !== o.prop) problems.prop = "Only the node's main property can be bound.";
      if (o.field !== null) {
        const field = doc.collection.fields.find((f) => f.name === o.field);
        if (!field) problems.field = "There is no field with that name.";
        else if (!fieldAccepts(found.node.type, field.kind)) problems.field = `A ${field.kind} field cannot fill this property.`;
      }
      if (Object.keys(problems).length) throw invalid(problems);
      for (const target of mirrors(doc, found)) rec.apply({ c: "bind", node: target.id, prop: o.prop, field: o.field ?? undefined });
      break;
    }
    case "add_page": {
      const issue = nameProblem(o.name);
      if (issue) throw invalid({ name: issue });
      if (doc.pages.length >= LIMITS.pages) throw invalid({ name: "A workspace holds at most 20 pages." });
      const id = ctx.newId("pg");
      const rootId = ctx.newId("n");
      const slug = slugify(o.name, new Set(doc.pages.map((p) => p.slug)));
      const root: DocNode = { id: rootId, type: "page", name: o.name, props: {}, styles: emptyStyles(), children: [] };
      rec.apply({ c: "page", id, index: doc.pages.length, page: { id, name: o.name, slug, order: doc.pages.length, root } });
      created = { pageId: id, nodeId: rootId };
      break;
    }
    case "rename_page": {
      const page = doc.pages.find((p) => p.id === o.pageId);
      if (!page) throw notFound();
      const issue = nameProblem(o.name);
      if (issue) throw invalid({ name: issue });
      rec.apply({ c: "pageName", id: page.id, name: o.name });
      break;
    }
    case "undo":
    case "redo":
      throw new Error("undo and redo are applied from the server's stacks");
  }
  return { changes: rec.changes, inverse: rec.inverse, created, removed: rec.removed };
}

const ID_MAKING: ReadonlySet<OpKind> = new Set(["insert_node", "insert_instance", "duplicate_node", "create_component", "add_page"]);

/** Whether an operation needs server-made ids (a client never invents one) before it can show. */
export function needsServerIds(op: OpFields): boolean {
  return ID_MAKING.has(op.kind) || (op.kind === "put_entry" && op.entryId === undefined) || op.kind === "undo" || op.kind === "redo";
}

// ── What an operation touched ────────────────────────────────────────────────────────────────────

export interface Touches {
  /** Things changed: style keys, props, names, tokens, entries. */
  keys: string[];
  /** Nodes the operation was about. */
  nodes: string[];
  /** Nodes moved or deleted. */
  structural: string[];
  restore: boolean;
}

export function touchesOf(changes: readonly Change[], inverse: readonly Change[]): Touches {
  const t: Touches = { keys: [], nodes: [], structural: [], restore: false };
  const add = (list: string[], key: string) => !list.includes(key) && list.push(key);
  for (const change of changes) {
    switch (change.c) {
      case "prop":
        add(t.keys, `prop:${change.node}:${change.prop}`);
        add(t.nodes, `node:${change.node}`);
        break;
      case "style":
        add(t.keys, `style:${change.node}:${change.bp}:${change.key}`);
        add(t.nodes, `node:${change.node}`);
        break;
      case "name":
        add(t.keys, `name:${change.node}`);
        add(t.nodes, `node:${change.node}`);
        break;
      case "bind":
        add(t.keys, `bind:${change.node}:${change.prop}`);
        add(t.nodes, `node:${change.node}`);
        break;
      case "shared":
        add(t.keys, `shared:${change.node}`);
        add(t.nodes, `node:${change.node}`);
        break;
      case "insert":
        add(t.nodes, `node:${change.node.id}`);
        break;
      case "remove": {
        const back = inverse.find((i) => i.c === "insert" && i.node.id === change.node);
        const ids = back && back.c === "insert" ? subtreeIds(back.node) : [change.node];
        ids.forEach((id) => add(t.structural, `node:${id}`));
        add(t.nodes, `node:${change.node}`);
        break;
      }
      case "move":
        add(t.structural, `node:${change.node}`);
        add(t.nodes, `node:${change.node}`);
        break;
      case "token":
        add(t.keys, `token:${change.name}`);
        if (change.token) add(t.keys, `token:${change.token.name}`);
        break;
      case "tokenRename":
        add(t.keys, `token:${change.from}`);
        add(t.keys, `token:${change.to}`);
        break;
      case "component":
        add(t.keys, `component:${change.id}`);
        break;
      case "fields":
        add(t.keys, "fields");
        break;
      case "entry":
        add(t.keys, `entry:${change.id}`);
        break;
      case "page":
        add(t.keys, `page:${change.id}`);
        break;
      case "pageName":
        add(t.keys, `pageName:${change.id}`);
        break;
      case "doc":
        t.restore = true;
        break;
    }
  }
  return t;
}

/** The pages whose published output an operation can change (Publishing: live_changed). */
export function affectedPages(before: WorkspaceDoc, after: WorkspaceDoc, changes: readonly Change[]): string[] {
  const pages = new Set<string>();
  const pageOf = (doc: WorkspaceDoc, id: string) => locateOnPage(doc, id)?.owner.page.id;
  const usesToken = (doc: WorkspaceDoc, name: string) => {
    for (const page of doc.pages)
      walk(page.root, (n) => {
        for (const bp of BREAKPOINTS) for (const v of Object.values(n.styles[bp])) if (isTokenRef(v) && v.token === name) pages.add(page.id);
      });
  };
  const withLists = (doc: WorkspaceDoc) => doc.pages.forEach((p) => walk(p.root, (n) => n.type === "collection_list" && pages.add(p.id)));
  for (const change of changes) {
    switch (change.c) {
      case "prop":
      case "style":
      case "name":
      case "bind":
      case "shared":
      case "remove":
      case "move": {
        const id = change.node;
        [pageOf(before, id), pageOf(after, id)].forEach((p) => p && pages.add(p));
        if (change.c === "move") [pageOf(after, change.parent)].forEach((p) => p && pages.add(p));
        break;
      }
      case "insert": {
        const p = pageOf(after, change.parent);
        if (p) pages.add(p);
        break;
      }
      case "token":
        usesToken(before, change.name);
        usesToken(after, change.token?.name ?? change.name);
        break;
      case "tokenRename":
        usesToken(after, change.to);
        break;
      case "component":
        for (const doc of [before, after]) linkedInstances(doc, change.id).forEach((i) => pages.add(i.page.id));
        break;
      case "fields":
      case "entry":
        withLists(before);
        withLists(after);
        break;
      case "page":
      case "pageName":
        pages.add(change.id);
        break;
      case "doc":
        before.pages.forEach((p) => pages.add(p.id));
        after.pages.forEach((p) => pages.add(p.id));
        break;
    }
  }
  return [...pages];
}

/** Validate a whole document body (grading seed); returns problems keyed by dotted path. */
export function documentProblems(doc: DocBody): Record<string, string> {
  const problems: Record<string, string> = {};
  const tokens = doc.tokens;
  tokens.forEach((t, i) => {
    if (tokenNameProblem(t.name)) problems[`tokens.${i}.name`] = "Invalid token name.";
    if (t.kind === "color" ? !isColourName(t.value) : sizeTokenProblem(t.value, t.unit)) problems[`tokens.${i}.value`] = "Invalid token value.";
  });
  const checkNode = (node: DocNode, path: string, parent: DocNode | null) => {
    if (!NODE_TYPES.includes(node.type)) problems[`${path}.type`] = "Unknown node type.";
    if (nameProblem(node.name)) problems[`${path}.name`] = "A name is 1 to 80 characters.";
    if (parent && !canReceive(parent.type, node.type) && !(parent.type === "collection_list" && parent.children.length === 1))
      problems[`${path}.type`] = "This parent cannot take this node.";
    for (const [key, value] of Object.entries(node.props ?? {})) {
      const issue = propProblem(node.type, key, value);
      if (issue && !(key === "imageId" && node.type === "image")) problems[`${path}.props.${key}`] = issue;
    }
    for (const bp of BREAKPOINTS)
      for (const [key, value] of Object.entries(node.styles?.[bp] ?? {})) {
        const issue = (STYLE_KEYS as readonly string[]).includes(key) ? styleValueProblem(key as StyleKey, value, tokens) : "Unknown style key.";
        if (issue) problems[`${path}.styles.${bp}.${key}`] = issue;
      }
    node.children.forEach((c, i) => checkNode(c, `${path}.children.${i}`, node));
  };
  doc.pages.forEach((p, i) => checkNode(p.root, `pages.${i}.root`, null));
  doc.components.forEach((c, i) => checkNode(c.root, `components.${i}.root`, null));
  return problems;
}

