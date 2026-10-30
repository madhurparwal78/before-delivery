import { useState } from "react";
import { api } from "../api";
import { ROLE_LABELS } from "../labels";
import { ROLE_LINKS, navigate } from "../navigation";
import type { User } from "../types";
import { SignOutIcon } from "./Icons";

interface Props {
  user: User;
  path: string;
  onSignedOut: () => void;
}

export function TopBar({ user, path, onSignedOut }: Props) {
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    await api("DELETE", "/api/session").catch(() => undefined);
    onSignedOut();
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Teamseat</span>
        <span className="brand-agency">Northfold Language Access</span>
      </div>
      <p className="topbar-zone">All times Central (Chicago)</p>
      <nav className="topbar-nav" aria-label="Main">
        {ROLE_LINKS[user.role].map((link) => (
          <a
            key={link.path}
            href={link.path}
            className="nav-link"
            aria-current={link.path === path ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate(link.path);
            }}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <div className="topbar-end">
      <div className="topbar-person">
        <span className="person-name">{user.name}</span>
        <span className="person-role">
          {ROLE_LABELS[user.role]}
          {user.org ? `, ${user.org.name}` : ""}
        </span>
      </div>
      <button type="button" className="button button-quiet topbar-signout" onClick={() => void signOut()} disabled={leaving}>
        <SignOutIcon />
        Sign out
      </button>
      </div>
    </header>
  );
}
