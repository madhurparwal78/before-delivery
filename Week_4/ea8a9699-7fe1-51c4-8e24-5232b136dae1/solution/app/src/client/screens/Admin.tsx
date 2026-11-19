// Admin for design ops leads (brief: Screens > Admin; Interactions > Admin roster; Feedback > Admin status).
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Member, PlanId, PlanView, Roster, SeatResult, Upgrade, UpgradeResult, WorkspaceRef } from "../../shared/api.js";
import { api, randomToken } from "../lib/api.js";
import { LiveRegion, useLive } from "../lib/live.js";
import { navigate, useLocation } from "../lib/router.js";
import { MemberSeatTag, Pending, PlanMark, RollingNumber, SeatStateTag, type SeatTag } from "../components/bits.js";
import { ErrorSummary, FieldError, fieldAttrs, useFieldErrors } from "../components/ErrorSummary.js";

type SeatFilter = "all" | "seated" | "unseated";
type Sort = "name" | "seat";

const byName = (a: Member, b: Member): number => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase());
const sorted = (members: Member[], sort: Sort): Member[] =>
  [...members].sort((a, b) => (sort === "seat" && a.hasSeat !== b.hasSeat ? (a.hasSeat ? -1 : 1) : byName(a, b)));
const matches = (m: Member, filter: SeatFilter): boolean => filter === "all" || (filter === "seated") === m.hasSeat;

