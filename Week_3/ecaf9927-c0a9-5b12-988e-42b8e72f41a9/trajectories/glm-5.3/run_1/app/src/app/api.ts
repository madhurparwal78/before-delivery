import type {
  Assembly,
  Bom,
  Material,
  Member,
  Part,
  PurchasedPart,
  Sketch,
  WorkspaceInfo
} from "../shared/types.js";

/** API access from the browser: one fetch wrapper, one error shape. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const reply = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin"
  });
  if (reply.status === 204) return undefined as T;
  const text = await reply.text();
  const parsed: unknown = text === "" ? undefined : JSON.parse(text);
  if (!reply.ok) {
    const err = (parsed as { error?: { code?: string; message?: string; fields?: Record<string, string> } })?.error;
    throw new ApiError(
      reply.status,
      err?.code ?? "unknown",
      err?.message ?? "No answer from the server. Your change was not confirmed.",
      err?.fields
    );
  }
  return parsed as T;
}

export const api = {
  signIn: (email: string, password: string) =>
    request<{ member: Member }>("POST", "/api/session", { email, password }),
  signOut: () => request<void>("DELETE", "/api/session"),
  me: () => request<{ member: Member }>("GET", "/api/me"),
  patchMe: (body: { units?: "mm" | "in"; precision?: number }) =>
    request<{ member: Member }>("PATCH", "/api/me", body),
  workspace: () => request<WorkspaceInfo>("GET", "/api/workspace"),
  materials: () => request<{ materials: Material[] }>("GET", "/api/materials"),
  status: () => request<{ storage: "ok" | "unreachable" }>("GET", "/api/status"),

  parts: () => request<{ parts: Part[] }>("GET", "/api/parts"),
  createPart: (name: string, materialId: string) =>
    request<{ part: Part }>("POST", "/api/parts", { name, material_id: materialId }),
  part: (id: string) => request<{ part: Part }>("GET", `/api/parts/${id}`),
  patchPart: (id: string, body: { base_revision: number; name?: string; material_id?: string }) =>
    request<{ part: Part }>("PATCH", `/api/parts/${id}`, body),
  savePart: (id: string) => request<{ part: Part }>("POST", `/api/parts/${id}/save`, {}),
  bodyObject: async (id: string): Promise<unknown | null> => {
    try {
      return await request<unknown>("GET", `/api/parts/${id}/body`);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 503)) return null;
      throw err;
    }
  },

  createSketch: (partId: string, body: { base_revision: number; plane: string; offset: number | string }) =>
    request<{ sketch: Sketch; part: Part }>("POST", `/api/parts/${partId}/sketches`, body),
  createFeature: (
    partId: string,
    key: string,
    body: { base_revision: number; sketch_id: string; operation: string; depth: number | string; direction: string }
  ) =>
    request<{ feature: Part["features"][number]; part: Part }>("POST", `/api/parts/${partId}/features`, body, {
      "Idempotency-Key": key
    }),
  patchFeature: (partId: string, featureId: string, body: { base_revision: number; depth?: number | string; direction?: string }) =>
    request<{ feature: Part["features"][number]; part: Part }>("PATCH", `/api/parts/${partId}/features/${featureId}`, body),

  sketch: (id: string) => request<{ sketch: Sketch }>("GET", `/api/sketches/${id}`),
  postEntity: (
    sketchId: string,
    body: { base_revision: number; entity: Record<string, unknown> }
  ) =>
    request<{ sketch: Sketch; part: Part }>("POST", `/api/sketches/${sketchId}/entities`, body),
  deleteEntity: (sketchId: string, entityId: string, baseRevision: number) =>
    request<{ sketch: Sketch; part: Part }>("DELETE", `/api/sketches/${sketchId}/entities/${entityId}?base_revision=${baseRevision}`),
  postConstraint: (
    sketchId: string,
    body: { base_revision: number; kind: string; refs: string[]; value?: number | string; tolerance?: unknown }
  ) =>
    request<{ sketch: Sketch; part: Part; constraint: Sketch["constraints"][number] }>(
      "POST",
      `/api/sketches/${sketchId}/constraints`,
      body
    ),
  patchConstraint: (
    sketchId: string,
    constraintId: string,
    body: { base_revision: number; value?: number | string; tolerance?: unknown }
  ) =>
    request<{ sketch: Sketch; part: Part; constraint: Sketch["constraints"][number] }>(
      "PATCH",
      `/api/sketches/${sketchId}/constraints/${constraintId}`,
      body
    ),
  deleteConstraint: (sketchId: string, constraintId: string, baseRevision: number) =>
    request<{ sketch: Sketch; part: Part }>(
      "DELETE",
      `/api/sketches/${sketchId}/constraints/${constraintId}?base_revision=${baseRevision}`
    ),

  assemblies: () => request<{ assemblies: Assembly[] }>("GET", "/api/assemblies"),
  createAssembly: (name: string) =>
    request<{ assembly: Assembly }>("POST", "/api/assemblies", { name }),
  assembly: (id: string) => request<{ assembly: Assembly }>("GET", `/api/assemblies/${id}`),
  tree: (id: string) =>
    request<{ assembly: { id: string; name: string }; rows: import("../shared/types.js").TreeRow[] }>(
      "GET",
      `/api/assemblies/${id}/tree`
    ),
  bom: (id: string) => request<Bom>("GET", `/api/assemblies/${id}/bom`),
  postInstance: (
    assemblyId: string,
    key: string,
    body: { base_revision: number; component: { type: string; id: string }; quantity: number }
  ) =>
    request<{ assembly: Assembly; instance: unknown }>(
      "POST",
      `/api/assemblies/${assemblyId}/instances`,
      body,
      { "Idempotency-Key": key }
    ),
  patchInstance: (assemblyId: string, instanceId: string, body: { base_revision: number; quantity: number }) =>
    request<{ assembly: Assembly }>("PATCH", `/api/assemblies/${assemblyId}/instances/${instanceId}`, body),
  deleteInstance: (assemblyId: string, instanceId: string, baseRevision: number) =>
    request<{ assembly: Assembly }>(
      "DELETE",
      `/api/assemblies/${assemblyId}/instances/${instanceId}?base_revision=${baseRevision}`
    ),

  purchased: () => request<{ purchased: PurchasedPart[] }>("GET", "/api/purchased"),
  createPurchased: (name: string, declaredMassG: number) =>
    request<{ purchased: PurchasedPart }>("POST", "/api/purchased", { name, declared_mass_g: declaredMassG }),
  patchPurchased: (id: string, body: { base_revision: number; name?: string; declared_mass_g?: number }) =>
    request<{ purchased: PurchasedPart }>("PATCH", `/api/purchased/${id}`, body)
};

/** One Idempotency-Key per intended action; resent on repeated presses. */
export class KeyStore {
  private keys = new Map<string, string>();

  keyFor(intent: string): string {
    const existing = this.keys.get(intent);
    if (existing) return existing;
    const key = crypto.randomUUID();
    this.keys.set(intent, key);
    return key;
  }

  clear(intent: string): void {
    this.keys.delete(intent);
  }
}
