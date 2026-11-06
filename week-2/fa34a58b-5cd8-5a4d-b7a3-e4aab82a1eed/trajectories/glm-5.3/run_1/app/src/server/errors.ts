// One error shape for every API error, built in one place.
export interface ApiError { code: string; message: string; fields?: Record<string, string> }

export const Errors = {
  bad_json: { status: 400, message: 'The request body is not valid JSON.' },
  forbidden_origin: { status: 403, message: "Requests must come from this hub's own pages." },
  not_found: { status: 404, message: 'Nothing here by that name.' },
  schedule_changed: { status: 409, message: 'Someone else changed this schedule. Reload it to see their change.' },
  device_offline: { status: 409, message: '`<Device name>` is offline. Nothing was changed.' },
  guest_overlap: { status: 409, message: '`<Room>` already has a guest scene at that time.' },
  guest_scene_closed: { status: 409, message: 'This guest scene has already ended.' },
  idempotency_conflict: { status: 409, message: 'This request key was already used for a different guest scene.' },
  clip_closed: { status: 409, message: 'This clip is already closed.' },
  clip_not_playable: { status: 409, message: 'This clip is not stored yet.' },
  too_large: { status: 413, message: 'The request body is too large.' },
  unsupported_media_type: { status: 415, message: 'This content type is not accepted here.' },
  invalid: { status: 422, message: 'Check the highlighted fields.' },
  size_mismatch: { status: 422, message: 'The stored clip is `<stored size>` bytes, not the `<declared size>` bytes the camera declared.' },
  storage_unavailable: { status: 503, message: 'Clip storage is unreachable. Try again shortly.' },
} as const;

export type ErrorCode = keyof typeof Errors;

export function apiError(code: ErrorCode, fields?: Record<string, string>, subs?: Record<string, string>): { status: number; body: { error: ApiError } } {
  let message = Errors[code].message as string;
  if (subs) for (const [k, v] of Object.entries(subs)) message = message.replaceAll(`\`<${k}>\``, v);
  const body: { error: ApiError } = { error: { code, message } };
  if (code === 'invalid' && fields) body.error.fields = fields;
  return { status: Errors[code].status, body };
}

/** Message a field error under its key. */
export function fieldMessage(key: string, msg: string): [string, string] {
  return [key, msg];
}

export function invalid(fields: Record<string, string>): { status: number; body: { error: ApiError } } {
  return apiError('invalid', fields);
}
