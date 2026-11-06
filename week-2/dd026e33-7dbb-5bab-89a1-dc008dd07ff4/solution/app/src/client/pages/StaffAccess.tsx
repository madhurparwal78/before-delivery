// Staff access (brief: Screens and layout › Staff access; Interactions › Revoke confirmation).
import { useEffect, useRef, useState } from "react";
import type { Member } from "../../shared/api.js";
import { formatMoment, formatTimestampDay } from "../../shared/zurich.js";
import { Interrupted, NoAnswer, errorCode, get, request } from "../api.js";
import { ROLE_LABEL, SIGNED_IN_AGAIN } from "../labels.js";
import { Dialog } from "../ui/Dialog.js";
import { StatusRegion, useNote } from "../ui/Feedback.js";

export function StaffAccess(): JSX.Element {
  const [staff, setStaff] = useState<Member[] | null>(null);
  const [confirming, setConfirming] = useState<Member | null>(null);
  const [note, say] = useNote();
  const keepRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    get<{ staff: Member[] }>("/api/staff", true).then((answer) => setStaff(answer.staff), () => undefined);
  }, []);

  const actionButton = (member: Member): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-row="${CSS.escape(member.id)}"] button`);

  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    document.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"] button`)?.focus();
  }, [staff]);

  const change = async (member: Member, active: boolean): Promise<void> => {
    say("Saving...");
    try {
      const answer = await request<{ member: Member }>(`/api/staff/${member.id}`, { method: "PATCH", body: { active } });
      focusAfter.current = member.id;
      setConfirming(null);
      setStaff((current) => (current ?? []).map((entry) => (entry.id === member.id ? answer.data.member : entry)));
      say(active ? `Access restored for ${member.name}.` : `Access revoked for ${member.name}.`);
    } catch (error) {
      setConfirming(null);
      if (errorCode(error) === "cannot_change_own_access") say("You can't change your own access.", "error");
      else if (error instanceof Interrupted) say(SIGNED_IN_AGAIN);
      else if (error instanceof NoAnswer) say("No answer from the server. Nothing has changed; press again.", "error");
    }
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Staff access</h1>
        <StatusRegion name="Access updates" note={note} />
      </header>
      <table aria-label="Staff access" className="table staff-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" className="hide-narrow">
              Email
            </th>
            <th scope="col" className="hide-narrow">
              Role
            </th>
            <th scope="col" className="hide-narrow">
              Last sign-in
            </th>
            <th scope="col">Access</th>
            <th scope="col">
              <span className="visually-hidden">Change access</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(staff ?? []).map((member) => (
            <tr key={member.id} data-row={member.id}>
              <td>
                {member.name}
                <span className="sub show-narrow">{ROLE_LABEL[member.role]}</span>
                <span className="sub show-narrow">{member.email}</span>
                <span className="sub show-narrow mono-text">
                  {`Last sign-in ${member.last_sign_in_at ? formatMoment(member.last_sign_in_at) : "Never"}`}
                </span>
              </td>
              <td className="hide-narrow">{member.email}</td>
              <td className="hide-narrow">{ROLE_LABEL[member.role]}</td>
              <td className="hide-narrow mono-text">{member.last_sign_in_at ? formatMoment(member.last_sign_in_at) : "Never"}</td>
              <td>{member.active ? "Active" : `Access revoked ${member.revoked_at ? formatTimestampDay(member.revoked_at) : ""}`}</td>
              <td>
                {member.active ? (
                  <button type="button" className="button small" aria-label={`Revoke access for ${member.name}`} onClick={() => setConfirming(member)}>
                    Revoke
                  </button>
                ) : (
                  <button type="button" className="button small" aria-label={`Restore access for ${member.name}`} onClick={() => void change(member, true)}>
                    Restore
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {confirming ? (
        <Dialog
          title={`Revoke access for ${confirming.name}?`}
          role="alertdialog"
          describedBy="revoke-text"
          initialFocus={keepRef}
          onClose={() => setConfirming(null)}
          returnFocus={() => (focusAfter.current === confirming.id ? actionButton(confirming) : null)}
        >
          <p id="revoke-text">{`${confirming.name} will be signed out on every device.`}</p>
          <div className="dialog-actions">
            <button ref={keepRef} type="button" className="button" onClick={() => setConfirming(null)}>
              Keep access
            </button>
            <button type="button" className="button primary" onClick={() => void change(confirming, false)}>
              Revoke access
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
