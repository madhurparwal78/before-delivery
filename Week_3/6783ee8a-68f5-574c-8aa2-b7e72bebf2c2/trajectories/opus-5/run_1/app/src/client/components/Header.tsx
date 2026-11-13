import { useState, type ReactNode } from 'react';
import { useApp } from '../app.js';
import { useIsPhoneLayout } from './hooks.js';

function BrandMark(): JSX.Element {
  return (
    <svg className="brand-mark" viewBox="0 0 44 28" aria-hidden="true" focusable="false">
      <path
        d="M14 4c-5 0-7 3-7 7v2c0 2-2 3-4 3 2 0 4 1 4 3v2c0 4 2 7 7 7"
        fill="none"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M30 4c5 0 7 3 7 7v2c0 2 2 3 4 3-2 0-4 1-4 3v2c0 4-2 7-7 7"
        fill="none"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="22" cy="14" r="3.4" />
    </svg>
  );
}

function ThreeBarIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="bars-icon">
      <path d="M4 7h16M4 12h16M4 17h16" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface HeaderProps {
  children?: ReactNode;
  /** Shown beside the brand at every width, as the notebook header does. */
  lead?: ReactNode;
}

/** The workspace header: a white bar with a thin light grey rule underneath. */
export function WorkspaceHeader({ children, lead }: HeaderProps): JSX.Element {
  const app = useApp();
  const phone = useIsPhoneLayout();
  const [open, setOpen] = useState(false);

  return (
    <header className="workspace-header">
      <div className="header-inner">
        <a
          className="brand"
          href="/"
          aria-label="Brackenpad home"
          onClick={(event) => {
            event.preventDefault();
            app.navigate('/');
          }}
        >
          <BrandMark />
          <span className="brand-wordmark">brackenpad</span>
        </a>
        {lead}
        {phone ? (
          <button
            type="button"
            className="icon-button header-open"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ThreeBarIcon />
          </button>
        ) : (
          <div className="header-nav">{children}</div>
        )}
      </div>
      {phone && open ? <div className="header-panel">{children}</div> : null}
    </header>
  );
}
