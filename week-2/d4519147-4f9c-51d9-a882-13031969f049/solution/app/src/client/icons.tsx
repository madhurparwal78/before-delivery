import type { ReactNode } from "react";
import type { SystemKind, ZoneKind } from "../shared/model.ts";

/** Original line icons on a 24-unit grid, one stroke weight. Decorative: every control carries its own name. */
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const KIND_PATHS: Record<SystemKind, ReactNode> = {
  server: <><rect x="4" y="4" width="16" height="6" rx="1" /><rect x="4" y="14" width="16" height="6" rx="1" /><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5" /></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></>,
  firewall: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19" /></>,
  router: <><circle cx="12" cy="12" r="8" /><path d="M12 6.5v4M12 13.5v4M6.5 12h4M13.5 12h4M10.5 8l1.5-1.5L13.5 8M10.5 16l1.5 1.5 1.5-1.5" /></>,
  load_balancer: <><circle cx="5" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="19" cy="19" r="2" /><path d="M7 12h10M7 11l10-5.5M7 13l10 5.5" /></>,
  web_app: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 8.5h18M6 6.2h.01M8.5 6.2h.01M7 13h6M7 16h10" /></>,
  api_service: <><path d="M8 4c-2 0-3 1-3 3v2.5c0 1.2-.8 2-2 2.5 1.2.5 2 1.3 2 2.5V17c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2.5c0 1.2.8 2 2 2.5-1.2.5-2 1.3-2 2.5V17c0 2-1 3-3 3" /><path d="M10 12h.01M12 12h.01M14 12h.01" /></>,
  payment_terminal: <><rect x="6" y="2.5" width="12" height="19" rx="1.5" /><rect x="8.5" y="5" width="7" height="4.5" rx=".5" /><path d="M9 13h.01M12 13h.01M15 13h.01M9 16h.01M12 16h.01M15 16h.01M9 19h6" /></>,
  workstation: <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M9 20h6M12 16v4" /></>,
  cloud_service: <><path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.5a4.25 4.25 0 0 0 0 8.5Z" /></>,
  third_party: <><path d="M4 20V7l6-3v16M10 20V9l10 3v8M3 20h18M7 9h.01M7 12h.01M7 15h.01M14 14h.01M17 14h.01M14 17h.01M17 17h.01" /></>,
  backup_storage: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>,
};

const ZONE_PATHS: Record<ZoneKind, ReactNode> = {
  cde: <><rect x="3" y="3" width="18" height="18" strokeDasharray="4 2" /><path d="M12 7.5 8.5 9v3c0 2.4 1.5 4 3.5 4.5 2-.5 3.5-2.1 3.5-4.5V9Z" /></>,
  connected: <><rect x="3" y="3" width="18" height="18" strokeDasharray="2.5 2" /><path d="M10 14l4-4M9 11.5l-1.2 1.2a2 2 0 0 0 2.8 2.8l1.2-1.2M15 12.5l1.2-1.2a2 2 0 0 0-2.8-2.8L12.2 9.7" /></>,
  out_of_scope: <><rect x="3" y="3" width="18" height="18" strokeDasharray="1 2" /><circle cx="12" cy="12" r="4.5" /><path d="m8.8 15.2 6.4-6.4" /></>,
};

export const KindIcon = ({ kind, size }: { kind: SystemKind; size?: number }) => <Icon size={size}>{KIND_PATHS[kind]}</Icon>;
export const ZoneKindIcon = ({ kind, size }: { kind: ZoneKind; size?: number }) => <Icon size={size}>{ZONE_PATHS[kind]}</Icon>;

export const icons = {
  back: <Icon><path d="M15 5l-7 7 7 7M8 12h12" /></Icon>,
  files: <Icon><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z" /><path d="M14 3v4h4M9 12h6M9 15h6M9 18h4" /></Icon>,
  share: <Icon><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M18 8v6M15 11h6" /></Icon>,
  undo: <Icon><path d="M9 7 4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 0 10h-2" /></Icon>,
  redo: <Icon><path d="m15 7 5 5-5 5" /><path d="M20 12H9a5 5 0 0 0 0 10h2" /></Icon>,
  save: <Icon><path d="M5 3h11l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></Icon>,
  zoomIn: <Icon><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.9-4.9M8 10.5h5M10.5 8v5" /></Icon>,
  zoomOut: <Icon><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.9-4.9M8 10.5h5" /></Icon>,
  importFile: <Icon><path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3" /></Icon>,
  inspector: <Icon><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M15 4v16M17.5 8h1M17.5 11h1M17.5 14h1" /></Icon>,
  shapes: <Icon><rect x="3" y="3" width="8" height="8" rx="1" /><circle cx="17" cy="7" r="4" /><path d="M7 14l4 7H3Z" /><rect x="13" y="13" width="8" height="8" rx="1" strokeDasharray="2 1.5" /></Icon>,
  close: <Icon><path d="M6 6l12 12M18 6 6 18" /></Icon>,
  search: <Icon size={18}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></Icon>,
};

/** Small drafted drawings for empty states. */
export function EmptyPlan({ width = 160 }: { width?: number }) {
  return (
    <svg className="empty-art" width={width} height={width * 0.6} viewBox="0 0 160 96" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <rect x="6" y="10" width="68" height="76" strokeDasharray="6 4" />
      <rect x="90" y="10" width="64" height="76" strokeDasharray="2 4" />
      <rect x="18" y="26" width="40" height="18" />
      <rect x="18" y="56" width="40" height="18" />
      <rect x="102" y="38" width="40" height="18" />
      <path d="M58 35h22v12h22" />
      <path d="M78 41l4 6-4 6-4-6Z" />
    </svg>
  );
}

export function EmptyTray({ size = 48 }: { size?: number }) {
  return (
    <svg className="empty-art" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <path d="M6 28 12 10h24l6 18v10H6Z" strokeLinejoin="round" />
      <path d="M6 28h11l2 4h10l2-4h11" strokeLinejoin="round" />
      <path d="M18 18h12M16 23h16" strokeDasharray="2 3" />
    </svg>
  );
}
