/** Browser-stored state: the cast tray, drafts for forms that survive reloads. */

export interface TrayItem {
  slug: string;
  displayName: string;
  office: string;
}

const TRAY_KEY = "rungboard.tray.v1";

export function readTray(): TrayItem[] {
  try {
    return JSON.parse(localStorage.getItem(TRAY_KEY) || "[]") as TrayItem[];
  } catch {
    return [];
  }
}

export function writeTray(items: TrayItem[]): void {
  localStorage.setItem(TRAY_KEY, JSON.stringify(items));
}

const CAST_DRAFT = "rungboard.cast-draft.v1";

export interface CastDraft {
  key: string;
  step: number;
  values: Record<string, string>;
}

export function readCastDraft(): CastDraft | null {
  try {
    return JSON.parse(localStorage.getItem(CAST_DRAFT) || "null") as CastDraft | null;
  } catch {
    return null;
  }
}

export function writeCastDraft(draft: CastDraft): void {
  localStorage.setItem(CAST_DRAFT, JSON.stringify(draft));
}

export function clearCastDraft(): void {
  localStorage.removeItem(CAST_DRAFT);
}

const APPLY_DRAFT = "rungboard.apply-draft.v1";

export interface ApplyDraft {
  id: string;
  token: string;
  step: number;
  values: Record<string, string>;
}

export function readApplyDraft(): ApplyDraft | null {
  try {
    return JSON.parse(localStorage.getItem(APPLY_DRAFT) || "null") as ApplyDraft | null;
  } catch {
    return null;
  }
}

export function writeApplyDraft(draft: ApplyDraft): void {
  localStorage.setItem(APPLY_DRAFT, JSON.stringify(draft));
}

export function clearApplyDraft(): void {
  localStorage.removeItem(APPLY_DRAFT);
}

/** Keeps a dialog or form's typed values for after signing in again. */
const KEPT_FORMS = "rungboard.kept.v1";

export interface KeptForm {
  path: string;
  dialog: string | null;
  values: Record<string, string>;
}

export function keepForm(kept: KeptForm): void {
  const all = readKept();
  all[kept.path] = kept;
  localStorage.setItem(KEPT_FORMS, JSON.stringify(all));
}

export function readKeptFor(path: string): KeptForm | null {
  const all = readKept();
  return all[path] || null;
}

export function clearKeptFor(path: string): void {
  const all = readKept();
  delete all[path];
  localStorage.setItem(KEPT_FORMS, JSON.stringify(all));
}

function readKept(): Record<string, KeptForm> {
  try {
    return JSON.parse(localStorage.getItem(KEPT_FORMS) || "{}") as Record<string, KeptForm>;
  } catch {
    return {};
  }
}

const RETURN_KEY = "rungboard.return.v1";

export function rememberReturn(path: string): void {
  localStorage.setItem(RETURN_KEY, path);
}

export function takeReturn(): string | null {
  const path = localStorage.getItem(RETURN_KEY);
  localStorage.removeItem(RETURN_KEY);
  return path;
}
