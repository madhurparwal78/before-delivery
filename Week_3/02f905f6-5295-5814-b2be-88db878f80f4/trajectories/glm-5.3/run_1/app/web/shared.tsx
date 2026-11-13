import React, { useEffect, useState } from "react";

// Cone glyph: upright for not yet fired, bent over for fired or cooling.
export function ConeGlyph({ bent, size = 16, color }: { bent: boolean; size?: number; color?: string }): React.ReactElement {
  const stroke = color ?? "currentColor";
  return (
    <svg
      className="cone-glyph"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {bent ? (
        <path
          d="M4 13 L4 8 C4 6 5.5 3.5 10.5 3 L11.5 3.8 L8 6.2 C6.5 7 6 8.5 6 13 Z"
          fill="none"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M8 2.5 L11.5 13 L4.5 13 Z"
          fill="none"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      )}
      <line x1="2.5" y1="13.5" x2="13.5" y2="13.5" stroke={stroke} strokeWidth="1.2" />
    </svg>
  );
}

const BENT_STATUS = new Set(["firing", "cooling", "unloadable", "ready", "collected", "uncollected", "unloaded"]);

export function StatusChip({ status, label }: { status: string; label: string }): React.ReactElement {
  return (
    <span className="status-chip">
      <ConeGlyph bent={BENT_STATUS.has(status)} size={15} />
      <span>{label}</span>
    </span>
  );
}

export function useSession(): { user: User | null; loading: boolean; reload: () => Promise<void> } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = React.useCallback(async () => {
    try {
      const data = await api.get<{ user: User }>("/api/me");
      setUser(data.user);
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { user, loading, reload };
}

import { api, type User } from "./api.js";
