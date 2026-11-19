export interface Settings {
  grading: boolean;
  presenceTimeoutMs: number;
  versionIntervalMs: number;
  presenterGraceMs: number;
  sessionTtlMs: number;
  opWindow: number;
  virtualFrom: number;
  domMarginPx: number;
  domCeiling: number;
  attachMaxBytes: number;
  mapQuotaBytes: number;
  outlineMaxBytes: number;
  exportStepMs: number;
  opRate: number;
  loginRate: number;
  toastMs: number;
  undoDepth: number;
}

export const SETTING_DEFAULTS: Omit<Settings, 'grading'> = {
  presenceTimeoutMs: 15000,
  versionIntervalMs: 300000,
  presenterGraceMs: 60000,
  sessionTtlMs: 604800000,
  opWindow: 1000,
  virtualFrom: 300,
  domMarginPx: 200,
  domCeiling: 400,
  attachMaxBytes: 2000000,
  mapQuotaBytes: 20000000,
  outlineMaxBytes: 1000000,
  exportStepMs: 400,
  opRate: 600,
  loginRate: 10,
  toastMs: 5000,
  undoDepth: 100,
};

export const JSON_BODY_MAX_BYTES = 1000000;
export const DEFAULT_PORT = 4173;

function num(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readSettings(env: Record<string, string | undefined>): Settings {
  return {
    grading: env.SPRIG_GRADING === '1',
    presenceTimeoutMs: num(env, 'SPRIG_PRESENCE_TIMEOUT_MS', SETTING_DEFAULTS.presenceTimeoutMs),
    versionIntervalMs: num(env, 'SPRIG_VERSION_INTERVAL_MS', SETTING_DEFAULTS.versionIntervalMs),
    presenterGraceMs: num(env, 'SPRIG_PRESENTER_GRACE_MS', SETTING_DEFAULTS.presenterGraceMs),
    sessionTtlMs: num(env, 'SPRIG_SESSION_TTL_MS', SETTING_DEFAULTS.sessionTtlMs),
    opWindow: num(env, 'SPRIG_OP_WINDOW', SETTING_DEFAULTS.opWindow),
    virtualFrom: num(env, 'SPRIG_VIRTUAL_FROM', SETTING_DEFAULTS.virtualFrom),
    domMarginPx: num(env, 'SPRIG_DOM_MARGIN_PX', SETTING_DEFAULTS.domMarginPx),
    domCeiling: num(env, 'SPRIG_DOM_CEILING', SETTING_DEFAULTS.domCeiling),
    attachMaxBytes: num(env, 'SPRIG_ATTACH_MAX_BYTES', SETTING_DEFAULTS.attachMaxBytes),
    mapQuotaBytes: num(env, 'SPRIG_MAP_QUOTA_BYTES', SETTING_DEFAULTS.mapQuotaBytes),
    outlineMaxBytes: num(env, 'SPRIG_OUTLINE_MAX_BYTES', SETTING_DEFAULTS.outlineMaxBytes),
    exportStepMs: num(env, 'SPRIG_EXPORT_STEP_MS', SETTING_DEFAULTS.exportStepMs),
    opRate: num(env, 'SPRIG_OP_RATE', SETTING_DEFAULTS.opRate),
    loginRate: num(env, 'SPRIG_LOGIN_RATE', SETTING_DEFAULTS.loginRate),
    toastMs: num(env, 'SPRIG_TOAST_MS', SETTING_DEFAULTS.toastMs),
    undoDepth: num(env, 'SPRIG_UNDO_DEPTH', SETTING_DEFAULTS.undoDepth),
  };
}

export function readPort(env: Record<string, string | undefined>): number {
  return num(env, 'APP_PUBLIC_PORT', DEFAULT_PORT);
}
