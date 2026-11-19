/**
 * Shared settings: the one definition of each tunable, with its
 * environment variable name and default. The server fills it from
 * the environment at boot; nothing is hard-coded elsewhere.
 */

export interface Settings {
  grading: boolean;
  presence_timeout_ms: number;
  version_interval_ms: number;
  presenter_grace_ms: number;
  session_ttl_ms: number;
  op_window: number;
  virtual_from: number;
  dom_margin_px: number;
  dom_ceiling: number;
  attach_max_bytes: number;
  map_quota_bytes: number;
  outline_max_bytes: number;
  export_step_ms: number;
  op_rate: number;
  login_rate: number;
  toast_ms: number;
  undo_depth: number;
}

const defs: Record<keyof Settings, { env: string; def: number | boolean }> = {
  grading: { env: 'SPRIG_GRADING', def: false },
  presence_timeout_ms: { env: 'SPRIG_PRESENCE_TIMEOUT_MS', def: 15000 },
  version_interval_ms: { env: 'SPRIG_VERSION_INTERVAL_MS', def: 300000 },
  presenter_grace_ms: { env: 'SPRIG_PRESENTER_GRACE_MS', def: 60000 },
  session_ttl_ms: { env: 'SPRIG_SESSION_TTL_MS', def: 604800000 },
  op_window: { env: 'SPRIG_OP_WINDOW', def: 1000 },
  virtual_from: { env: 'SPRIG_VIRTUAL_FROM', def: 300 },
  dom_margin_px: { env: 'SPRIG_DOM_MARGIN_PX', def: 200 },
  dom_ceiling: { env: 'SPRIG_DOM_CEILING', def: 400 },
  attach_max_bytes: { env: 'SPRIG_ATTACH_MAX_BYTES', def: 2000000 },
  map_quota_bytes: { env: 'SPRIG_MAP_QUOTA_BYTES', def: 20000000 },
  outline_max_bytes: { env: 'SPRIG_OUTLINE_MAX_BYTES', def: 1000000 },
  export_step_ms: { env: 'SPRIG_EXPORT_STEP_MS', def: 400 },
  op_rate: { env: 'SPRIG_OP_RATE', def: 600 },
  login_rate: { env: 'SPRIG_LOGIN_RATE', def: 10 },
  toast_ms: { env: 'SPRIG_TOAST_MS', def: 5000 },
  undo_depth: { env: 'SPRIG_UNDO_DEPTH', def: 100 },
};

export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(defs) as (keyof Settings)[]) {
    const spec = defs[key];
    const raw = env[spec.env];
    if (raw === undefined || raw === '') {
      out[key] = spec.def;
    } else if (typeof spec.def === 'boolean') {
      out[key] = raw === '1';
    } else {
      const n = Number(raw);
      out[key] = Number.isFinite(n) ? n : spec.def;
    }
  }
  return out as unknown as Settings;
}

/** The subset the published map payload exposes to the browser. */
export function publicSettings(s: Settings): { toast_ms: number; presence_timeout_ms: number; virtual_from: number; dom_margin_px: number; dom_ceiling: number } {
  return {
    toast_ms: s.toast_ms,
    presence_timeout_ms: s.presence_timeout_ms,
    virtual_from: s.virtual_from,
    dom_margin_px: s.dom_margin_px,
    dom_ceiling: s.dom_ceiling,
  };
}
