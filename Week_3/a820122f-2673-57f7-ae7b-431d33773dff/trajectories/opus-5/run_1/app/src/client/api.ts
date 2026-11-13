export type ApiResult<T> = {
  status: number;
  ok: boolean;
  body: T;
  networkFailure: boolean;
};

export type ApiErrorBody = {
  error?: string;
  message?: string;
  errors?: Record<string, string>;
  blocking_dates?: string[];
  ship_date?: string;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = (text === '' ? {} : JSON.parse(text)) as T;
    return { status: response.status, ok: response.ok, body: parsed, networkFailure: false };
  } catch {
    return { status: 0, ok: false, body: {} as T, networkFailure: true };
  }
}

export function getJson<T>(path: string): Promise<ApiResult<T>> {
  return request<T>('GET', path);
}

export function postJson<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>('POST', path, body ?? {});
}

export function deleteJson<T>(path: string): Promise<ApiResult<T>> {
  return request<T>('DELETE', path);
}

export function serverText(body: ApiErrorBody): string {
  if (body.errors !== undefined) {
    const first = Object.values(body.errors)[0];
    if (first !== undefined) return first;
  }
  return body.message ?? 'Something went wrong. Try again.';
}

export type Me = {
  id: string;
  name: string;
  role: 'owner_master' | 'crew';
  vessel_id: string | null;
  server_now_utc: string;
  today_ship_date: string | null;
};

export type CellState = 'not_logged' | 'rest' | 'work' | 'short_break';

export type DayCell = {
  start_utc: string;
  ship_time: string;
  repeated: boolean;
  state: CellState;
  late: boolean;
};

export type DayEntry = {
  id: string;
  entry_key: string;
  start_utc: string;
  end_utc: string;
  kind: 'rest' | 'work';
  ship_date: string;
  late: boolean;
  applied: boolean;
  received_at_utc: string;
};

export type DayNote = {
  id: string;
  ship_date: string;
  text: string;
  event_id: string | null;
  author_role: 'owner_master' | 'crew';
  created_at_utc: string;
};

export type DayEvent = {
  id: string;
  kind: 'drill' | 'call_out';
  start_utc: string;
  end_utc: string;
  description: string;
  mismatch: boolean;
};

export type DayDetail = {
  ship_date: string;
  state: 'open' | 'closed' | 'signed' | 'countersigned';
  closes_at_utc: string;
  can_edit: boolean;
  server_now_utc: string;
  start_utc: string;
  end_utc: string;
  cell_count: number;
  cells: DayCell[];
  rest_hours: number;
  entries: DayEntry[];
  notes: DayNote[];
  events: DayEvent[];
  signed_at_utc: string | null;
  countersigned_at_utc: string | null;
};

export type Rolling = {
  as_of_utc: string;
  rest_hours_24: number;
  rest_hours_168: number;
  verdict_24: string;
  verdict_168: string;
};

export type MonthState = {
  month: string;
  state: 'open' | 'awaiting_archive' | 'sealed';
  label: string;
  blocking_dates: string[];
  record_key: string | null;
  record_sha256: string | null;
  copy_key: string | null;
  sealed_at_utc: string | null;
};

export type RestRule =
  | 'rest_24h'
  | 'rest_periods'
  | 'six_hour_block'
  | 'fourteen_hour_gap'
  | 'rest_168h'
  | 'three_period_days';

export type RestWindow = {
  step: number;
  start_utc: string;
  end_utc: string;
  hours: 24 | 168;
  start_ship_time: string;
  end_ship_time: string;
  rest_hours: number;
  verdict: 'pass' | 'breach' | 'incomplete';
  rules_failed: RestRule[];
  rule_set: 'standard' | 'flag_exception';
  longitude: number | null;
  latitude: number | null;
  fold_state: 'flat' | 'gap' | 'crease' | 'gap_and_crease';
  clock_face_hours: number;
  clock_change_labels: string[];
};

export type StripCell = {
  start_utc: string;
  ship_date: string;
  ship_time: string;
  state: CellState;
  late: boolean;
};

export type StripClockChange = {
  id: string;
  changes_at_utc: string;
  old_offset_minutes: number;
  new_offset_minutes: number;
  kind: 'retard' | 'advance';
  label: string;
  ship_date: string;
};

export type StripFix = {
  id: string;
  at_utc: string;
  latitude: number;
  longitude: number;
};

export type Strip = {
  start_utc: string;
  end_utc: string;
  cells: StripCell[];
  clock_changes: StripClockChange[];
  fixes: StripFix[];
  windows: { '24': RestWindow[]; '168': RestWindow[] };
};

export type Breach = {
  id: string;
  rule: RestRule;
  window_hours: 24 | 168;
  window_start_utc: string;
  window_end_utc: string;
  rule_set: 'standard' | 'flag_exception';
  rest_hours: number;
  recorded_at_utc: string;
  still_breaching: boolean;
};

export type Vessel = {
  id: string;
  name: string;
  kind: string;
  current_offset_minutes: number;
};

export type CrewMember = { id: string; name: string; rank: string; email: string };

export type ClockChangeRecord = {
  id: string;
  changes_at_utc: string;
  old_offset_minutes: number;
  new_offset_minutes: number;
  kind: 'retard' | 'advance';
  label: string;
  ship_date: string;
  ship_date_cells: number;
  fix_id: string | null;
  nautical_zone: number;
  zone_warning: boolean;
};

export type RuleSetRecord = {
  id: string;
  rule_set: string;
  effective_from_utc: string;
  effective_until_utc: string;
  flag_reference: string;
};

export type InspectionLink = {
  id: string;
  vessel_id: string;
  url: string;
  from_date: string;
  to_date: string;
  expires_at_utc: string;
  state: 'active' | 'expired' | 'revoked';
};

export type PlannedWatch = {
  label: string;
  start_ship_time: string;
  end_ship_time: string;
  start_utc: string;
  end_utc: string;
  elapsed_hours: number;
};

export type RotaPlan = {
  days: {
    ship_date: string;
    cell_count: number;
    day_hours: number;
    watches: PlannedWatch[];
    planned_rest_hours: number;
  }[];
  plan: {
    verdict: 'pass' | 'breach';
    breaches: {
      rule: RestRule;
      window_hours: number;
      window_start_utc: string;
      window_end_utc: string;
    }[];
  };
};

export type InspectionRecord = {
  vessel: { id: string; name: string };
  from_date: string;
  to_date: string;
  expires_at_utc: string;
  server_now_utc: string;
  crew: {
    id: string;
    name: string;
    rank: string;
    days: {
      ship_date: string;
      cell_count: number;
      cells: DayCell[];
      rest_hours: number;
      signed_at_utc: string | null;
      countersigned_at_utc: string | null;
      late_entries: { entry_key: string; start_utc: string; end_utc: string; kind: string }[];
      notes: DayNote[];
    }[];
    breaches: Breach[];
  }[];
  unsealed_dates: string[];
  clock_changes: StripClockChange[];
  fixes: StripFix[];
  events: (DayEvent & { crew_id: string })[];
};
