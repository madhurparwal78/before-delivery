import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, apiGet, apiSend } from '../lib/api.js';
import { useQuery, useRouter } from '../lib/router.js';
import { adminCopy } from '../lib/copy.js';
import { TopBar } from '../components/TopBar.js';
import { LiveRegion, RollingCount, SeatStateTag } from '../components/Bits.js';
import { Icon } from '../components/Icon.js';
import { ErrorSummary, FieldError, fieldProps, noFormErrors, type FormErrors } from '../components/ErrorSummary.js';
import { NotFound } from './NotFound.js';
import type {
  OffboardResponse,
  PlanResponse,
  SeatMember,
  SeatMutationResponse,
  SeatsResponse,
  UpgradeResponse,
} from '../../shared/types.js';

type SeatFilter = 'all' | 'seated' | 'unseated';
type SeatSort = 'name' | 'seat';

function readFilter(value: string | null): SeatFilter {
  return value === 'seated' || value === 'unseated' ? value : 'all';
}

function readSort(value: string | null): SeatSort {
  return value === 'seat' ? 'seat' : 'name';
}

function sortMembers(members: readonly SeatMember[], sort: SeatSort): SeatMember[] {
  const byName = [...members].sort((left, right) =>
    left.displayName.toLowerCase().localeCompare(right.displayName.toLowerCase()),
  );
  if (sort === 'name') {
    return byName;
  }
  return [...byName].sort((left, right) => Number(right.hasSeat) - Number(left.hasSeat));
}

