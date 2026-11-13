import type {
  ApiErrorBody,
  Assembly,
  Bom,
  Material,
  Member,
  Part,
  PurchasedPart,
  Sketch,
  TreeRow,
  Workspace,
} from '../shared/api.js';

export type ServerError = ApiErrorBody['error'];

export type Outcome<T> =
  | { kind: 'ok'; data: T; replayed: boolean }
  | { kind: 'error'; status: number; error: ServerError }
  | { kind: 'offline' };

type RequestOptions = { body?: unknown; idempotencyKey?: string };

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Outcome<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    return { kind: 'offline' };
  }
  const replayed = response.headers.get('idempotent-replayed') === 'true';
  if (response.status === 204) return { kind: 'ok', data: undefined as T, replayed };
  const text = await response.text();
  const payload: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    return {
      kind: 'error',
      status: response.status,
      error: (payload as ApiErrorBody).error,
    };
  }
  return { kind: 'ok', data: payload as T, replayed };
}

export const api = {
  signIn: (email: string, password: string) =>
    request<{ member: Member }>('POST', '/api/session', { body: { email, password } }),
  signOut: () => request<void>('DELETE', '/api/session'),
  me: () => request<{ member: Member }>('GET', '/api/me'),
  setPreferences: (body: { units?: string; precision?: number }) =>
    request<{ member: Member }>('PATCH', '/api/me', { body }),
  workspace: () => request<Workspace>('GET', '/api/workspace'),
  materials: () => request<{ materials: Material[] }>('GET', '/api/materials'),
  storageStatus: () => request<{ storage: 'ok' | 'unreachable' }>('GET', '/api/status'),

  parts: () => request<{ parts: Part[] }>('GET', '/api/parts'),
  part: (id: string) => request<{ part: Part }>('GET', `/api/parts/${id}`),
  createPart: (body: { name: string; material_id: string }) =>
    request<{ part: Part }>('POST', '/api/parts', { body }),
  patchPart: (id: string, body: Record<string, unknown>) =>
    request<{ part: Part }>('PATCH', `/api/parts/${id}`, { body }),
  savePart: (id: string) => request<{ part: Part }>('POST', `/api/parts/${id}/save`, { body: {} }),
  partBody: (id: string) =>
    request<{ vertices: [number, number, number][]; triangles: [number, number, number][] }>(
      'GET',
      `/api/parts/${id}/body`,
    ),
  createSketch: (partId: string, body: Record<string, unknown>) =>
    request<{ sketch: Sketch; part: Part }>('POST', `/api/parts/${partId}/sketches`, { body }),
  createFeature: (partId: string, body: Record<string, unknown>, idempotencyKey: string) =>
    request<{ feature: { name: string }; part: Part }>('POST', `/api/parts/${partId}/features`, {
      body,
      idempotencyKey,
    }),
  patchFeature: (partId: string, featureId: string, body: Record<string, unknown>) =>
    request<{ feature: { name: string }; part: Part }>(
      'PATCH',
      `/api/parts/${partId}/features/${featureId}`,
      { body },
    ),

  sketch: (id: string) => request<{ sketch: Sketch }>('GET', `/api/sketches/${id}`),
  addEntity: (sketchId: string, body: Record<string, unknown>) =>
    request<{ sketch: Sketch; part: Part; entity: { id: string; label: string } }>(
      'POST',
      `/api/sketches/${sketchId}/entities`,
      { body },
    ),
  deleteEntity: (sketchId: string, entityId: string, baseRevision: number) =>
    request<{ sketch: Sketch; part: Part }>(
      'DELETE',
      `/api/sketches/${sketchId}/entities/${entityId}?base_revision=${baseRevision}`,
    ),
  addConstraint: (sketchId: string, body: Record<string, unknown>) =>
    request<{ sketch: Sketch; part: Part; constraint: { label: string; redundant: boolean } }>(
      'POST',
      `/api/sketches/${sketchId}/constraints`,
      { body },
    ),
  patchConstraint: (sketchId: string, constraintId: string, body: Record<string, unknown>) =>
    request<{ sketch: Sketch; part: Part; constraint: { label: string; redundant: boolean } }>(
      'PATCH',
      `/api/sketches/${sketchId}/constraints/${constraintId}`,
      { body },
    ),
  deleteConstraint: (sketchId: string, constraintId: string, baseRevision: number) =>
    request<{ sketch: Sketch; part: Part }>(
      'DELETE',
      `/api/sketches/${sketchId}/constraints/${constraintId}?base_revision=${baseRevision}`,
    ),

  assemblies: () => request<{ assemblies: Assembly[] }>('GET', '/api/assemblies'),
  assembly: (id: string) => request<{ assembly: Assembly }>('GET', `/api/assemblies/${id}`),
  createAssembly: (body: { name: string }) =>
    request<{ assembly: Assembly }>('POST', '/api/assemblies', { body }),
  assemblyTree: (id: string) =>
    request<{ assembly: { id: string; name: string }; rows: TreeRow[] }>(
      'GET',
      `/api/assemblies/${id}/tree`,
    ),
  bom: (id: string) => request<Bom>('GET', `/api/assemblies/${id}/bom`),
  addInstance: (id: string, body: Record<string, unknown>, idempotencyKey: string) =>
    request<{ assembly: Assembly }>('POST', `/api/assemblies/${id}/instances`, {
      body,
      idempotencyKey,
    }),
  patchInstance: (id: string, instanceId: string, body: Record<string, unknown>) =>
    request<{ assembly: Assembly }>('PATCH', `/api/assemblies/${id}/instances/${instanceId}`, { body }),
  deleteInstance: (id: string, instanceId: string, baseRevision: number) =>
    request<{ assembly: Assembly }>(
      'DELETE',
      `/api/assemblies/${id}/instances/${instanceId}?base_revision=${baseRevision}`,
    ),

  purchased: () => request<{ purchased: PurchasedPart[] }>('GET', '/api/purchased'),
  createPurchased: (body: { name: string; declared_mass_g: number }) =>
    request<{ purchased: PurchasedPart }>('POST', '/api/purchased', { body }),
};
