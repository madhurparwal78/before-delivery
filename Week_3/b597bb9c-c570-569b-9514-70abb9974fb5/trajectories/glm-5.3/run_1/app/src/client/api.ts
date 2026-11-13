import type { Person, Project, Row, Clip, Caption, Comment, Allowance, Cut, ExportRecord, Media, Kit, TokenRecord, OutboxItem, ReviewResponse } from '../shared/types';

/** The browser's API client. No service URL or credential ever arrives here. */
export interface SessionPerson {
  person: Person;
  is_owner: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, public body: { error?: string; message?: string; errors?: Record<string, string> }) {
    super(body.message ?? 'error');
  }
}

async function request<T>(path: string, init?: RequestInit & { raw?: boolean }): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}

export interface ProjectBundle {
  project: Project;
  rows: Row[];
  clips: Clip[];
  captions: Caption[];
  members: { person: Person; role: string }[];
}

export interface OpResponse {
  version: number;
  changes: { clips: Clip[]; captions: Caption[]; comments: Comment[]; rows: Row[] };
  removed: string[];
  stopped: { at_frame: number; reason: string } | null;
  project?: Project;
}

export const api = {
  health: (): Promise<{ status: string }> => request('/health'),
  signIn: (email: string, password: string): Promise<{ person: Person }> =>
    request('/session', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email, password }) }),
  session: (): Promise<SessionPerson> => request('/session'),
  signOut: (): Promise<void> => request('/session', { method: 'DELETE' }),
  status: (): Promise<{ storage: string; queue: string; mail: string }> => request('/status'),
  allowance: (): Promise<Allowance> => request('/allowance'),
  profile: (): Promise<{ name: string; availability: string }> => request('/profile'),
  saveProfile: (availability: string): Promise<{ name: string; availability: string }> =>
    request('/profile', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ availability }) }),
  outbox: (): Promise<{ items: OutboxItem[] }> => request('/outbox'),

  projects: (): Promise<{ items: Project[] }> => request('/projects'),
  createProject: (body: Record<string, string>): Promise<ProjectBundle> =>
    request('/projects', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }),
  project: (id: string): Promise<ProjectBundle> => request(`/projects/${id}`),
  setAspect: (id: string, opId: string, baseVersion: number, aspect: string): Promise<OpResponse> =>
    request(`/projects/${id}`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ op_id: opId, base_version: baseVersion, aspect_ratio: aspect }) }),
  ops: (id: string, after: number): Promise<{ ops: unknown[] }> => request(`/projects/${id}/ops?after=${after}`),
  sendOp: (id: string, body: Record<string, unknown>): Promise<OpResponse> =>
    request(`/projects/${id}/ops`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }),
  undo: (id: string, opId: string): Promise<OpResponse> =>
    request(`/projects/${id}/undo`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ op_id: opId }) }),
  redo: (id: string, opId: string): Promise<OpResponse> =>
    request(`/projects/${id}/redo`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ op_id: opId }) }),
  frame: (id: string, frame: number): Promise<Record<string, unknown>> => request(`/projects/${id}/frames/${frame}`),

  members: (id: string): Promise<{ items: { person: Person; role: string }[] }> => request(`/projects/${id}/members`),
  addMember: (id: string, email: string, role: string): Promise<{ person: Person; role: string }> =>
    request(`/projects/${id}/members`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email, role }) }),
  setMemberRole: (id: string, personId: string, role: string): Promise<unknown> =>
    request(`/projects/${id}/members/${personId}`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ role }) }),
  removeMember: (id: string, personId: string): Promise<void> =>
    request(`/projects/${id}/members/${personId}`, { method: 'DELETE' }),

  comments: (id: string, cutId?: string): Promise<{ items: Comment[] }> =>
    request(`/projects/${id}/comments${cutId !== undefined ? `?cut_id=${cutId}` : ''}`),
  addComment: (id: string, body: Record<string, unknown>): Promise<Comment> =>
    request(`/projects/${id}/comments`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }),
  draft: (id: string): Promise<{ draft: Record<string, unknown> | null }> => request(`/projects/${id}/comment-draft`),
  saveDraft: (id: string, body: Record<string, unknown>): Promise<unknown> =>
    request(`/projects/${id}/comment-draft`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(body) }),

  cuts: (id: string): Promise<{ items: Cut[] }> => request(`/projects/${id}/cuts`),
  nameCut: (id: string, name: string): Promise<Cut> =>
    request(`/projects/${id}/cuts`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }) }),
  compareCuts: (id: string, a: string, b: string): Promise<Record<string, unknown>> => request(`/projects/${id}/cuts/${a}/compare/${b}`),
  approveCut: (id: string, cutId: string): Promise<{ cut_id: string; approvals: { name: string; at: string }[] }> =>
    request(`/projects/${id}/cuts/${cutId}/approval`, { method: 'POST', headers: jsonHeaders(), body: '{}' }),
  restoreCut: (id: string, cutId: string, opId: string, baseVersion: number): Promise<OpResponse> =>
    request(`/projects/${id}/cuts/${cutId}/restore`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ op_id: opId, base_version: baseVersion }) }),
  createReviewLink: (id: string, cutId: string, expires: number): Promise<Record<string, unknown> & { url: string }> =>
    request(`/projects/${id}/review-links`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ cut_id: cutId, expires_in_seconds: expires }) }),
  reviewLinks: (id: string): Promise<{ items: Record<string, unknown>[] }> => request(`/projects/${id}/review-links`),
  updateReviewLink: (linkId: string, cutId: string): Promise<Record<string, unknown>> =>
    request(`/review-links/${linkId}`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ cut_id: cutId }) }),
  regenerateReviewLink: (linkId: string): Promise<Record<string, unknown> & { url: string }> =>
    request(`/review-links/${linkId}/regenerate`, { method: 'POST', headers: jsonHeaders(), body: '{}' }),
  revokeReviewLink: (linkId: string): Promise<void> => request(`/review-links/${linkId}`, { method: 'DELETE' }),

  exports: (id: string): Promise<{ items: ExportRecord[] }> => request(`/projects/${id}/exports`),
  startExport: (id: string, cutId: string, size: number): Promise<ExportRecord> =>
    request(`/projects/${id}/exports`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ cut_id: cutId, size }) }),
  cancelExport: (id: string): Promise<ExportRecord> => request(`/exports/${id}/cancel`, { method: 'POST', headers: jsonHeaders(), body: '{}' }),

  uploads: (): Promise<{ items: UploadRecord[] }> => request('/uploads'),
  createUpload: (body: Record<string, unknown>): Promise<CreateUploadResponse> =>
    request('/uploads', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }),
  sendChunk: (uploadId: string, n: number, bytes: ArrayBuffer): Promise<void> =>
    request(`/uploads/${uploadId}/chunks/${n}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes as unknown as BodyInit }),
  completeUpload: (uploadId: string): Promise<{ duplicate: boolean; media: Media }> =>
    request(`/uploads/${uploadId}/complete`, { method: 'POST', headers: jsonHeaders(), body: '{}' }),
  media: (q: string): Promise<{ items: Media[] }> => request(`/media?q=${encodeURIComponent(q)}`),
  peaks: (mediaId: string): Promise<{ peaks: number[] }> => request(`/media/${mediaId}/peaks`),
  deleteMedia: (id: string): Promise<void> => request(`/media/${id}`, { method: 'DELETE' }),

  importSrt: (projectId: string, rowId: string, text: string): Promise<{ cues: number; version: number }> =>
    request(`/projects/${projectId}/rows/${rowId}/captions/import`, { method: 'POST', headers: { 'Content-Type': 'application/x-subrip' }, body: text }),
  exportSrtUrl: (projectId: string, rowId: string): string => `/api/projects/${projectId}/rows/${rowId}/captions/export`,

  kits: (): Promise<{ items: Kit[] }> => request('/kits'),
  saveKit: (name: string, textColour: string, boxColour: string, fontWeight: number): Promise<Kit> =>
    request('/kits', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name, text_colour: textColour, box_colour: boxColour, font_weight: fontWeight }) }),
  tokens: (): Promise<{ items: TokenRecord[] }> => request('/tokens'),
  newToken: (name: string): Promise<{ id: string; name: string; token: string }> =>
    request('/tokens', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }) }),
  revokeToken: (id: string): Promise<void> => request(`/tokens/${id}`, { method: 'DELETE' }),

  review: (token: string): Promise<ReviewResponse> => request(`/review/${token}`),
  sendReviewComment: (token: string, name: string, body: string, frame: number): Promise<Comment> =>
    request(`/review/${token}/comments`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name, body, frame }) }),
  approveReview: (token: string, name: string): Promise<{ cut_id: string; approvals: { name: string; at: string }[] }> =>
    request(`/review/${token}/approve`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name }) }),
};

export interface UploadRecord {
  upload_id: string;
  file_name: string;
  folder: string;
  bytes: number;
  sha256: string;
  chunks: number;
  chunks_received: number[];
  state: string;
}

export interface CreateUploadResponse {
  upload_id: string;
  chunk_bytes: number;
  chunks: number;
  chunks_received: number[];
  duplicate?: boolean;
  media?: Media;
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}
