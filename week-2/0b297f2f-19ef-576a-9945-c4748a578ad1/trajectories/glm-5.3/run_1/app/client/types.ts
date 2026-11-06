export type Unit = 'cm' | 'in';
export type Role = 'curator' | 'registrar' | 'preparator';
export type ViewName = 'plan' | 'wall' | 'light';
export type PlacementStatus = 'proposed' | 'claimed' | 'hung' | 'signed_off' | 'removed';

export interface Staff { id: string; name: string; role: Role }
export interface Lender { id: string; name: string; email: string }
export interface Wall { id: string; name: string; lengthMm: number; heightMm: number; plannedLux: number }
export interface Exhibition {
  id: string; title: string; museum: string; timeZone: string;
  runStart: string; runEnd: string; openHoursPerDay: number; closedWeekdays: number[]; openHours: number;
}
export interface Gallery { id: string; name: string; walls: Wall[] }

export interface Photo {
  id: string; objectId: string; key: string; bytes: number;
  sha256: string; contentType: string; attachedAt: string;
}

export interface ObjectRecord {
  id: string; objectNumber: string; title: string; medium: string;
  lenderId: string | null; lenderName: string | null;
  widthMm: number; heightMm: number;
  luxLimit: number; luxHourBudget: number;
  insuranceValueGbp: number; registrarNote: string;
  conditionRecorded: boolean;
  photos: Photo[];
  placementId: string | null; placementStatus: PlacementStatus | null;
}

export interface Placement {
  id: string; objectId: string; objectTitle: string; objectNumber: string;
  lenderId: string | null; wallId: string; wallName: string;
  offsetMm: number; centreHeightMm: number; heightOverride: boolean;
  widthMm: number; heightMm: number;
  plannedLux: number; plannedLuxHours: number;
  luxLimit: number; luxHourBudget: number;
  luxStatus: 'within' | 'over';
  status: PlacementStatus;
  claimedBy: { id: string; name: string } | null;
  version: number;
}

export interface UndoInfo { actionId: string; kind: 'remove' | 'move'; undoUntil: string; remainingMs: number }

export interface EventEntry {
  seq: number; kind: string; at: string;
  actor: { id: string; name: string } | null;
  placementId: string | null; objectId: string | null; wallId: string | null;
  title: string | null; wallName: string | null; offsetMm: number | null;
  plannedLux: number | null; previewId: string | null;
  publishAtDisplay: string | null; recipientCount: number | null;
}

export interface PreviewRecipient {
  lenderId: string; lenderName: string; email: string;
  delivery: 'queued' | 'sent' | 'cancelled'; sentAt: string | null;
}

export interface Preview {
  id: string | null;
  status: 'draft' | 'scheduled' | 'published' | 'withdrawn';
  date: string | null;
  publishAt: string | null; publishAtDisplay: string | null; remainingMs: number | null;
  publishedAt: string | null; publishedAtDisplay: string | null;
  withdrawnAt: string | null; withdrawnAtDisplay: string | null;
  recipients: PreviewRecipient[];
}

export interface ServiceStatus {
  services: { database: 'up' | 'down'; imageStore: 'up' | 'down'; mailRelay: 'up' | 'down' };
  checkedAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string; message: string;
    fields?: Record<string, string>;
    reason?: string;
    claimedBy?: { id: string; name: string } | null;
    placement?: Placement | null;
  };
}

// ---------- formatting ----------

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** The one place a stored length is displayed, in the current unit. */
export function formatLength(mm: number, unit: Unit): string {
  if (unit === 'cm') return `${(mm / 10).toFixed(1)} cm`;
  return `${(roundHalfUp(mm / 2.54) / 10).toFixed(1)} in`;
}

export function formatLux(value: number): string {
  return String(value);
}

export function formatLuxHours(value: number): string {
  return value.toLocaleString('en-GB');
}

/** Parses a length the person typed, in the current unit (whole mm). */
export function parseLength(text: string, unit: Unit): number | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const match = /^(\d+(?:\.\d+)?)\s*(cm|in|mm)?$/.exec(trimmed);
  if (match === null) return null;
  const value = Number(match[1]);
  const suffix = match[2];
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (suffix) {
    case 'mm': return roundHalfUp(value);
    case 'cm': return roundHalfUp(value * 10);
    case 'in': return roundHalfUp(value * 25.4);
    default: return unit === 'cm' ? roundHalfUp(value * 10) : roundHalfUp(value * 25.4);
  }
}

export function placementStatusText(p: Placement): string {
  switch (p.status) {
    case 'proposed': return 'Proposed';
    case 'claimed': return `Claimed by ${p.claimedBy?.name ?? ''}`;
    case 'hung': return 'Hung';
    case 'signed_off': return 'Signed off';
    default: return 'Not placed';
  }
}

export function objectStatusText(o: ObjectRecord): string {
  if (o.placementStatus === null) return 'Not placed';
  switch (o.placementStatus) {
    case 'proposed': return 'Proposed';
    case 'claimed': return 'Claimed';
    case 'hung': return 'Hung';
    case 'signed_off': return 'Signed off';
    default: return 'Not placed';
  }
}

export function photoCountText(n: number): string {
  if (n === 0) return 'No condition photo';
  if (n === 1) return '1 condition photo';
  return `${n} condition photos`;
}

/** H:MM:SS countdown from remaining milliseconds. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
