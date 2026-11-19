export type Role = 'dispatcher' | 'field_technician' | 'crew_lead' | 'ops_manager';

export interface UserView {
  id: string;
  name: string;
  handle: string;
  role: Role;
  status: string;
  email?: string;
}

export interface WorkspaceView {
  id: string;
  name: string;
  time_zone: string;
}

export interface ChannelView {
  id: string;
  name: string;
  kind: 'broadcast' | 'crew';
  private: boolean;
  unread_count: number;
  member_count: number;
  pinned_message_ids: string[];
}

export interface AttachmentView {
  id: string;
  filename: string;
  content_type: string;
  bytes: number;
  width: number;
  height: number;
  url: string;
  thumb_url: string;
}

export interface QuoteView {
  message_id: string;
  author_name?: string;
  text?: string;
  edited?: boolean;
  deleted: boolean;
}

export interface MessageView {
  id: string;
  channel_id: string;
  client_message_id: string;
  author: { id: string; name: string; role: Role };
  text: string;
  version: number;
  edited: boolean;
  sent_at: string;
  edited_at: string | null;
  editable_until: string;
  thread_root_id: string | null;
  reply_count: number;
  quote: QuoteView | null;
  attachments: AttachmentView[];
  pinned: boolean;
  pinned_by: { id: string; name: string } | null;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
  deleted: false;
}

export interface DeletedRootView {
  id: string;
  channel_id: string;
  deleted: true;
  sent_at: string;
  reply_count: number;
}

export interface VersionView {
  version: number;
  text: string;
  edited_by: { id: string; name: string };
  created_at: string;
}

export interface ReceiptsView {
  message_id: string;
  sent_at: string;
  as_of: string;
  versions: VersionView[];
  recipients: {
    user: { id: string; name: string };
    delivered_at: string | null;
    reads: { version: number; read_at: string }[];
  }[];
  recipient_count: number;
  delivered_count: number;
  read_count: number;
}

export interface ScheduledView {
  id: string;
  channel_id: string;
  text: string;
  state: 'scheduled' | 'firing' | 'sent' | 'cancelled';
  repeat: 'none' | 'weekly';
  local_date: string;
  local_time: string;
  time_zone: string;
  next_fire_at: string | null;
  next_fire_local: string | null;
  upcoming_local: string[];
  fired_count: number;
  last_message_id: string | null;
}

export interface SearchResultView {
  kind: 'message' | 'photo';
  message_id: string;
  attachment_id: string | null;
  channel: { id: string; name: string };
  thread_root_id: string | null;
  author_name: string;
  snippet: string;
  sent_at: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  current?: { version: number; text: string; edited_by: { id: string; name: string }; edited_at: string };
}

export const ROLE_LABELS: Record<Role, string> = {
  dispatcher: 'Dispatch',
  field_technician: 'Field tech',
  crew_lead: 'Crew lead',
  ops_manager: 'Ops',
};

/** The one workspace-local date-time format used everywhere. */
export function formatLocal(zone: string, instant: string | Date): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('weekday')} ${get('day')} ${get('month')}, ${hour}:${get('minute')} ${parts.find((p) => p.type === 'timeZoneName')?.value ?? ''}`;
}

/** The message-text link rule, mirrored client-side for rendering. */
export type TextSegment = { kind: 'text' | 'link'; value: string; href?: string } | { kind: 'br' };

export function parseText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) out.push({ kind: 'br' });
    let start = 0;
    for (;;) {
      const at = findLink(line, start);
      if (!at) {
        if (start < line.length) out.push({ kind: 'text', value: line.slice(start) });
        break;
      }
      if (at.from > start) out.push({ kind: 'text', value: line.slice(start, at.from) });
      out.push({ kind: 'link', value: at.run, href: at.run });
      start = at.from + at.run.length;
    }
  });
  return out;
}

function findLink(line: string, from: number): { from: number; run: string } | null {
  for (let i = from; i < line.length; i += 1) {
    const before = i === 0 ? '' : line[i - 1];
    if (before && /[a-zA-Z0-9]/.test(before)) continue;
    const rest = line.slice(i);
    if (!/^https?:\/\//i.test(rest)) continue;
    let end = rest.search(/[\s<>"]/);
    if (end === -1) end = rest.length;
    let run = rest.slice(0, end);
    run = trimRun(run);
    if (run.length === 0) continue;
    if (/^https?:\/\/$/i.test(run)) continue;
    return { from: i, run };
  }
  return null;
}

function trimRun(run: string): string {
  let out = run;
  for (;;) {
    const last = out[out.length - 1];
    if (last === '.' || last === ',' || last === ';' || last === ':' || last === '!' || last === '?') {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      if (closes > opens) { out = out.slice(0, -1); continue; }
    }
    return out;
  }
}

export const MAX_PHOTO_BYTES = 10000000;
export const MAX_PHOTOS = 4;

const SIG_JPEG = [0xff, 0xd8, 0xff];
const SIG_PNG = [0x89, 0x50, 0x4e, 0x47];

/** Client-side photo gate: signature, size, count. Pixels are judged by the server. */
export async function checkChosenPhoto(file: File): Promise<'jpeg' | 'png' | 'webp' | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const starts = (sig: number[]): boolean => sig.every((b, i) => head[i] === b);
  if (starts(SIG_JPEG)) return 'jpeg';
  if (starts(SIG_PNG)) return 'png';
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45) return 'webp';
  return null;
}

export function newClientId(): string {
  return crypto.randomUUID();
}
