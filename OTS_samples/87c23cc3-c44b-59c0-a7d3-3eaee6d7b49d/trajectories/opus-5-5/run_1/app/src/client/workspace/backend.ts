import type { Colour, Layout } from "../../shared/layout.js";
import { arrangeLayout } from "../../shared/layout.js";
import type { Ref } from "../../shared/model.js";
import { parseMortise } from "../../shared/mortise.js";
import { SCHEMA_HAS_ERRORS, planGroup, planLink, planRename, planUngroup, refusalMessage } from "../../shared/writes.js";
import { api } from "../api.js";
import { pageConfig } from "../config.js";
import type { EditSync } from "./sync.js";

export type OpResult<T> = { ok: true; value: T } | { ok: false; message: string; fields: Record<string, string> | null };

export interface TextChange {
  /** The text the change was made on, for typing the difference in. */
  before: string;
  text: string;
  layout: Layout | null;
}

export type LayoutPatch = {
  entities?: Record<string, { x?: number; y?: number; color?: Colour }>;
  groups?: Record<string, { color: Colour }>;
};

/** The writes the diagram makes: saved through the API for projects, applied in place for the sample. */
export interface Backend {
  link(from: Ref, to: Ref): Promise<OpResult<TextChange>>;
  group(name: string, entities: string[], color: Colour): Promise<OpResult<TextChange>>;
  ungroup(name: string): Promise<OpResult<TextChange>>;
  rename(from: string, to: string): Promise<OpResult<TextChange>>;
  layout(patch: LayoutPatch): Promise<OpResult<Layout>>;
  arrange(): Promise<OpResult<Layout>>;
}

export interface WorkspaceAccess {
  getText(): string;
  getLayout(): Layout;
  showText(text: string): void;
}

export function projectBackend(projectId: string, sync: EditSync, access: WorkspaceAccess): Backend {
  const base = `/api/projects/${projectId}`;
  const write = async (method: string, path: string, body?: Record<string, unknown>): Promise<OpResult<TextChange>> => {
    await sync.flush();
    const before = sync.serverText;
    const query = method === "DELETE" ? `?baseRevision=${sync.revision}` : "";
    const result = await api<{ revision: number; text: string; layout?: Layout }>(
      method,
      `${base}${path}${query}`,
      body ? { ...body, baseRevision: sync.revision } : undefined,
    );
    if (result.ok) {
      sync.accept(result.data.revision, result.data.text);
      return { ok: true, value: { before, text: result.data.text, layout: result.data.layout ?? null } };
    }
    const error = result.error;
    if (result.status === 409 && error?.revision !== undefined && error.text !== undefined) {
      sync.accept(error.revision, error.text);
      access.showText(error.text);
    }
    const fields = error?.fields ?? null;
    return { ok: false, message: fields ? Object.values(fields)[0]! : (error?.message ?? ""), fields };
  };
  const layoutCall = async (path: string, method: string, body?: unknown): Promise<OpResult<Layout>> => {
    const result = await api<{ layout: Layout }>(method, `${base}${path}`, body);
    if (result.ok) return { ok: true, value: result.data.layout };
    const fields = result.error?.fields ?? null;
    return { ok: false, message: fields ? Object.values(fields)[0]! : (result.error?.message ?? ""), fields };
  };
  return {
    link: (from, to) => write("POST", "/links", { from: `${from.entity}.${from.column}`, to: `${to.entity}.${to.column}` }),
    group: (name, entities, color) => write("POST", "/groups", { name, entities, color }),
    ungroup: (name) => write("DELETE", `/groups/${encodeURIComponent(name)}`),
    rename: (from, to) => write("POST", "/entities/rename", { from, to }),
    layout: (patch) => layoutCall("/layout", "PATCH", patch),
    arrange: () => layoutCall("/layout/arrange", "POST"),
  };
}

/** The landing sample never saves: every write is planned and applied on the page. */
export function sampleBackend(access: WorkspaceAccess): Backend {
  const current = () => {
    const text = access.getText();
    return { text, parse: parseMortise(text, pageConfig.limits) };
  };
  const errorsFirst = <T>(): OpResult<T> | null => {
    const { parse } = current();
    return parse.errors.length ? { ok: false, message: SCHEMA_HAS_ERRORS, fields: null } : null;
  };
  return {
    async link(from, to) {
      const blocked = errorsFirst<TextChange>();
      if (blocked) return blocked;
      const { text, parse } = current();
      const planned = planLink(text, parse, `${from.entity}.${from.column}`, `${to.entity}.${to.column}`, pageConfig.limits);
      if (!planned.ok)
        return {
          ok: false,
          message: refusalMessage(planned.refusal),
          fields: planned.refusal.kind === "fields" ? planned.refusal.fields : null,
        };
      return { ok: true, value: { before: text, text: planned.value.text, layout: null } };
    },
    async group(name, entities, color) {
      const blocked = errorsFirst<TextChange>();
      if (blocked) return blocked;
      const { text, parse } = current();
      const planned = planGroup(text, parse, access.getLayout(), name, entities, color);
      if (!planned.ok)
        return {
          ok: false,
          message: refusalMessage(planned.refusal),
          fields: planned.refusal.kind === "fields" ? planned.refusal.fields : null,
        };
      return { ok: true, value: { before: text, ...planned.value } };
    },
    async ungroup(name) {
      const blocked = errorsFirst<TextChange>();
      if (blocked) return blocked;
      const { text, parse } = current();
      return { ok: true, value: { before: text, text: planUngroup(text, parse, name)!, layout: null } };
    },
    async rename(from, to) {
      const blocked = errorsFirst<TextChange>();
      if (blocked) return blocked;
      const { text, parse } = current();
      const planned = planRename(text, parse, access.getLayout(), from, to);
      if (!planned.ok)
        return {
          ok: false,
          message: refusalMessage(planned.refusal),
          fields: planned.refusal.kind === "fields" ? planned.refusal.fields : null,
        };
      return { ok: true, value: { before: text, ...planned.value } };
    },
    async layout(patch) {
      const layout = structuredClone(access.getLayout());
      for (const [name, change] of Object.entries(patch.entities ?? {})) {
        const entry = layout.entities[name];
        if (entry) Object.assign(entry, change);
      }
      for (const [name, change] of Object.entries(patch.groups ?? {})) if (layout.groups[name]) layout.groups[name] = change;
      return { ok: true, value: layout };
    },
    async arrange() {
      return { ok: true, value: arrangeLayout(access.getLayout(), parseMortise(access.getText(), pageConfig.limits).model) };
    },
  };
}
