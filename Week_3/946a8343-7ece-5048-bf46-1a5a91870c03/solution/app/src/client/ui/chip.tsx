// Chips and status words.
//   <Chip tone?>text</Chip>               square 1 px bordered chip
//   <ScopedLabel name="workflow::doing" />  key | value two halves for scoped labels (plain chip when there is no `::`); the
//                                          text content still reads `workflow::doing`
//   <StatusBadge status="failed" label? /> status word with a glyph and colour (never colour alone)
//   statusTone(status)                      'ok' | 'live' | 'wait' | 'fail' | 'idle'
import type { ComponentChildren } from "preact";
import { scopedKey } from "../../shared/labels.ts";
import { Icon, type IconName } from "./icons.tsx";

export function Chip({ tone = "idle", class: className, children }: { tone?: StatusTone; class?: string; children: ComponentChildren }) {
  return <span class={`sp-chip sp-chip--${tone}${className ? ` ${className}` : ""}`}>{children}</span>;
}

export function ScopedLabel({ name, tone = "idle" }: { name: string; tone?: StatusTone }) {
  const key = scopedKey(name);
  if (key === null) return <Chip tone={tone}>{name}</Chip>;
  return (
    <span class={`sp-chip sp-chip--scoped sp-chip--${tone}`}>
      <span class="sp-chip__key">{key}</span>
      <span class="sp-visually-hidden">::</span>
      <span class="sp-chip__value">{name.slice(key.length + 2)}</span>
    </span>
  );
}

type StatusTone = "ok" | "live" | "wait" | "fail" | "idle";

const TONES: Record<string, StatusTone> = {
  success: "ok",
  succeeded: "ok",
  passed: "ok",
  merged: "ok",
  approved: "ok",
  resolved: "ok",
  deployed: "ok",
  up: "ok",
  running: "live",
  testing: "live",
  merging: "live",
  active: "live",
  pending: "wait",
  waiting: "wait",
  created: "wait",
  manual: "wait",
  scheduled: "wait",
  queued: "wait",
  preparing: "wait",
  draft: "wait",
  detected: "wait",
  failed: "fail",
  error: "fail",
  rejected: "fail",
  conflict: "fail",
  blocked: "fail",
  unresolved: "fail",
  down: "fail",
};

export function statusTone(status: string): StatusTone {
  return TONES[status] ?? "idle";
}

const GLYPH: Record<StatusTone, IconName> = { ok: "circle-check", live: "play", wait: "clock", fail: "circle-x", idle: "info" };

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  return (
    <span class={`sp-status sp-status--${tone}`} data-status={status}>
      <Icon name={GLYPH[tone]} size={16} />
      <span>{label ?? status}</span>
    </span>
  );
}