export function Admin({ slug }: { slug: string }): JSX.Element {
  const query = useQuery();
  const { navigate } = useRouter();
  const [seats, setSeats] = useState<SeatsResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [rows, setRows] = useState<SeatMember[]>([]);
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState(false);
  const [chosenPlan, setChosenPlan] = useState('');
  const [upgradePending, setUpgradePending] = useState(false);
  const [planErrors, setPlanErrors] = useState<FormErrors>(noFormErrors);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteErrors, setInviteErrors] = useState<FormErrors>(noFormErrors);
  const [invitePending, setInvitePending] = useState(false);

  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [offboardErrors, setOffboardErrors] = useState<FormErrors>(noFormErrors);
  const [offboardPending, setOffboardPending] = useState(false);

  const filter = readFilter(query.get('seat'));
  const sort = readSort(query.get('sort'));
  const focusAfter = useRef<{ memberId: string; want: 'assign' | 'free' } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const loadedSeats = await apiGet<SeatsResponse>(`/api/workspaces/${slug}/seats`);
    setSeats(loadedSeats);
    setRows(loadedSeats.members);
    setPlan(await apiGet<PlanResponse>(`/api/workspaces/${slug}/plan`));
  }, [slug]);

  useEffect(() => {
    void load().catch(() => setMissing(true));
  }, [load]);

  useEffect(() => {
    const wanted = focusAfter.current;
    if (wanted === null) {
      return;
    }
    focusAfter.current = null;
    const label = wanted.want === 'free' ? 'Free seat from' : 'Assign seat to';
    const member = rows.find((row) => row.id === wanted.memberId);
    if (member === undefined) {
      return;
    }
    const button = document.querySelector<HTMLButtonElement>(
      `[aria-label="${label} ${member.displayName}"]`,
    );
    button?.focus();
  }, [rows]);

  if (missing) {
    return <NotFound />;
  }
  if (seats === null || plan === null) {
    return (
      <>
        <TopBar workspaceSlug={slug} />
        <div className="page" />
      </>
    );
  }

  const used = rows.filter((row) => row.hasSeat).length;
  const cap = seats.seatCap;

  const writeView = (nextFilter: SeatFilter, nextSort: SeatSort): void => {
    const params = new URLSearchParams();
    if (nextFilter !== 'all') {
      params.set('seat', nextFilter);
    }
    if (nextSort !== 'name') {
      params.set('sort', nextSort);
    }
    const search = params.toString();
    navigate(`/w/${slug}/admin${search === '' ? '' : `?${search}`}`);
  };

  const changeSeat = async (member: SeatMember, assign: boolean): Promise<void> => {
    const before = rows;
    setRows((current) =>
      current.map((row) => (row.id === member.id ? { ...row, hasSeat: assign } : row)),
    );
    try {
      const response = assign
        ? await apiSend<SeatMutationResponse>('POST', `/api/workspaces/${slug}/seats`, { memberId: member.id })
        : await apiSend<SeatMutationResponse>('DELETE', `/api/workspaces/${slug}/seats/${member.id}`);
      setSeats((current) => (current === null ? current : { ...current, seatCap: response.seatCap }));
      focusAfter.current = { memberId: member.id, want: assign ? 'free' : 'assign' };
      setMessage(
        assign
          ? adminCopy.seatAssigned(member.displayName, response.seatsUsed, response.seatCap)
          : adminCopy.seatFreed(member.displayName, response.seatsUsed, response.seatCap),
      );
      await load();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'no_seats_left') {
        setMessage(adminCopy.noSeatsLeft());
        focusAfter.current = { memberId: member.id, want: 'assign' };
        await load().catch(() => setRows(before));
        return;
      }
      setRows(before);
      setMessage(adminCopy.seatFailed(before.filter((row) => row.hasSeat).length, cap));
    }
  };

  const upgrade = async (): Promise<void> => {
    if (chosenPlan === '') {
      setPlanErrors({ fields: { plan: 'Choose a plan to upgrade to.' }, token: Date.now() });
      return;
    }
    setUpgradePending(true);
    setMessage(adminCopy.upgradePending());
    try {
      const response = await apiSend<UpgradeResponse>(
        'POST',
        `/api/workspaces/${slug}/plan`,
        { plan: chosenPlan },
        { 'Idempotency-Key': crypto.randomUUID() },
      );
      setPlanErrors(noFormErrors);
      setMessage(adminCopy.upgraded(response.planName, response.seatCap, response.receiptSentTo));
      await load();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'validation') {
        setPlanErrors({ fields: error.fieldErrors, token: Date.now() });
      } else if (error instanceof ApiFailure && error.code === 'mail_unavailable') {
        setMessage(adminCopy.upgradeMailDown());
      } else if (error instanceof ApiFailure && error.code === 'billing_unavailable') {
        setMessage(adminCopy.upgradeBillingDown());
      } else if (error instanceof ApiFailure && error.code === 'idempotency_in_progress') {
        setMessage(adminCopy.upgradeInProgress());
      } else {
        setMessage(adminCopy.upgradeBillingDown());
      }
    } finally {
      setUpgradePending(false);
    }
  };

  const sendInvite = async (): Promise<void> => {
    setInvitePending(true);
    try {
      await apiSend('POST', `/api/workspaces/${slug}/invites`, { email: inviteEmail, displayName: inviteName });
      setInviteErrors(noFormErrors);
      setMessage(adminCopy.inviteSent(inviteEmail));
      setInviteEmail('');
      setInviteName('');
      await load();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'validation') {
        setInviteErrors({ fields: error.fieldErrors, token: Date.now() });
      } else {
        setMessage(adminCopy.inviteMailDown());
      }
    } finally {
      setInvitePending(false);
    }
  };

  const offboard = async (): Promise<void> => {
    setOffboardPending(true);
    try {
      const response = await apiSend<OffboardResponse>('POST', `/api/workspaces/${slug}/collaborators/offboard`, {
        email: collaboratorEmail,
      });
      setOffboardErrors(noFormErrors);
      setMessage(adminCopy.offboarded(response.revoked, response.email));
      setCollaboratorEmail('');
    } catch (error) {
      setOffboardErrors({
        fields: error instanceof ApiFailure ? error.fieldErrors : {},
        token: Date.now(),
      });
    } finally {
      setOffboardPending(false);
    }
  };

  const visibleRows = sortMembers(
    rows.filter((row) => (filter === 'all' ? true : filter === 'seated' ? row.hasSeat : !row.hasSeat)),
    sort,
  );

  return (
    <>
      <TopBar workspaceSlug={slug} />
      <div className="page">
        <h1>Seats and plan</h1>
        <div className="seat-meter" aria-label="Seats">
          <span>
            <RollingCount value={used} /> of <RollingCount value={cap} /> seats in use
          </span>
          <SeatStateTag used={used} cap={cap} />
        </div>
        <LiveRegion name="Admin status" message={message} />

        <div className="split admin">
          <div className="roster-column">
            <section className="panel">
              <h2>Members</h2>
              <fieldset role="radiogroup" aria-label="Show members">
                <legend>Show members</legend>
                {(['all', 'seated', 'unseated'] as SeatFilter[]).map((option) => (
                  <div className="radiorow" key={option}>
                    <input
                      type="radio"
                      id={`filter-${option}`}
                      name="seat-filter"
                      checked={filter === option}
                      onChange={() => writeView(option, sort)}
                    />
                    <label htmlFor={`filter-${option}`}>
                      {option === 'all' ? 'All' : option === 'seated' ? 'Seated' : 'Without seat'}
                    </label>
                  </div>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="sort-members">Sort members</label>
                <select
                  id="sort-members"
                  value={sort}
                  onChange={(event) => writeView(filter, readSort(event.target.value))}
                >
                  <option value="name">Name</option>
                  <option value="seat">Seat</option>
                </select>
              </div>
              <div className="table-scroll">
                <table aria-label="Members">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Email</th>
                      <th scope="col">Handle</th>
                      <th scope="col">Seat</th>
                    </tr>
                  </thead>
                  <tbody>
                  {visibleRows.map((member) => (
                    <tr key={member.id}>
                      <td>{member.displayName}</td>
                      <td className="mono">{member.email}</td>
                      <td className="mono">@{member.handle}</td>
                      <td>
                        {member.hasSeat ? (
                          <button
                            type="button"
                            aria-label={`Free seat from ${member.displayName}`}
                            onClick={() => void changeSeat(member, false)}
                          >
                            Free seat
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Assign seat to ${member.displayName}`}
                            onClick={() => void changeSeat(member, true)}
                          >
                            Assign seat
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div>
            <section className="panel">
              <h2>Plan</h2>
              <p>
                <span className="tag">
                  <Icon name="check" />
                  {`Current plan: ${plan.planName}`}
                </span>
              </p>
              <ErrorSummary formName="plan" errors={planErrors} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void upgrade();
                }}
              >
                <fieldset role="radiogroup" aria-label="Plan">
                  <legend>Plan</legend>
                  {plan.upgrades.map((option, index) => (
                    <div className="plan-option" key={option.plan}>
                      <input
                        type="radio"
                        name="plan"
                        value={option.plan}
                        checked={chosenPlan === option.plan}
                        onChange={() => setChosenPlan(option.plan)}
                        {...(index === 0 ? fieldProps('plan', 'plan', planErrors) : { id: `plan-${option.plan}` })}
                      />
                      <label htmlFor={index === 0 ? 'plan-plan' : `plan-${option.plan}`}>
                        {option.planName} <span className="price">${option.monthlyPrice}</span> per month
                      </label>
                    </div>
                  ))}
                </fieldset>
                <FieldError formName="plan" field="plan" errors={planErrors} />
                <button type="submit" disabled={upgradePending || plan.upgrades.length === 0}>
                  Upgrade plan
                </button>
              </form>
            </section>

            <section className="panel">
              <h2>Invite a designer</h2>
              <ErrorSummary formName="invite" errors={inviteErrors} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendInvite();
                }}
              >
                <div className="field">
                  <label htmlFor="invite-email">Email</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    {...fieldProps('invite', 'email', inviteErrors)}
                  />
                  <FieldError formName="invite" field="email" errors={inviteErrors} />
                </div>
                <div className="field">
                  <label htmlFor="invite-displayName">Display name</label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(event) => setInviteName(event.target.value)}
                    {...fieldProps('invite', 'displayName', inviteErrors)}
                  />
                  <FieldError formName="invite" field="displayName" errors={inviteErrors} />
                </div>
                <button type="submit" disabled={invitePending}>
                  Send invite
                </button>
              </form>
            </section>

            <section className="panel">
              <h2>Offboard a collaborator</h2>
              <ErrorSummary formName="offboard" errors={offboardErrors} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void offboard();
                }}
              >
                <div className="field">
                  <label htmlFor="offboard-email">Collaborator email</label>
                  <input
                    type="email"
                    value={collaboratorEmail}
                    onChange={(event) => setCollaboratorEmail(event.target.value)}
                    {...fieldProps('offboard', 'email', offboardErrors)}
                  />
                  <FieldError formName="offboard" field="email" errors={offboardErrors} />
                </div>
                <button type="submit" disabled={offboardPending}>
                  Revoke all review links
                </button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
