/** The one API error shape, built in one place. */

export type ErrorCode =
  | 'bad_json'
  | 'forbidden_origin'
  | 'not_found'
  | 'schedule_changed'
  | 'device_offline'
  | 'guest_overlap'
  | 'guest_scene_closed'
  | 'idempotency_conflict'
  | 'clip_closed'
  | 'clip_not_playable'
  | 'too_large'
  | 'unsupported_media_type'
  | 'invalid'
  | 'size_mismatch'
  | 'storage_unavailable';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  toBody(): { error: { code: string; message: string }; fields?: Record<string, string> } {
    if (this.fields) {
      return { error: { code: this.code, message: this.message }, fields: this.fields };
    }
    return { error: { code: this.code, message: this.message } };
  }
}

export const apiError = {
  badJson: (): ApiError => new ApiError(400, 'bad_json', 'The request body is not valid JSON.'),
  forbiddenOrigin: (): ApiError =>
    new ApiError(403, 'forbidden_origin', "Requests must come from this hub's own pages."),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Nothing here by that name.'),
  scheduleChanged: (): ApiError =>
    new ApiError(
      409,
      'schedule_changed',
      'Someone else changed this schedule. Reload it to see their change.',
    ),
  deviceOffline: (deviceName: string): ApiError =>
    new ApiError(409, 'device_offline', `${deviceName} is offline. Nothing was changed.`),
  guestOverlap: (roomName: string): ApiError =>
    new ApiError(409, 'guest_overlap', `${roomName} already has a guest scene at that time.`),
  guestSceneClosed: (): ApiError =>
    new ApiError(409, 'guest_scene_closed', 'This guest scene has already ended.'),
  idempotencyConflict: (): ApiError =>
    new ApiError(
      409,
      'idempotency_conflict',
      'This request key was already used for a different guest scene.',
    ),
  clipClosed: (): ApiError => new ApiError(409, 'clip_closed', 'This clip is already closed.'),
  clipNotPlayable: (): ApiError =>
    new ApiError(409, 'clip_not_playable', 'This clip is not stored yet.'),
  tooLarge: (): ApiError => new ApiError(413, 'too_large', 'The request body is too large.'),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'This content type is not accepted here.'),
  invalid: (fields: Record<string, string>): ApiError =>
    new ApiError(422, 'invalid', 'Check the highlighted fields.', fields),
  sizeMismatch: (storedSize: number, declaredSize: number): ApiError =>
    new ApiError(
      422,
      'size_mismatch',
      `The stored clip is ${storedSize} bytes, not the ${declaredSize} bytes the camera declared.`,
    ),
  storageUnavailable: (): ApiError =>
    new ApiError(503, 'storage_unavailable', 'Clip storage is unreachable. Try again shortly.'),
};

/** The published field messages, keyed by the rule they enforce. */
export const fieldMessage = {
  sceneName: 'Give the scene a name of 1 to 40 characters.',
  sceneNameTaken: 'Another scene already uses this name.',
  tint: 'Choose one of the six tints.',
  sceneBrightness: 'Brightness is a whole number from 0 to 100.',
  deviceBrightness: 'Brightness is a whole number from 1 to 100.',
  setpoint: 'Setpoint is a whole number from 60 to 80.',
  on: 'Use true or false.',
  noSuchSetting: 'This device has no such setting.',
  revision: 'Reload the schedule before saving.',
  fromShape: 'Use a date like 2026-11-09.',
  fromTooEarly: 'Choose today or a later day.',
  fromTooLate: 'Choose a day within the next 366 days.',
  slotsCount: 'A schedule has 1 to 48 slots.',
  slotTime: 'Use a 24-hour time like 06:10.',
  slotRoomClash: 'Two slots at the same time cannot share a room.',
  slotScene: 'Choose a scene.',
  slotRooms: 'Choose at least one room.',
  roomId: 'Choose a room.',
  sceneId: 'Choose a scene.',
  instantShape: 'Use a date and time like 2026-11-07T11:00.',
  startNotPast: 'Start now or later.',
  endAfterStart: 'End after the start.',
  endTooFar: 'A guest scene can last at most 14 days.',
  skippedTime: 'That time is skipped when clocks spring forward. Choose another time.',
  idempotencyKey: 'Use 1 to 100 visible characters.',
  day: 'Use a date like 2026-11-01.',
  instantWithOffset: 'Use a time like 2026-11-01T01:29:55-05:00.',
  declaredSize: 'Declared size is a whole number of bytes from 1 to 20,000,000.',
  deviceReportBody: 'Send online or state.',
} as const;
