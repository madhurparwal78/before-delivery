import { useEffect, useRef, useState } from "react";

/* Shared building blocks, built once and reused everywhere. */

export function Icon({ name, className = "" }) {
  const paths = {
    chevron: "M6 9l6 6 6-6",
    search: "M10.5 3a7.5 7.5 0 105.3 12.8l4.7 4.7 1.4-1.4-4.7-4.7A7.5 7.5 0 0010.5 3zm0 2a5.5 5.5 0 110 11 5.5 5.5 0 010-11z",
    arrow: "M7 17L17 7M9 7h8v8",
    plus: "M12 5v14M5 12h14",
    tick: "M4 12l5 5L20 6",
    cross: "M6 6l12 12M18 6L6 18",
    menu: "M4 6h16M4 12h16M4 18h16",
    copy: "M8 8h10v10H8zM6 16H4V4h12v2",
    database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm8 6c0 1.7-3.6 3-8 3s-8-1.3-8-3m16 6c0 1.7-3.6 3-8 3s-8-1.3-8-3",
  };
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}

export function Logo({ compact = false }) {
  return (
    <span className="mk-logo">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
        <path d="M5 18c4-1 3-7 7-8s7 1 9-3" stroke="#6d4dff" strokeWidth="2.4" fill="none"
          strokeLinecap="round" />
        <path d="M5 13c4-1 3-7 7-8s6 1 9-2" stroke="#ff7ac6" strokeWidth="1.8" fill="none"
          opacity="0.6" strokeLinecap="round" />
      </svg>
      {!compact && <span>Wayline</span>}
    </span>
  );
}

export function StatusDot({ status }) {
  return <span className={`dot dot-${status}`} aria-hidden="true" />;
}

export function StatusWord({ status }) {
  const word = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span>
      <StatusDot status={status} />
      {word}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled, id }) {
  const inputId = id || `sw-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <span className="switch">
      <input type="checkbox" role="switch" id={inputId} checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      <label className="switch-label" htmlFor={inputId}>{label}</label>
    </span>
  );
}

export function Alert({ children, tone = "info", id }) {
  return (
    <div className={`alert-box ${tone === "error" ? "alert-error" : ""}`} role="alert" id={id}>
      {children}
    </div>
  );
}

export function Status({ name, message, id }) {
  return (
    <p className="status-line" role="status" aria-live="polite" id={id}>{message}</p>
  );
}

export function Field({ label, hint, error, htmlFor, children }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="field-hint" id={`${htmlFor}-hint`}>{hint}</span>}
      {error && <span className="field-error" id={`${htmlFor}-error`}>{error}</span>}
    </div>
  );
}

export function Dialog({ title, description, onClose, children, labelledBy, initialRef }) {
  const backdropRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" ref={backdropRef}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={labelledBy}>
        <h2 id={labelledBy}>{title}</h2>
        {description && <p>{description}</p>}
        {children}
      </div>
    </div>
  );
}

export function Menu({ trigger, children, label }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (e.key === "Tab") {
        const focusables = panelRef.current
          ? Array.from(panelRef.current.querySelectorAll("a,button")).filter((el) => el.offsetParent !== null)
          : [];
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const onKeyDown = (e) => {
    if (open) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      window.setTimeout(() => {
        const first = panelRef.current?.querySelector("a,button");
        first?.focus();
      }, 20);
    }
  };
  const items = typeof children === "function" ? children({ close: () => setOpen(false) }) : children;
  return (
    <span className="menu-wrap" ref={wrapRef}>
      <button ref={triggerRef} type="button" className="btn btn-ghost btn-sm"
        aria-haspopup="true" aria-expanded={open} aria-label={label}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            window.setTimeout(() => {
              const first = panelRef.current?.querySelector("a,button");
              first?.focus();
            }, 20);
          }
        }}
        onKeyDown={onKeyDown}>
        {trigger}
        <Icon name="chevron" />
      </button>
      {open && (
        <span className="menu-panel pop-in" ref={panelRef} role="menu">
          {items}
        </span>
      )}
    </span>
  );
}

/* A closed overlay is removed from the tree entirely, so nothing inert remains. */
export function Overlay({ title, onClose, children, wide = false }) {
  const closeRef = useRef(null);
  const bodyRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && bodyRef.current) {
        const focusables = Array.from(
          bodyRef.current.querySelectorAll("a,button,input,select,textarea,[tabindex]")
        ).filter((el) => el.offsetParent !== null && !el.hasAttribute("disabled"));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);
  return (
    <div className="overlay" ref={bodyRef} role="dialog" aria-modal="true" aria-label={title}>
      <div className="overlay-head">
        <button ref={closeRef} type="button" className="btn btn-outline btn-sm" onClick={onClose}>
          <Icon name="cross" /> Close {title.toLowerCase()}
        </button>
      </div>
      <div className="overlay-links">{children}</div>
    </div>
  );
}

export function Tabs({ name, tabs, active, onChange, idBase }) {
  const onKeyDown = (e) => {
    const index = tabs.findIndex((t) => t.id === active);
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    window.setTimeout(() => {
      document.getElementById(`${idBase}-tab-${tabs[next].id}`)?.focus();
    }, 10);
  };
  return (
    <div>
      <div className="tabs" role="tablist" aria-label={name} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" className="tab"
            id={`${idBase}-tab-${tab.id}`} aria-selected={tab.id === active}
            aria-controls={`${idBase}-panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            onClick={() => onChange(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.filter((t) => t.id === active).map((tab) => (
        <div key={tab.id} role="tabpanel" id={`${idBase}-panel-${tab.id}`}
          aria-labelledby={`${idBase}-tab-${tab.id}`}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
