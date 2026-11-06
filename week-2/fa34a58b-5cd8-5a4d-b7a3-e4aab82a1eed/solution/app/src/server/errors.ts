// The one error shape: every API error is an ApiError built from this table and written by errorBody().

import type { ApiErrorBody } from "../shared/types.ts";

const CATALOGUE = {
  bad_json: { status: 400, message: () => "The request body is not valid JSON." },
  forbidden_origin: { status: 403, message: () => "Requests must come from this hub's own pages." },
  not_found: { status: 404, message: () => "Nothing here by that name." },
  schedule_changed: { status: 409, message: () => "Someone else changed this schedule. Reload it to see their change." },
  device_offline: { status: 409, message: (device: string) => `${device} is offline. Nothing was changed.` },
  guest_overlap: { status: 409, message: (room: string) => `${room} already has a guest scene at that time.` },
  guest_scene_closed: { status: 409, message: () => "This guest scene has already ended." },
  idempotency_conflict: { status: 409, message: () => "This request key was already used for a different guest scene." },
  clip_closed: { status: 409, message: () => "This clip is already closed." },
  clip_not_playable: { status: 409, message: () => "This clip is not stored yet." },
  too_large: { status: 413, message: () => "The request body is too large." },
  unsupported_media_type: { status: 415, message: () => "This content type is not accepted here." },
  invalid: { status: 422, message: () => "Check the highlighted fields." },
  size_mismatch: {
    status: 422,
    message: (stored: string, declared: string) =>
      `The stored clip is ${stored} bytes, not the ${declared} bytes the camera declared.`,
  },
  storage_unavailable: { status: 503, message: () => "Clip storage is unreachable. Try again shortly." },
} as const;

type ErrorCode = keyof typeof CATALOGUE;
type MessageArgs<C extends ErrorCode> = Parameters<(typeof CATALOGUE)[C]["message"]>;

/** Field messages for `invalid` errors, keyed by what they check. */
export const FIELD = {
  sceneName: "Give the scene a name of 1 to 40 characters.",
  sceneNameTaken: "Another scene already uses this name.",
  tint: "Choose one of the six tints.",
  sceneBrightness: "Brightness is a whole number from 0 to 100.",
  deviceBrightness: "Brightness is a whole number from 1 to 100.",
  setpoint: "Setpoint is a whole number from 60 to 80.",
  onOff: "Use true or false.",
  noSuchSetting: "This device has no such setting.",
  revision: "Reload the schedule before saving.",
  fromFormat: "Use a date like 2026-11-09.",
  fromPast: "Choose today or a later day.",
  fromFar: "Choose a day within the next 366 days.",
  slots: "A schedule has 1 to 48 slots.",
  slotTime: "Use a 24-hour time like 06:10.",
  slotShared: "Two slots at the same time cannot share a room.",
  chooseScene: "Choose a scene.",
  slotRooms: "Choose at least one room.",
  chooseRoom: "Choose a room.",
  wallFormat: "Use a date and time like 2026-11-07T11:00.",
  startPast: "Start now or later.",
  endOrder: "End after the start.",
  endLong: "A guest scene can last at most 14 days.",
  skipped: "That time is skipped when clocks spring forward. Choose another time.",
  idempotencyKey: "Use 1 to 100 visible characters.",
  day: "Use a date like 2026-11-01.",
  instant: "Use a time like 2026-11-01T01:29:55-05:00.",
  declaredSize: "Declared size is a whole number of bytes from 1 to 20,000,000.",
  report: "Send online or state.",
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;

  private constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.status = CATALOGUE[code].status;
    this.fields = fields;
  }

  static of<C extends ErrorCode>(code: C, ...args: MessageArgs<C>): ApiError {
    const build = CATALOGUE[code].message as (...values: MessageArgs<C>) => string;
    return new ApiError(code, build(...args));
  }

  static invalid(fields: Record<string, string>): ApiError {
    return new ApiError("invalid", CATALOGUE.invalid.message(), fields);
  }
}

export function errorBody(error: ApiError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  };
}

/** Collects field messages; throws one `invalid` error when any were found. */
export class FieldErrors {
  private readonly found: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.found)) this.found[field] = message;
  }

  has(field: string): boolean {
    return field in this.found;
  }

  throwIfAny(): void {
    if (Object.keys(this.found).length > 0) throw ApiError.invalid(this.found);
  }
}
