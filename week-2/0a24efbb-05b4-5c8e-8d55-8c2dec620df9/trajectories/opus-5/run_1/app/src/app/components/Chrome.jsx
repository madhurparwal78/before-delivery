import { useState } from 'react';
import { ui } from '../../shared/copy.js';
import { call } from '../api.js';
import { Icon } from './Icon.jsx';

function SignOutButton() {
  const [leaving, setLeaving] = useState(false);
  return (
    <button
      type="button"
      className="button quiet"
      disabled={leaving}
      onClick={async () => {
        setLeaving(true);
        await call('DELETE', '/api/session');
        window.location.assign('/login?signed_out=1');
      }}
    >
      <Icon name="exit" />
      {ui.signOut}
    </button>
  );
}

export function Breadcrumb({ steps }) {
  return (
    <nav aria-label={ui.breadcrumb} className="breadcrumb">
      <ol>
        {steps.map((step, index) => (
          <li key={step.label}>
            {index > 0 ? <Icon name="chevron-right" size={14} className="breadcrumb-chevron" /> : null}
            {step.href ? <a href={step.href}>{step.label}</a> : <span aria-current="page">{step.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function TopBar({ caller, breadcrumb }) {
  return (
    <header className="topbar">
      <span className="brand">{ui.brand}</span>
      <Breadcrumb steps={breadcrumb} />
      <div className="topbar-end">
        <span className="who">
          <span className="initials" aria-hidden="true">
            {caller.initials}
          </span>
          <span className="who-lines">
            <span className="who-name">{caller.name}</span>
            <span className="who-role">{caller.roleLine}</span>
          </span>
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}

export function BareBanner() {
  return (
    <header className="topbar bare">
      <span className="brand">{ui.brand}</span>
    </header>
  );
}

export function Footer({ policyVersion }) {
  return (
    <footer className="footer">
      <p data-footer-line>
        {policyVersion === null ? 'Rostara attendance desk.' : ui.footer(policyVersion)}
      </p>
    </footer>
  );
}

export function SharedFooter() {
  return (
    <footer className="footer">
      <p>{ui.sharedFooter}</p>
    </footer>
  );
}
