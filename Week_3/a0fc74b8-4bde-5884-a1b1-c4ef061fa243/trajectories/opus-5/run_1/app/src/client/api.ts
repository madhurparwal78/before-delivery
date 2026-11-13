import type {
  AuditEventJson,
  DocumentFilter,
  DocumentJson,
  DocumentRowJson,
  FieldJson,
  RecipientJson,
  SessionJson,
  SignViewJson,
  TeamJson,
  TeamMemberJson,
  TemplateJson,
} from '../shared/types.ts';

export interface ApiFailure {
  status: number;
  error: string;
  fields: Record<string, string>;
  extra: Record<string, unknown>;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.error);
    this.failure = failure;
  }
}

const parseFields = (value: unknown): Record<string, string> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
};

const request = async (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<unknown> => {
  const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const response = await fetch(path, init);
  if (response.status === 204) return null;
  const text = await response.text();
  let payload: unknown = null;
  if (text !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const record =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    throw new ApiCallError({
      status: response.status,
      error: typeof record['error'] === 'string' ? record['error'] : 'unknown',
      fields: parseFields(record['fields']),
      extra: record,
    });
  }
  return payload;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The one boundary where a parsed JSON response takes the shape the brief's API
 * section publishes for that route.
 */
const shaped = <T>(value: unknown): T => value as T;

const pick = <T>(value: unknown, key: string, fallback: T): T => {
  const entry = asRecord(value)[key];
  return entry === undefined ? fallback : shaped<T>(entry);
};

export const api = {
  signIn: async (email: string, password: string): Promise<SessionJson> =>
    shaped(await request('POST', '/api/session', { email, password })),
  session: async (): Promise<SessionJson> => shaped(await request('GET', '/api/session')),
  signOut: async (): Promise<void> => {
    await request('DELETE', '/api/session');
  },
  documents: async (filter: DocumentFilter): Promise<DocumentRowJson[]> =>
    pick(await request('GET', `/api/documents?filter=${filter}`), 'documents', []),
  document: async (id: string): Promise<DocumentJson> =>
    shaped(await request('GET', `/api/documents/${id}`)),
  patchDocument: async (id: string, patch: Record<string, unknown>): Promise<DocumentJson> =>
    shaped(await request('PATCH', `/api/documents/${id}`, patch)),
  upload: async (file: File, title: string): Promise<DocumentJson> => {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('title', title);
    const response = await fetch('/api/documents', {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const record = asRecord(payload);
      throw new ApiCallError({
        status: response.status,
        error: typeof record['error'] === 'string' ? record['error'] : 'unknown',
        fields: parseFields(record['fields']),
        extra: record,
      });
    }
    return shaped<DocumentJson>(payload);
  },
  addRecipient: async (id: string, name: string, email: string): Promise<RecipientJson> =>
    shaped(await request('POST', `/api/documents/${id}/recipients`, { name, email })),
  removeRecipient: async (id: string, recipientId: string): Promise<void> => {
    await request('DELETE', `/api/documents/${id}/recipients/${recipientId}`);
  },
  moveRecipient: async (
    id: string,
    recipientId: string,
    direction: 'up' | 'down',
  ): Promise<RecipientJson[]> =>
    pick(
      await request('POST', `/api/documents/${id}/recipients/${recipientId}/move`, { direction }),
      'recipients',
      [],
    ),
  createField: async (id: string, field: Record<string, unknown>): Promise<FieldJson> =>
    shaped(await request('POST', `/api/documents/${id}/fields`, field)),
  patchField: async (
    id: string,
    fieldId: string,
    patch: Record<string, unknown>,
  ): Promise<FieldJson> =>
    shaped(await request('PATCH', `/api/documents/${id}/fields/${fieldId}`, patch)),
  deleteField: async (id: string, fieldId: string): Promise<void> => {
    await request('DELETE', `/api/documents/${id}/fields/${fieldId}`);
  },
  send: async (id: string, idempotencyKey: string): Promise<DocumentJson> =>
    shaped(await request('POST', `/api/documents/${id}/send`, undefined, {
      'idempotency-key': idempotencyKey,
    })),
  remind: async (id: string): Promise<string> =>
    pick(await request('POST', `/api/documents/${id}/remind`), 'reminderAvailableAt', ''),
  newLink: async (id: string, recipientId: string): Promise<DocumentJson> =>
    shaped(await request(
      'POST',
      `/api/documents/${id}/recipients/${recipientId}/new-link`,
    )),
  voidDocument: async (id: string, reason: string): Promise<DocumentJson> =>
    shaped(await request('POST', `/api/documents/${id}/void`, { reason })),
  audit: async (id: string): Promise<AuditEventJson[]> =>
    pick(await request('GET', `/api/documents/${id}/audit`), 'events', []),
  saveTemplate: async (id: string): Promise<TemplateJson> =>
    shaped(await request('POST', `/api/documents/${id}/template`)),
  templates: async (): Promise<TemplateJson[]> =>
    pick(await request('GET', '/api/templates'), 'templates', []),
  shareTemplate: async (id: string): Promise<TemplateJson> =>
    shaped(await request('POST', `/api/templates/${id}/share`)),
  retireTemplate: async (id: string): Promise<TemplateJson> =>
    shaped(await request('POST', `/api/templates/${id}/retire`)),
  useTemplate: async (
    id: string,
    signers: Array<{ name: string; email: string }>,
  ): Promise<DocumentJson> =>
    shaped(await request('POST', `/api/templates/${id}/use`, { signers })),
  team: async (): Promise<TeamJson> => shaped(await request('GET', '/api/team')),
  setRole: async (userId: string, role: string): Promise<TeamMemberJson> =>
    shaped(await request('PATCH', `/api/team/members/${userId}`, { role })),
  signView: async (token: string): Promise<SignViewJson> =>
    shaped(await request('GET', `/api/sign/${token}`)),
  putSignField: async (
    token: string,
    fieldId: string,
    body: Record<string, unknown>,
  ): Promise<FieldJson> =>
    shaped(await request('PUT', `/api/sign/${token}/fields/${fieldId}`, body)),
  finish: async (token: string): Promise<string> =>
    pick(await request('POST', `/api/sign/${token}/finish`), 'state', ''),
  decline: async (token: string, reason: string): Promise<string> =>
    pick(await request('POST', `/api/sign/${token}/decline`, { reason }), 'state', ''),
};
