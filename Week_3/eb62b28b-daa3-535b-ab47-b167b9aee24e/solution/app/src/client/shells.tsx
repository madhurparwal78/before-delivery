// The member and staff frames around each screen, with their navigation.

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Role } from "../shared/api";
import { sendNoAnswer } from "./api";
import { CloudField } from "./glyphs";
import { closeDialog, forgetEverythingTyped, navigate, openDialog, setSession, useAddress, useSession } from "./stores";
import { Button, Dialog, DialogMessage, Link, onSubmit, TextField, useAction, useForm } from "./ui";

const MEMBER_LINKS = [
  ["Home", "/me"], ["Membership", "/me/membership"], ["Draws", "/me/draws"], ["Results", "/me/results"],
  ["Plan", "/me/plan"], ["Messages", "/me/messages"], ["Records", "/me/records"], ["Account", "/me/account"],
] as const;

async function signOut(): Promise<void> {
  await sendNoAnswer("DELETE", "/api/session");
  forgetEverythingTyped();
  setSession({ kind: "none" });
  navigate("/signin");
}

function NavLinks({ links, onFollow }: { links: readonly (readonly [string, string])[]; onFollow?: () => void }) {
  const { path } = useAddress();
  return (
    <>
      {links.map(([label, to]) => {
        const current = path === to || (to !== "/me" && path.startsWith(`${to}/`));
        return (
          <span key={to} className="nav-item" {...(current ? { "data-current": "true" } : {})}>
            <Link to={to} className="nav-link" {...(onFollow ? { onFollow } : {})}>{label}</Link>
          </span>
        );
      })}
    </>
  );
}

export function MemberShell({ children }: { children: ReactNode }) {
  const action = useAction();
  const out = (): void => void action.run(async () => {
    await signOut();
    return "";
  });
  return (
    <>
      <CloudField />
      <header className="app-bar">
        <Link to="/me" className="brand">Ocotillo</Link>
        <nav aria-label="Member" className="desk-nav member-nav-wide">
          <NavLinks links={MEMBER_LINKS} />
          <Button kind="quiet" action={action} onClick={out}>Sign out</Button>
        </nav>
        <div className="menu-opener"><Button kind="quiet" onClick={(event) => openDialog("menu", event.currentTarget)}>Menu</Button></div>
      </header>
      <main className="page">{children}</main>
      <Dialog id="menu" title="Menu" kind="sheet">
        <nav aria-label="Member" className="sheet-nav">
          <NavLinks links={MEMBER_LINKS} onFollow={closeDialog} />
          <Button kind="quiet" action={action} onClick={() => {
            closeDialog();
            out();
          }}>Sign out</Button>
        </nav>
      </Dialog>
    </>
  );
}

const DESK_LINKS: readonly { label: string; to: string; roles: readonly Role[] }[] = [
  { label: "Members", to: "/staff/members", roles: ["owner", "specialist", "coordinator", "billingLead"] },
  { label: "Care messages", to: "/staff/messages", roles: ["owner", "specialist", "coordinator"] },
  { label: "Draw calendar", to: "/staff/calendar", roles: ["owner", "coordinator"] },
  { label: "Results to release", to: "/staff/results", roles: ["owner", "specialist"] },
  { label: "Range table", to: "/staff/ranges", roles: ["owner"] },
  { label: "Receipts", to: "/staff/receipts", roles: ["owner", "billingLead"] },
  { label: "Team", to: "/staff/team", roles: ["owner"] },
];

export function ChangePasswordDialog() {
  return (
    <Dialog id="change-password" title="Change password">
      <ChangePasswordBody />
    </Dialog>
  );
}

function ChangePasswordBody() {
  const form = useForm("change-password", { currentPassword: "", newPassword: "" });
  const action = useAction();
  const submit = (): void => {
    void action.run(async () => {
      await sendNoAnswer("POST", "/api/me/password", { currentPassword: form.value("currentPassword"), newPassword: form.value("newPassword") });
      closeDialog();
      return "Password changed. Your other sessions have ended.";
    });
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <DialogMessage action={action} />
      <TextField form={form} name="currentPassword" label="Current password" type="password" problem={action.problem} autoComplete="current-password" />
      <TextField form={form} name="newPassword" label="New password" type="password" problem={action.problem} autoComplete="new-password" />
      <Button type="submit" action={action}>Save password</Button>
    </form>
  );
}

const NAV_LEAD_PX = 16;

export function StaffShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.kind === "live" ? session.view.user.role : "member";
  const links = useMemo(() => DESK_LINKS.filter((link) => link.roles.includes(role)).map((link) => [link.label, link.to] as const), [role]);
  const action = useAction();
  const nav = useRef<HTMLElement>(null);
  const { path } = useAddress();
  // At 375 the Desk row scrolls sideways; it opens with the current screen's link in view.
  useLayoutEffect(() => {
    const row = nav.current;
    const current = row?.querySelector("[data-current]");
    if (row && current) row.scrollLeft += current.getBoundingClientRect().left - row.getBoundingClientRect().left - NAV_LEAD_PX;
  }, [path]);
  return (
    <>
      <CloudField />
      <header className="app-bar app-bar-desk">
        <Link to={links[0]?.[1] ?? "/"} className="brand">Ocotillo</Link>
        <nav ref={nav} aria-label="Desk" className="desk-nav">
          <NavLinks links={links} />
          <Button kind="quiet" onClick={(event) => openDialog("change-password", event.currentTarget)}>Change password</Button>
          <Button kind="quiet" action={action} onClick={() => void action.run(async () => {
            await signOut();
            return "";
          })}>Sign out</Button>
        </nav>
      </header>
      <main className="page">{children}</main>
      <ChangePasswordDialog />
    </>
  );
}

export const firstNameOf = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? fullName;