export function Admin({ workspace }: { workspace: WorkspaceRef }) {
  const slug = workspace.slug;
  const live = useLive();
  const { query } = useLocation();
  const filter: SeatFilter = query.get("seat") === "seated" ? "seated" : query.get("seat") === "unseated" ? "unseated" : "all";
  const sort: Sort = query.get("sort") === "seat" ? "seat" : "name";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [visible, setVisible] = useState<string[]>([]);
  const [meter, setMeter] = useState<{ used: number; cap: number } | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [choice, setChoice] = useState<PlanId | null>(null);
  const [upgradeKey, setUpgradeKey] = useState(randomToken);
  const [upgrading, setUpgrading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const upgradeForm = useFieldErrors();
  const inviteForm = useFieldErrors();
  const offboardForm = useFieldErrors();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [collaborator, setCollaborator] = useState("");
  const [offboarding, setOffboarding] = useState(false);

  const apply = useCallback((roster: Roster, keepVisible: boolean) => {
    setMembers(roster.members);
    setMeter({ used: roster.seatsUsed, cap: roster.seatCap });
    setVisible((current) => {
      const fits = sorted(roster.members.filter((m) => matches(m, filter)), sort).map((m) => m.id);
      if (!keepVisible) return fits;
      const kept = current.filter((id) => roster.members.some((m) => m.id === id));
      return [...kept, ...fits.filter((id) => !kept.includes(id))];
    });
  }, [filter, sort]);

  const loadRoster = useCallback(async (keepVisible: boolean) => {
    const answer = await api<Roster>("GET", `/api/workspaces/${slug}/seats`);
    if (answer.ok) apply(answer.data, keepVisible);
    setRosterLoading(false);
  }, [slug, apply]);

  const loadPlan = useCallback(async () => {
    const answer = await api<PlanView>("GET", `/api/workspaces/${slug}/plan`);
    if (answer.ok) {
      setPlan(answer.data);
      setMeter({ used: answer.data.seatsUsed, cap: answer.data.seatCap });
    }
    setPlanLoading(false);
  }, [slug]);

  useEffect(() => {
    void loadRoster(false);
  }, [loadRoster]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const setView = (next: { seat?: SeatFilter; sort?: Sort }): void => {
    const seat = next.seat ?? filter;
    const order = next.sort ?? sort;
    const params = new URLSearchParams();
    if (seat !== "all") params.set("seat", seat);
    if (order !== "name") params.set("sort", order);
    const search = params.toString();
    navigate(`/w/${slug}/admin${search ? `?${search}` : ""}`);
  };

  const changeSeat = async (member: Member): Promise<void> => {
    if (!meter || busyRow) return;
    const assigning = !member.hasSeat;
    const before = { ...meter };
    setBusyRow(member.id);
    setMembers((list) => list?.map((m) => (m.id === member.id ? { ...m, hasSeat: assigning } : m)) ?? null);
    setMeter({ used: meter.used + (assigning ? 1 : -1), cap: meter.cap });
    const answer = assigning
      ? await api<SeatResult>("POST", `/api/workspaces/${slug}/seats`, { body: { memberId: member.id } })
      : await api<SeatResult>("DELETE", `/api/workspaces/${slug}/seats/${member.id}`);
    setBusyRow(null);
    if (answer.ok) {
      setMeter({ used: answer.data.seatsUsed, cap: answer.data.seatCap });
      live.say(
        assigning
          ? `Seat assigned to ${member.displayName}. ${answer.data.seatsUsed} of ${answer.data.seatCap} seats in use.`
          : `Seat freed from ${member.displayName}. ${answer.data.seatsUsed} of ${answer.data.seatCap} seats in use.`,
      );
      void loadPlan();
    } else if (answer.error?.error === "no_seats_left") {
      live.say("No seats left on this plan. Upgrade the plan or free a seat.", true);
      await loadRoster(true);
    } else {
      setMembers((list) => list?.map((m) => (m.id === member.id ? { ...m, hasSeat: !assigning } : m)) ?? null);
      setMeter(before);
      live.say(`The seat change could not be saved. ${before.used} of ${before.cap} seats in use.`, true);
    }
    buttons.current.get(member.id)?.focus();
  };

  const upgrade = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (upgrading) return;
    setUpgrading(true);
    live.say("Upgrading plan...");
    const answer = await api<UpgradeResult>("POST", `/api/workspaces/${slug}/plan`, { body: choice ? { plan: choice } : {}, headers: { "Idempotency-Key": upgradeKey } });
    setUpgrading(false);
    if (answer.ok) {
      upgradeForm.clear();
      setUpgradeKey(randomToken());
      setChoice(null);
      setMeter({ used: answer.data.seatsUsed, cap: answer.data.seatCap });
      live.say(`Plan upgraded to ${answer.data.planName}. ${answer.data.seatCap} seats available. Receipt sent to ${answer.data.receiptSentTo}.`);
      void loadPlan();
      return;
    }
    const code = answer.error?.error;
    if (answer.error?.errors) {
      live.say("");
      upgradeForm.show(answer.error.errors);
    } else if (code === "mail_unavailable") live.say("The receipt email could not be sent, so the upgrade was cancelled. Your plan is unchanged.", true);
    else if (code === "billing_unavailable") live.say("Billing is unreachable. Your plan is unchanged.", true);
    else if (code === "idempotency_in_progress") live.say("This upgrade is already in progress.", true);
    else live.say(answer.error?.message ?? "The upgrade could not be completed. Your plan is unchanged.", true);
    void loadPlan();
  };

  const invite = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setInviting(true);
    const answer = await api<{ email: string }>("POST", `/api/workspaces/${slug}/invites`, { body: { email: inviteEmail, displayName: inviteName } });
    setInviting(false);
    if (answer.ok) {
      inviteForm.clear();
      setInviteEmail("");
      setInviteName("");
      live.say(`Invite sent to ${answer.data.email}.`);
      void loadRoster(true);
    } else if (answer.error?.errors) inviteForm.show(answer.error.errors);
    else live.say(answer.error?.error === "mail_unavailable" ? "The invite email could not be sent. No invite was created." : "The invite could not be sent. Try again.", true);
  };

  const offboard = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setOffboarding(true);
    const answer = await api<{ email: string; revoked: number }>("POST", `/api/workspaces/${slug}/collaborators/offboard`, { body: { email: collaborator } });
    setOffboarding(false);
    if (answer.ok) {
      offboardForm.clear();
      setCollaborator("");
      live.say(`Revoked ${answer.data.revoked} review links for ${answer.data.email}.`);
    } else if (answer.error?.errors) offboardForm.show(answer.error.errors);
    else live.say("The review links could not be revoked. Try again.", true);
  };

  useEffect(() => {
    if (members) setVisible(sorted(members.filter((m) => matches(m, filter)), sort).map((m) => m.id));
    // The visible rows are fixed when the view loads or the filter or sort changes, so seat changes stay in place.
  }, [filter, sort]);

  // Wait for both initial reads so the roster and plan have their final layout together.
  // Use distinct grid keys: otherwise React reuses the second skeleton div as admin__side,
  // moving that already-painted node below the taller roster in the stacked layout.
  if ((members === null && rosterLoading) || planLoading) {
    return (
      <main className="admin" id="main">
        <h1 className="page-title">{workspace.name} admin</h1>
        <LiveRegion live={live} name="Admin status" />
        <div key="loading" className="admin__grid" aria-hidden="true">
          <div className="skeleton-block" />
          <div className="skeleton-block" />
        </div>
      </main>
    );
  }

  const seatTag: SeatTag | null = meter ? (meter.used > meter.cap ? "Over cap" : meter.used === meter.cap ? "Full" : "Seats free") : null;
  const byId = new Map((members ?? []).map((m) => [m.id, m]));
  const firstUpgrade = plan?.upgrades[0]?.plan;

  return (
    <main className="admin" id="main">
      <h1 className="page-title">{workspace.name} admin</h1>
      <LiveRegion live={live} name="Admin status" />
      <div key="ready" className="admin__grid">
        <div className="admin__main">
          <section className="panel admin__roster" aria-labelledby="roster-title">
            <div className="section-row">
              <h2 className="section-title" id="roster-title">
                Members
              </h2>
            </div>
            <div className="roster-controls">
              <div role="radiogroup" aria-label="Show members" className="segmented">
                {(
                  [
                    ["all", "All"],
                    ["seated", "Seated"],
                    ["unseated", "Without seat"],
                  ] as const
                ).map(([value, text]) => (
                  <label key={value} className="segmented__option">
                    <input type="radio" name="show-members" value={value} checked={filter === value} onChange={() => setView({ seat: value })} />
                    <span>{text}</span>
                  </label>
                ))}
              </div>
              <label className="inline-field">
                <span className="field__label">Sort</span>
                <select aria-label="Sort members" value={sort} onChange={(e) => setView({ sort: e.target.value === "seat" ? "seat" : "name" })}>
                  <option value="name">Name</option>
                  <option value="seat">Seat</option>
                </select>
              </label>
            </div>
            {members === null ? (
              <div className="skeleton-block" aria-hidden="true" />
            ) : (
              <table className="roster" aria-label="Members">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Handle</th>
                    <th scope="col">Seat</th>
                    <th scope="col">
                      <span className="visually-hidden">Seat action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((id) => {
                    const m = byId.get(id);
                    if (!m) return null;
                    return (
                      <tr key={id} data-seated={m.hasSeat ? "true" : "false"}>
                        <td className="roster__name">{m.displayName}</td>
                        <td className="roster__email">{m.email}</td>
                        <td className="mono">@{m.handle}</td>
                        <td className="roster__seat">
                          <MemberSeatTag seated={m.hasSeat} />
                        </td>
                        <td className="roster__action">
                          <button
                            ref={(el) => {
                              if (el) buttons.current.set(id, el);
                              else buttons.current.delete(id);
                            }}
                            type="button"
                            className="btn"
                            aria-label={m.hasSeat ? `Free seat from ${m.displayName}` : `Assign seat to ${m.displayName}`}
                            aria-disabled={busyRow === id ? true : undefined}
                            onClick={() => void changeSeat(m)}
                          >
                            {m.hasSeat ? "Free seat" : "Assign seat"}
                            {busyRow === id && <Pending />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {members !== null && !visible.length && <p className="muted">No designers match this view.</p>}
          </section>
          <section className="panel" aria-labelledby="offboard-title">
            <h2 className="section-title" id="offboard-title">
              Offboard a collaborator
            </h2>
            <form onSubmit={(e) => void offboard(e)} noValidate>
              <ErrorSummary errors={offboardForm.errors} shown={offboardForm.shown} targets={{ email: "collaborator-email" }} />
              <div className="field">
                <label className="field__label" htmlFor="collaborator-email">
                  Collaborator email
                </label>
                <input type="email" {...fieldAttrs("collaborator-email", offboardForm.errors.email)} value={collaborator} onChange={(e) => setCollaborator(e.target.value)} />
                <FieldError id="collaborator-email" message={offboardForm.errors.email} />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn" disabled={offboarding}>
                  Revoke all review links
                </button>
              </div>
            </form>
          </section>
        </div>

        <div className="admin__side">
          <section className="panel">
            <h2 className="section-title">Seat meter</h2>
            <div className="meter" role="group" aria-label="Seats">
              {meter && seatTag ? (
                <>
                  <p className="meter__count mono">
                    <RollingNumber value={meter.used} /> of <RollingNumber value={meter.cap} /> seats in use
                  </p>
                  <span className="meter__bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, (meter.used / Math.max(1, meter.cap)) * 100)}%` }} />
                  </span>
                  <SeatStateTag tag={seatTag} />
                </>
              ) : (
                <p className="meter__count mono">Loading seats</p>
              )}
            </div>
          </section>

          <section className="panel admin__plan" aria-labelledby="plan-title">
            <h2 className="section-title" id="plan-title">
              Plan
            </h2>
            {plan && (
              <>
                <PlanMark>Current plan: {plan.planName}</PlanMark>
                <p className="muted">
                  <span className="mono">${plan.monthlyPrice}</span> per month · <span className="mono">{plan.seatCap}</span> seats
                </p>
                {plan.upgrades.length ? (
                  <form onSubmit={(e) => void upgrade(e)} noValidate>
                    <ErrorSummary errors={upgradeForm.errors} shown={upgradeForm.shown} targets={{ plan: `plan-${firstUpgrade ?? ""}`, idempotencyKey: `plan-${firstUpgrade ?? ""}` }} />
                    <PlanChoices upgrades={plan.upgrades} choice={choice} invalid={Boolean(upgradeForm.errors.plan)} onChoose={setChoice} />
                    <FieldError id={`plan-${firstUpgrade ?? ""}`} message={upgradeForm.errors.plan ?? upgradeForm.errors.idempotencyKey} />
                    <div className="form-actions">
                      <button type="submit" className="btn btn--primary" disabled={upgrading}>
                        {upgrading ? (
                          <>
                            Upgrading <Pending />
                          </>
                        ) : (
                          "Upgrade plan"
                        )}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="muted">This workspace is on the largest plan.</p>
                )}
              </>
            )}
          </section>

          <section className="panel" aria-labelledby="invite-title">
            <h2 className="section-title" id="invite-title">
              Invite a designer
            </h2>
            <form onSubmit={(e) => void invite(e)} noValidate>
              <ErrorSummary errors={inviteForm.errors} shown={inviteForm.shown} targets={{ email: "invite-email", displayName: "invite-name" }} />
              <div className="field">
                <label className="field__label" htmlFor="invite-email">
                  Email
                </label>
                <input type="email" {...fieldAttrs("invite-email", inviteForm.errors.email)} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                <FieldError id="invite-email" message={inviteForm.errors.email} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="invite-name">
                  Display name
                </label>
                <input type="text" {...fieldAttrs("invite-name", inviteForm.errors.displayName)} value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
                <FieldError id="invite-name" message={inviteForm.errors.displayName} />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn--primary" disabled={inviting}>
                  Send invite
                </button>
              </div>
            </form>
          </section>

        </div>
      </div>
    </main>
  );
}

/**
 * The upgrade choices as an ARIA radio group whose radios are named by their own text (plan name and price),
 * so the only control labelled "Seats" on this screen is the seat meter. Arrow keys move and select.
 */
function PlanChoices({ upgrades, choice, invalid, onChoose }: { upgrades: Upgrade[]; choice: PlanId | null; invalid: boolean; onChoose: (plan: PlanId) => void }) {
  const refs = useRef(new Map<PlanId, HTMLDivElement>());
  const focusable = choice ?? upgrades[0]?.plan;
  const move = (index: number): void => {
    const next = upgrades[(index + upgrades.length) % upgrades.length];
    if (!next) return;
    onChoose(next.plan);
    refs.current.get(next.plan)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Plan" className="plan-options" aria-invalid={invalid ? true : undefined} aria-describedby={invalid ? `plan-${upgrades[0]?.plan ?? ""}-error` : undefined}>
      {upgrades.map((u, index) => (
        <div
          key={u.plan}
          ref={(el) => {
            if (el) refs.current.set(u.plan, el);
            else refs.current.delete(u.plan);
          }}
          id={`plan-${u.plan}`}
          role="radio"
          aria-checked={choice === u.plan}
          tabIndex={u.plan === focusable ? 0 : -1}
          className="plan-option"
          onClick={() => onChoose(u.plan)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              move(index + 1);
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
              e.preventDefault();
              move(index - 1);
            } else if (e.key === " ") {
              e.preventDefault();
              onChoose(u.plan);
            }
          }}
        >
          <span className="plan-option__dot" aria-hidden="true" />
          <span className="plan-option__name">{u.planName}</span>
          <span className="plan-option__price">
            <span className="mono">${u.monthlyPrice}</span> per month
          </span>
        </div>
      ))}
    </div>
  );
}
