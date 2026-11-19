import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, UserPlus } from "lucide-react";
import type { Review, Seats, WorkspaceMember } from "../../shared/types.js";
import { addDays, dayLabel, isoWeekOf, mondayOfIsoWeek } from "../../shared/time.js";
import { api, ApiFailure, SERVER_ERROR } from "../api.js";
import { announce } from "../announce.js";
import type { Me } from "../App.js";
import { Field } from "../components/Field.js";

const STATUS: Record<WorkspaceMember["status"], string> = { active: "Active", invited: "Invited", pending_billing: "Waiting for billing" };

export function WorkspacePage({ me }: { me: Me }) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [seats, setSeats] = useState<Seats | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [week, setWeek] = useState(isoWeekOf(me.today));
  const [review, setReview] = useState<Review | null>(null);
  // The sections paint once, when members and the first review have both settled, so neither
  // load pushes an already-drawn section down the page.
  const [settled, setSettled] = useState({ members: false, review: false });

  const loadMembers = useCallback(async () => {
    try {
      const data = await api<{ members: WorkspaceMember[]; seats: Seats }>("GET", "/api/workspace/members");
      setMembers(data.members);
      setSeats(data.seats);
      setSettled((s) => (s.members ? s : { ...s, members: true }));
    } catch {
      announce(SERVER_ERROR);
      setSettled({ members: true, review: true });
    }
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    let live = true;
    setReview(null);
    api<Review>("GET", `/api/workspace/review?week=${week}`)
      .then((data) => live && setReview(data))
      .catch(() => announce(SERVER_ERROR))
      .finally(() => live && setSettled((s) => (s.members && !s.review ? { ...s, review: true } : s)));
    return () => {
      live = false;
    };
  }, [week, members]);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setInviting(true);
    setEmailError(undefined);
    try {
      const result = await api<{ email?: "sent" | "queued"; billing?: "queued" }>("POST", "/api/workspace/invitations", { body: { email: address } });
      announce(
        result.billing === "queued"
          ? "Invite saved. Billing is unreachable, so the seat and email will go through when it's back."
          : result.email === "sent"
            ? `Invite sent to ${address}.`
            : `Invite saved. Mail is unreachable, so the email to ${address} is queued.`,
      );
      setEmail("");
      await loadMembers();
    } catch (failure) {
      let copy = SERVER_ERROR;
      if (failure instanceof ApiFailure) {
        if (failure.code === "already_member") copy = `${address} is already in this workspace.`;
        else if (failure.code === "email_taken") copy = `${address} already has a Daybook.`;
        else if (failure.code === "workspace_read_only") copy = "This workspace is read-only. Planning resumes when the subscription is active.";
        else if (failure.status === 422) copy = failure.fields.email ?? "Enter a valid email address.";
      }
      setEmailError(copy);
      announce(copy);
    } finally {
      setInviting(false);
    }
  };

  const remove = async (member: WorkspaceMember) => {
    const label = member.name ?? member.email;
    setRemoving(member.id);
    try {
      const result = await api<{ seats: Seats }>("DELETE", `/api/workspace/members/${member.id}`);
      announce(`Removed ${label}. Active seats: ${result.seats.active}.`);
      await loadMembers();
    } catch (failure) {
      announce(
        failure instanceof ApiFailure && failure.code === "billing_unavailable"
          ? `Billing is unreachable, so ${label} is still a member. Try again shortly.`
          : failure instanceof ApiFailure && failure.code === "cannot_remove_owner"
            ? "The owner can't be removed."
            : SERVER_ERROR,
      );
    } finally {
      setRemoving(null);
    }
  };

  const monday = mondayOfIsoWeek(week) ?? me.today;
  const shift = (days: number) => setWeek(isoWeekOf(addDays(monday, days)));

  if (!settled.members || !settled.review) {
    return (
      <div className="workspace">
        <h1 className="page-title">Workspace</h1>
        <p className="muted" aria-busy="true">
          Reading the workspace…
        </p>
      </div>
    );
  }

  return (
    <div className="workspace">
      <h1 className="page-title">Workspace</h1>
      <section className="settings-section seats" aria-label="Seats">
        <h2 className="section-title">Seats</h2>
        <p className="seat-count">
          Active seats: <span className="mono">{seats ? seats.active : "…"}</span>
        </p>
        <form className="invite" aria-label="Invite a member" onSubmit={(event) => void invite(event)} noValidate>
          <Field label="Email" type="email" autoComplete="off" value={email} error={emailError} onChange={(e) => setEmail(e.currentTarget.value)} />
          <button type="submit" className="button button-primary" aria-busy={inviting} disabled={inviting}>
            <UserPlus aria-hidden="true" size={18} /> {inviting ? "Sending…" : "Send invite"}
          </button>
        </form>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Members</h2>
        <table className="ledger" aria-label="Members">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((member) => (
              <tr key={member.id}>
                <td data-label="Name">{member.name ?? "—"}</td>
                <td data-label="Email" className="wrap">
                  {member.email}
                </td>
                <td data-label="Role">{member.role === "owner" ? "Owner" : "Member"}</td>
                <td data-label="Status">{STATUS[member.status]}</td>
                <td className="cell-action">
                  {member.role !== "owner" && (
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={`Remove ${member.name ?? member.email}`}
                      aria-busy={removing === member.id}
                      disabled={removing === member.id}
                      onClick={() => void remove(member)}
                    >
                      {removing === member.id ? "Removing…" : "Remove"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {members === null && <p className="muted">Reading members…</p>}
      </section>

      <section className="settings-section">
        <div className="review-head">
          <h2 className="section-title">Week of {dayLabel(monday)}</h2>
          <div className="button-row">
            <button type="button" className="button button-quiet" onClick={() => shift(-7)}>
              <ChevronLeft aria-hidden="true" size={18} /> Previous week
            </button>
            <button type="button" className="button button-quiet" onClick={() => shift(7)}>
              Next week <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
        <table className="ledger" aria-label="Weekly review">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col" className="num">
                Planned
              </th>
              <th scope="col" className="num">
                Done
              </th>
            </tr>
          </thead>
          <tbody>
            {(review?.members ?? []).map((row) => (
              <tr key={row.memberId}>
                <td data-label="Member">{row.name}</td>
                <td data-label="Planned" className="num mono">
                  {row.plannedMinutes}m
                </td>
                <td data-label="Done" className="num mono">
                  {row.doneMinutes}m
                </td>
              </tr>
            ))}
          </tbody>
          {review && (
            <tfoot>
              <tr>
                <th scope="row" data-label="Member">
                  Total
                </th>
                <td data-label="Planned" className="num mono">
                  {review.totals.plannedMinutes}m
                </td>
                <td data-label="Done" className="num mono">
                  {review.totals.doneMinutes}m
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
}
