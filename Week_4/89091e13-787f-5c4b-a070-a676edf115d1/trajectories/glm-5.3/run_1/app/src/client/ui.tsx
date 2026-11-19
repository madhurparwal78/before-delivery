// Shared UI pieces: console top bar, panels, forms, tables, banners.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { linkProps, navigate } from "./router.js";

export function TopBar({
  workspaceId,
  onSignOut,
}: {
  workspaceId: string;
  onSignOut: () => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const links: { label: string; path: string }[] = [
    { label: "Explorer", path: `/w/${workspaceId}/explorer` },
    { label: "Submit", path: `/w/${workspaceId}/submit` },
    { label: "Nodes", path: `/w/${workspaceId}/nodes` },
    { label: "Stake", path: `/w/${workspaceId}/stake` },
    { label: "Vote", path: `/w/${workspaceId}/vote` },
  ];

  return (
    <>
      <header className="top-bar">
        <a className="logo" aria-label="Fernsquare home" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>
          <span aria-hidden="true">▦</span> Fernsquare
        </a>
        <nav aria-label="Workspace">
          {links.map((link) => {
            const current = window.location.pathname === link.path;
            return (
              <a key={link.path} {...linkProps(link.path)} aria-current={current ? "page" : undefined}>
                {link.label}
              </a>
            );
          })}
        </nav>
        <div className="spacer" />
        <a className="pill primary" {...linkProps(`/w/${workspaceId}/submit`)}>
          Submit blob
        </a>
        <button
          ref={menuButtonRef}
          type="button"
          className="pill menu-button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
      </header>
      {menuOpen && (
        <div
          ref={menuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(6,5,10,0.9)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            zIndex: 60,
          }}
        >
          <a className="pill" {...linkProps(`/w/${workspaceId}/members`)} onClick={() => setMenuOpen(false)}>
            Members
          </a>
          <a className="pill" {...linkProps(`/w/${workspaceId}/ledger`)} onClick={() => setMenuOpen(false)}>
            Ledger
          </a>
          <button
            type="button"
            className="pill"
            onClick={() => {
              setMenuOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </>
  );
}

export function WorkspaceTabs({ workspaceId, current }: { workspaceId: string; current: string }): JSX.Element {
  const tabs = [
    { label: "Explorer", path: `/w/${workspaceId}/explorer` },
    { label: "Submit", path: `/w/${workspaceId}/submit` },
    { label: "Nodes", path: `/w/${workspaceId}/nodes` },
    { label: "Stake", path: `/w/${workspaceId}/stake` },
    { label: "Vote", path: `/w/${workspaceId}/vote` },
  ];
  return (
    <div className="tabs" role="tablist" aria-label="Workspace panels">
      {tabs.map((tab) => (
        <a key={tab.path} role="tab" aria-selected={tab.path === current ? "true" : "false"} {...linkProps(tab.path)}>
          {tab.label}
        </a>
      ))}
    </div>
  );
}

export function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`panel ${className ?? ""}`}>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function StatTrio({
  stats,
}: {
  stats: { value: string; unit?: string; noun: string; caption: string }[];
}): JSX.Element {
  return (
    <section aria-label="Network stats" className="stat-trio">
      {stats.map((stat) => (
        <div className="stat" key={stat.caption}>
          <p className="value num">
            {stat.value}
            {stat.unit && <span className="unit">{stat.unit}</span>} <span style={{ fontSize: 18 }}>{stat.noun}</span>
          </p>
          <p className="caption">{stat.caption}</p>
        </div>
      ))}
    </section>
  );
}

export function Banner({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="banner" role="alert">
      {children}
    </div>
  );
}

export function StatusLine({ name, children }: { name: string; children: ReactNode }): JSX.Element {
  return (
    <p className="status-line" role="status" aria-live="polite" aria-label={name}>
      {children}
    </p>
  );
}

export function FormAlert({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <p role="alert" style={{ color: "#ff9d9d", marginTop: 0 }}>
      {message}
    </p>
  );
}

export interface FieldState {
  value: string;
  error: string | null;
}

export function Field({
  label,
  children,
  error,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  error?: string | null;
  htmlFor?: string;
}): JSX.Element {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="label">{label}</span>
      {children}
      {error && <span className="error">{error}</span>}
    </label>
  );
}

export function NotFound({ workspaceId }: { workspaceId?: string }): JSX.Element {
  return (
    <div className="empty-state">
      <h1>Not found</h1>
      <a className="pill" {...linkProps(workspaceId ? `/w/${workspaceId}/explorer` : "/signin")}>
        Back to the explorer
      </a>
    </div>
  );
}

export function Loading(): JSX.Element {
  return (
    <div className="panel" aria-busy="true" style={{ opacity: 0.6 }}>
      <div style={{ height: 120, background: "linear-gradient(90deg, rgba(157,123,255,0.08), rgba(157,123,255,0.02))", borderRadius: 8 }} />
    </div>
  );
}

export function CopyPill({ value }: { value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="pill"
      style={{ minHeight: 32, minWidth: 32, padding: "0 12px", fontSize: 12 }}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
