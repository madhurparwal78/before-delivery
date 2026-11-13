import { useEffect, useRef, useState } from 'react';
import { api } from '../app/api';
import {
  Link,
  Problems,
  focusProblems,
  useAnnounce,
  useFieldErrors,
  useLive,
  useRouter,
  useServerDate,
  useSession,
} from '../app/shell';
import { Overlay } from '../components/overlays';
import {
  BottomBar,
  Card,
  DialogMessage,
  RadioGroup,
  SelectField,
  TableFrame,
  TextField,
} from '../components/pieces';
import { BookDrawDialog } from '../components/bookDraw';
import {
  DrawView,
  MARKERS,
  MemberView,
  MessageView,
  PreviewRow,
  RangeChangeView,
  ReceiptListItem,
  StaffView,
  ThreadView,
  accountStateLabel,
  ageBandLabel,
  copy,
  displayDate,
  displayDateOfInstant,
  drawStateLabel,
  formatMoney,
  localTime,
  membershipStateLabel,
  PRACTICE_ZONE,
  roleLabel,
  STATES,
  twoTimeForm,
  visitPageStateLabel,
} from '../app/types';

function drawTimeLine(draw: DrawView): string {
  return twoTimeForm(
    displayDate(draw.localDate),
    localTime(new Date(draw.startsAt), PRACTICE_ZONE),
    draw.localTime,
    draw.timeZone,
  );
}

export function useMembers(): MemberView[] {
  const { data } = useLive<MemberView[]>(async () => {
    const result = await api<{ members: MemberView[] }>('/api/members');
    return result.data?.members ?? null;
  });
  return data ?? [];
}

export function StaffMembersScreen(): JSX.Element {
  const members = useMembers();
  const { user } = useSession();
  const { announce } = useAnnounce();
  const errors = useFieldErrors();
  const [addOpen, setAddOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    dateOfBirth: '',
    sex: 'female',
    state: 'co',
    timeZone: 'denver',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    postalCode: '',
    gateNotes: '',
    cadence: '',
  });
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api<{ member: MemberView }>('/api/members', {
      method: 'POST',
      json: {
        name: form.name,
        email: form.email,
        password: form.password,
        dateOfBirth: form.dateOfBirth,
        sex: form.sex,
        state: form.state,
        timeZone: form.timeZone,
        phone: form.phone,
        address: {
          line1: form.line1,
          line2: form.line2,
          city: form.city,
          postalCode: form.postalCode,
        },
        gateNotes: form.gateNotes,
        cadence: form.cadence === '' ? null : form.cadence,
      },
    });
    setBusy(false);
    if (result.error) {
      errors.show(result.error);
      announce(result.error.message);
      return;
    }
    errors.clear();
    announce('Member added.');
    setAddOpen(false);
  };

  return (
    <>
      <h1 tabIndex={-1}>Members</h1>
      <Problems fields={errors.fields} message={errors.message} />
      <Card>
        <TableFrame name="Members table">
          <table>
            <caption>Members</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Membership</th>
                <th scope="col">Account</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <Link to={`/staff/members/${member.id}`}>{member.name}</Link>
                  </td>
                  <td>{membershipStateLabel[member.membership.state]}</td>
                  <td>{accountStateLabel[member.accountState]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Card>
      <Overlay name="Add member" open={addOpen} onClose={() => setAddOpen(false)} opener={addButton}>
        <h2>Add member</h2>
        <DialogMessage text={errors.message} />
        <TextField label="Full name" name="name" value={form.name} error={errors.fields.name} onChange={(value) => setForm({ ...form, name: value })} />
        <TextField label="Email" name="email" type="email" value={form.email} error={errors.fields.email} onChange={(value) => setForm({ ...form, email: value })} />
        <TextField label="Password" name="password" type="password" value={form.password} error={errors.fields.password} onChange={(value) => setForm({ ...form, password: value })} />
        <TextField label="Date of birth" name="dateOfBirth" value={form.dateOfBirth} error={errors.fields.dateOfBirth} onChange={(value) => setForm({ ...form, dateOfBirth: value })} />
        <RadioGroup
          label="Sex"
          name="member-sex"
          value={form.sex}
          onChange={(value) => setForm({ ...form, sex: value })}
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
        />
        <SelectField
          label="Home state"
          name="state"
          value={form.state}
          error={errors.fields.state}
          onChange={(value) => setForm({ ...form, state: value })}
          options={STATES.map((entry) => ({ value: entry.state, label: entry.name }))}
        />
        <SelectField
          label="Local time"
          name="timeZone"
          value={form.timeZone}
          onChange={(value) => setForm({ ...form, timeZone: value })}
          options={[
            { value: 'newYork', label: 'New York time' },
            { value: 'chicago', label: 'Chicago time' },
            { value: 'denver', label: 'Denver time' },
            { value: 'phoenix', label: 'Phoenix time' },
            { value: 'losAngeles', label: 'Los Angeles time' },
          ]}
        />
        <TextField label="Phone" name="phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
        <TextField label="Address line 1" name="line1" value={form.line1} error={errors.fields['address.line1']} onChange={(value) => setForm({ ...form, line1: value })} />
        <TextField label="Address line 2" name="line2" value={form.line2} onChange={(value) => setForm({ ...form, line2: value })} />
        <TextField label="City" name="city" value={form.city} error={errors.fields['address.city']} onChange={(value) => setForm({ ...form, city: value })} />
        <TextField label="ZIP code" name="postalCode" value={form.postalCode} error={errors.fields.postalCode} onChange={(value) => setForm({ ...form, postalCode: value })} />
        <TextField label="Gate notes" name="gateNotes" value={form.gateNotes} onChange={(value) => setForm({ ...form, gateNotes: value })} />
        <SelectField
          label="Billing cadence"
          name="cadence"
          value={form.cadence}
          onChange={(value) => setForm({ ...form, cadence: value })}
          options={[
            { value: '', label: 'Free' },
            { value: 'sixMonths', label: 'Every 6 months' },
            { value: 'yearly', label: 'Yearly' },
          ]}
        />
        <button type="button" disabled={busy} onClick={() => void save()}>
          Save member
        </button>
      </Overlay>
      {user?.role === 'owner' ? (
        <BottomBar>
          <button type="button" ref={addButton} onClick={() => setAddOpen(true)}>
            Add member
          </button>
        </BottomBar>
      ) : null}
    </>
  );
}

export function StaffMemberScreen({ memberId }: { memberId: string }): JSX.Element {
  const { user } = useSession();
  const { announce } = useAnnounce();
  const { navigate } = useRouter();
  const [bookOpen, setBookOpen] = useState(false);
  const bookButton = useRef<HTMLButtonElement | null>(null);
  const { data: member, reload } = useLive<MemberView>(async () => {
    const result = await api<{ member: MemberView }>(`/api/members/${memberId}`);
    return result.data?.member ?? null;
  }, [memberId]);
  const { data: draws } = useLive<DrawView[]>(async () => {
    const result = await api<{ draws: DrawView[] }>(`/api/draws?memberId=${memberId}`);
    return result.data?.draws ?? null;
  }, [memberId]);

  const restore = async (): Promise<void> => {
    announce(copy.working);
    const result = await api<{ member: MemberView }>(`/api/members/${memberId}/restore`, {
      method: 'POST',
      json: {},
    });
    if (result.error) {
      announce(result.error.message);
      return;
    }
    announce(copy.accountRestored(result.data?.member.name ?? ''));
    reload();
  };

  const role = user?.role ?? 'owner';
  return (
    <>
      <h1 tabIndex={-1}>{member?.name ?? ''}</h1>
      <Card>
        <h2>Details</h2>
        <p>{member?.email}</p>
        <p>{member?.phone}</p>
        {member?.address ? (
          <p>
            {member.address.line1}
            {member.address.line2 === '' ? '' : `, ${member.address.line2}`}, {member.address.city}{' '}
            {member.address.postalCode}
          </p>
        ) : null}
        <p>Account: {member ? accountStateLabel[member.accountState] : ''}</p>
        <p>Membership: {member ? membershipStateLabel[member.membership.state] : ''}</p>
        {role === 'owner' && member?.accountState === 'closing' ? (
          <button type="button" className="quiet" onClick={() => void restore()}>
            Bring back account
          </button>
        ) : null}
      </Card>
      <Card>
        <h2>Draws</h2>
        <ul className="log">
          {(draws ?? []).map((draw) => (
            <li key={draw.id}>
              <Link to={`/staff/draws/${draw.id}`}>
                {drawTimeLine(draw)} · {drawStateLabel[draw.state]}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2>Results, plan, blend and messages</h2>
        <ul>
          <li>
            <Link to={`/staff/members/${memberId}/results`}>Results</Link>
          </li>
          {role === 'owner' || role === 'specialist' ? (
            <>
              <li>
                <Link to={`/staff/members/${memberId}/plan`}>Plan</Link>
              </li>
              <li>
                <Link to={`/staff/members/${memberId}/blend`}>Blend</Link>
              </li>
            </>
          ) : null}
          <li>
            <Link to={`/staff/members/${memberId}/messages`}>Messages</Link>
          </li>
        </ul>
      </Card>
      {member ? (
        <BookDrawDialog
          name="Book draw"
          open={bookOpen}
          onClose={() => setBookOpen(false)}
          opener={bookButton}
          asStaff
          members={[]}
          member={member}
          onDone={(draw) => {
            setBookOpen(false);
            navigate(`/staff/draws/${draw.id}`);
          }}
        />
      ) : null}
      {role === 'owner' || role === 'coordinator' ? (
        <BottomBar>
          <button type="button" ref={bookButton} onClick={() => setBookOpen(true)}>
            Book draw
          </button>
        </BottomBar>
      ) : null}
    </>
  );
}

export function StaffCalendarScreen(): JSX.Element {
  const members = useMembers();
  const { navigate } = useRouter();
  const [dayOffset, setDayOffset] = useState(0);
  const [weekView, setWeekView] = useState(
    () => window.matchMedia('(min-width: 1100px)').matches,
  );
  const [bookOpen, setBookOpen] = useState(false);
  const [pickedMember, setPickedMember] = useState<string>('');
  const bookButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1100px)');
    const onChange = (): void => setWeekView(wide.matches);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  const serverNow = useServerDate();
  const today = serverNow ? isoPhoenixDate(serverNow.toISOString()) : null;
  const chosen = today ? shiftDate(today, dayOffset) : null;
  const days = chosen ? (weekView ? weekFrom(chosen) : [chosen]) : [];
  const from = days[0] ?? null;
  const to = days.length > 0 ? (days[days.length - 1] as string) : null;

  const { data: draws } = useLive<DrawView[]>(async () => {
    if (!from || !to) return null;
    const result = await api<{ draws: DrawView[] }>(`/api/draws?from=${from}&to=${to}`);
    return result.data?.draws ?? null;
  }, [from, to]);

  return (
    <>
      <h1 tabIndex={-1}>Draw calendar</h1>
      <Card>
        <div className="radio-row">
          {weekView ? (
            <>
              <button type="button" className="quiet" onClick={() => setDayOffset(dayOffset - 7)}>
                Previous week
              </button>
              <button type="button" className="quiet" onClick={() => setDayOffset(dayOffset + 7)}>
                Next week
              </button>
            </>
          ) : (
            <>
              <button type="button" className="quiet" onClick={() => setDayOffset(dayOffset - 1)}>
                Previous day
              </button>
              <button type="button" className="quiet" onClick={() => setDayOffset(dayOffset + 1)}>
                Next day
              </button>
            </>
          )}
        </div>
      </Card>
      <div className="week">
        {days.map((day) => (
          <div className="day" key={day}>
            <h2>{displayDate(day)}</h2>
            <ul>
              {(draws ?? [])
                .filter((draw) => day === isoPhoenixDate(draw.startsAt))
                .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
                .map((draw) => (
                  <li key={draw.id}>
                    <Link to={`/staff/draws/${draw.id}`}>{drawTimeLine(draw)}</Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <BookDrawDialog
        name="Book draw"
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        opener={bookButton}
        asStaff
        members={members}
        member={members.find((entry) => entry.id === pickedMember) ?? null}
        onPickMember={setPickedMember}
        onDone={(draw) => {
          setBookOpen(false);
          navigate(`/staff/draws/${draw.id}`);
        }}
      />
      <BottomBar>
        <button type="button" ref={bookButton} onClick={() => setBookOpen(true)}>
          Book draw
        </button>
      </BottomBar>
    </>
  );
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return moved.toISOString().slice(0, 10);
}

/** Monday to Saturday of the week holding the given Phoenix date. */
function weekFrom(date: string): string[] {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const backToMonday = weekday === 0 ? -6 : 1 - weekday;
  const monday = shiftDate(date, backToMonday);
  return Array.from({ length: 6 }, (_, index) => shiftDate(monday, index));
}

function isoPhoenixDate(instant: string): string {
  const date = new Date(instant);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts;
}

export function StaffDrawScreen({ drawId }: { drawId: string }): JSX.Element {
  const { user } = useSession();
  const { announce } = useAnnounce();
  const [intakeOpen, setIntakeOpen] = useState(false);
  const intakeButton = useRef<HTMLButtonElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const reportRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [dialogMessage, setDialogMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data: draw, reload } = useLive<DrawView>(async () => {
    const result = await api<{ draw: DrawView }>(`/api/draws/${drawId}`);
    return result.data?.draw ?? null;
  }, [drawId]);

  const preview = async (): Promise<void> => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    announce(copy.working);
    const form = new FormData();
    form.append('file', file);
    const result = await api<{ rows: PreviewRow[] }>(
      `/api/draws/${drawId}/results-file/preview`,
      { method: 'POST', form },
    );
    setBusy(false);
    if (result.error) {
      setFields(result.error.fields ?? {});
      setDialogMessage(result.error.fields ? null : result.error.message);
      announce(result.error.message);
      return;
    }
    const list = result.data?.rows ?? [];
    setRows(list);
    setFields({});
    setDialogMessage(null);
    announce(
      copy.previewSummary(
        list.filter((row) => row.status === 'matched').length,
        list.filter((row) => row.status === 'unknown').length,
        list.filter((row) => row.status === 'refused').length,
      ),
    );
  };

  const save = async (): Promise<void> => {
    const file = fileRef.current?.files?.[0];
    const report = reportRef.current?.files?.[0];
    setBusy(true);
    announce(copy.working);
    const form = new FormData();
    if (file) form.append('file', file);
    if (report) form.append('report', report);
    const result = await api<{ draw: DrawView }>(`/api/draws/${drawId}/results-file`, {
      method: 'POST',
      form,
    });
    setBusy(false);
    if (result.error) {
      setFields(result.error.fields ?? {});
      setDialogMessage(result.error.fields ? null : result.error.message);
      announce(result.error.message);
      return;
    }
    setFields({});
    setDialogMessage(null);
    announce(copy.resultsSaved);
    setIntakeOpen(false);
    reload();
  };

  const release = async (): Promise<void> => {
    announce(copy.working);
    const result = await api<{ draw: DrawView }>(`/api/draws/${drawId}/release`, {
      method: 'POST',
      json: {},
    });
    if (result.error) {
      announce(result.error.message);
      return;
    }
    const firstName = (draw?.memberName ?? '').split(' ')[0] ?? '';
    announce(copy.resultsReleased(firstName));
    reload();
  };

  const sendVisitPage = async (): Promise<void> => {
    announce(copy.working);
    const result = await api(`/api/draws/${drawId}/visit-page`, { method: 'POST', json: {} });
    if (result.error) {
      announce(result.error.message);
      return;
    }
    announce(copy.visitPageSent(draw?.phlebotomistName ?? ''));
    reload();
  };

  const endVisitPage = async (): Promise<void> => {
    announce(copy.working);
    const result = await api(`/api/draws/${drawId}/visit-page`, { method: 'DELETE' });
    if (result.error) {
      announce(result.error.message);
      return;
    }
    announce(copy.visitPageEndedByStaff);
    reload();
  };

  const role = user?.role ?? 'owner';
  const mainAction = ((): JSX.Element | null => {
    if (!draw) return null;
    if (draw.state === 'collected') {
      return (
        <button type="button" ref={intakeButton} onClick={() => setIntakeOpen(true)}>
          Bring in results
        </button>
      );
    }
    if (draw.state === 'ready' && (role === 'owner' || role === 'specialist')) {
      return (
        <button type="button" onClick={() => void release()}>
          Release results
        </button>
      );
    }
    if (draw.state === 'booked') {
      return (
        <button type="button" onClick={() => void sendVisitPage()}>
          Send new visit page
        </button>
      );
    }
    return null;
  })();

  return (
    <>
      <h1 tabIndex={-1}>
        Draw for {draw?.memberName ?? ''} on {draw ? displayDate(draw.localDate) : ''}
      </h1>
      <Card>
        {draw ? (
          <>
            <p>{drawTimeLine(draw)}</p>
            <p>
              {draw.phlebotomistName} · {drawStateLabel[draw.state]}
            </p>
            <p>Visit page: {visitPageStateLabel[draw.visitPage.state]}</p>
            {draw.kitCodes.length > 0 ? (
              <ul className="kit-list">
                {draw.kitCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
            ) : null}
            <div className="radio-row">
              {draw.visitPage.state === 'live' ? (
                <button type="button" className="quiet" onClick={() => void endVisitPage()}>
                  End visit page
                </button>
              ) : null}
              {draw.state === 'booked' ? (
                <button type="button" className="quiet" onClick={() => void sendVisitPage()}>
                  Send new visit page
                </button>
              ) : null}
              {draw.state === 'ready' && (role === 'owner' || role === 'specialist') ? (
                <button type="button" className="quiet" onClick={() => void release()}>
                  Release results
                </button>
              ) : null}
              {draw.state === 'collected' || draw.state === 'ready' ? (
                <button type="button" className="quiet" onClick={() => setIntakeOpen(true)}>
                  Bring in results
                </button>
              ) : null}
            </div>
            <p>
              <Link to={`/staff/members/${draw.memberId}`}>Back to member</Link>
            </p>
          </>
        ) : null}
      </Card>
      <Overlay
        name="Bring in results"
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        opener={intakeButton}
      >
        <h2>Bring in results</h2>
        <DialogMessage text={dialogMessage} />
        <div className="field">
          <label htmlFor="field-results-file">Results file</label>
          <input id="field-results-file" type="file" aria-label="Results file" ref={fileRef} />
          {fields.file ? <p className="field-error">{fields.file}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="field-report">Report PDF</label>
          <input id="field-report" type="file" aria-label="Report PDF" ref={reportRef} />
          {fields.report ? <p className="field-error">{fields.report}</p> : null}
        </div>
        <button type="button" className="quiet" disabled={busy} onClick={() => void preview()}>
          Preview
        </button>
        {rows ? (
          <div className="table-frame" role="region" aria-label="Preview rows" tabIndex={0}>
            <table>
              <caption>Preview</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Kit code</th>
                  <th scope="col">Marker</th>
                  <th scope="col">Value</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.kitCode ?? ''}</td>
                    <td>
                      {row.marker
                        ? MARKERS.find((marker) => marker.id === row.marker)?.name ?? row.marker
                        : row.source?.marker ?? ''}
                    </td>
                    <td>{row.value ?? row.source?.value ?? ''}</td>
                    <td>{row.unit ?? row.source?.unit ?? ''}</td>
                    <td>{row.status}</td>
                    <td>{row.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <button type="button" disabled={busy} onClick={() => void save()}>
          Save results
        </button>
      </Overlay>
      <BottomBar>{mainAction}</BottomBar>
    </>
  );
}

export function StaffResultsToReleaseScreen(): JSX.Element {
  const { data: draws } = useLive<DrawView[]>(async () => {
    const result = await api<{ draws: DrawView[] }>('/api/draws?state=ready');
    return result.data?.draws ?? null;
  });
  const next = (draws ?? [])[0];
  return (
    <>
      <h1 tabIndex={-1}>Results to release</h1>
      <Card>
        <ul className="log">
          {(draws ?? []).map((draw) => (
            <li key={draw.id}>
              <Link to={`/staff/draws/${draw.id}`}>
                {draw.memberName} · {drawTimeLine(draw)}
              </Link>
            </li>
          ))}
        </ul>
        {draws && draws.length === 0 ? <p className="muted">Nothing is waiting.</p> : null}
      </Card>
      <BottomBar>
        <Link to={next ? `/staff/draws/${next.id}` : '/staff/results'} className="button">
          Open next draw
        </Link>
      </BottomBar>
    </>
  );
}

export function StaffRangesScreen(): JSX.Element {
  const { announce } = useAnnounce();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const [marker, setMarker] = useState('ldl');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [rows, setRows] = useState(() =>
    (['female', 'male'] as const).flatMap((sex) =>
      (['age18To39', 'age40To59', 'age60Plus'] as const).map((ageBand) => ({
        sex,
        ageBand,
        low: '',
        high: '',
        optimalLow: '',
        optimalHigh: '',
      })),
    ),
  );
  const [dialogMessage, setDialogMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: changes, reload } = useLive<RangeChangeView[]>(async () => {
    const result = await api<{ changes: RangeChangeView[] }>('/api/range-changes');
    return result.data?.changes ?? null;
  });

  const save = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api('/api/range-changes', {
      method: 'POST',
      json: { marker, effectiveFrom, ranges: rows },
    });
    setBusy(false);
    if (result.error) {
      setDialogMessage(result.error.message);
      announce(result.error.message);
      return;
    }
    const markerName = MARKERS.find((entry) => entry.id === marker)?.name ?? marker;
    announce(copy.rangesSaved(markerName, displayDate(effectiveFrom)));
    setOpen(false);
    reload();
  };

  return (
    <>
      <h1 tabIndex={-1}>Range table</h1>
      <Card>
        <TableFrame name="Range changes table">
          <table>
            <caption>Range changes</caption>
            <thead>
              <tr>
                <th scope="col">Marker</th>
                <th scope="col">Takes effect</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {(changes ?? []).map((change) => (
                <tr key={change.id}>
                  <td>{MARKERS.find((entry) => entry.id === change.marker)?.name ?? change.marker}</td>
                  <td>{displayDate(change.effectiveFrom)}</td>
                  <td>{change.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Card>
      <Overlay name="Change ranges" open={open} onClose={() => setOpen(false)} opener={button}>
        <h2>Change ranges</h2>
        <DialogMessage text={dialogMessage} />
        <SelectField
          label="Marker"
          name="marker"
          value={marker}
          onChange={setMarker}
          options={MARKERS.map((entry) => ({ value: entry.id, label: entry.name }))}
        />
        <TextField
          label="Takes effect on"
          name="effectiveFrom"
          value={effectiveFrom}
          onChange={setEffectiveFrom}
        />
        {rows.map((row, index) => {
          const label = `${row.sex === 'female' ? 'Female' : 'Male'} ${ageBandLabel[row.ageBand]}`;
          const update = (key: 'low' | 'high' | 'optimalLow' | 'optimalHigh', value: string): void =>
            setRows(rows.map((entry, entryIndex) => (entryIndex === index ? { ...entry, [key]: value } : entry)));
          return (
            <div key={`${row.sex}-${row.ageBand}`}>
              <TextField label={`Low, ${label}`} name={`low-${index}`} value={row.low} onChange={(value) => update('low', value)} />
              <TextField label={`High, ${label}`} name={`high-${index}`} value={row.high} onChange={(value) => update('high', value)} />
              <TextField label={`Optimal low, ${label}`} name={`optimalLow-${index}`} value={row.optimalLow} onChange={(value) => update('optimalLow', value)} />
              <TextField label={`Optimal high, ${label}`} name={`optimalHigh-${index}`} value={row.optimalHigh} onChange={(value) => update('optimalHigh', value)} />
            </div>
          );
        })}
        <button type="button" disabled={busy} onClick={() => void save()}>
          Save ranges
        </button>
      </Overlay>
      <BottomBar>
        <button type="button" ref={button} onClick={() => setOpen(true)}>
          Change ranges
        </button>
      </BottomBar>
    </>
  );
}

export function StaffReceiptsScreen(): JSX.Element {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [typed, setTyped] = useState(month);
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { data } = useLive<{ receipts: ReceiptListItem[]; nextCursor: string | null }>(async () => {
    const result = await api<{ receipts: ReceiptListItem[]; nextCursor: string | null }>(
      `/api/receipts?month=${month}${cursor ? `&cursor=${cursor}` : ''}`,
    );
    if (result.error) {
      setProblem(result.error.fields?.month ?? result.error.message);
      return null;
    }
    setProblem(null);
    return result.data;
  }, [month, cursor]);

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(typed) && typed !== month) {
      setMonth(typed);
      setCursor(null);
    }
  }, [typed, month]);

  return (
    <>
      <h1 tabIndex={-1}>Receipts</h1>
      <Problems message={problem} />
      <Card>
        <TextField label="Month" name="month" value={typed} onChange={setTyped} />
        <TableFrame name="Receipts table">
          <table>
            <caption>Receipts</caption>
            <thead>
              <tr>
                <th scope="col">Receipt</th>
                <th scope="col">Member</th>
                <th scope="col">Paid</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(data?.receipts ?? []).map((receipt) => (
                <tr key={receipt.id}>
                  <td>
                    <Link to={`/receipts/${receipt.id}`}>{receipt.number}</Link>
                  </td>
                  <td>{receipt.memberName}</td>
                  <td>{displayDate(receipt.paidDate)}</td>
                  <td>{formatMoney(receipt.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Card>
      <BottomBar>
        <button
          type="button"
          onClick={() => {
            if (data?.nextCursor) setCursor(data.nextCursor);
          }}
        >
          Next page
        </button>
      </BottomBar>
    </>
  );
}

export function StaffTeamScreen(): JSX.Element {
  const { announce } = useAnnounce();
  const errors = useFieldErrors();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'coordinator' });
  const [busy, setBusy] = useState(false);
  const { data: staff, reload } = useLive<StaffView[]>(async () => {
    const result = await api<{ staff: StaffView[] }>('/api/staff');
    return result.data?.staff ?? null;
  });

  const add = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api('/api/staff', { method: 'POST', json: form });
    setBusy(false);
    if (result.error) {
      errors.show(result.error);
      announce(result.error.message);
      return;
    }
    errors.clear();
    announce('Staff member added.');
    setOpen(false);
    reload();
  };

  const remove = async (id: string): Promise<void> => {
    announce(copy.working);
    const result = await api(`/api/staff/${id}`, { method: 'DELETE' });
    if (result.error) {
      announce(result.error.message);
      return;
    }
    announce('Staff member removed.');
    reload();
  };

  const reRole = async (id: string, role: string): Promise<void> => {
    announce(copy.working);
    const result = await api(`/api/staff/${id}`, { method: 'PATCH', json: { role } });
    if (result.error) {
      announce(result.error.message);
      return;
    }
    announce('Role changed.');
    reload();
  };

  return (
    <>
      <h1 tabIndex={-1}>Team</h1>
      <Problems fields={errors.fields} message={errors.message} />
      <Card>
        <TableFrame name="Team table">
          <table>
            <caption>Team</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {(staff ?? []).map((member) => (
                <tr key={member.id}>
                  <td>{member.name}</td>
                  <td>{member.email}</td>
                  <td>{roleLabel[member.role]}</td>
                  <td>
                    {member.role === 'owner' ? null : (
                      <div className="radio-row">
                        <select
                          aria-label={`Role, ${member.name}`}
                          value={member.role}
                          onChange={(event) => void reRole(member.id, event.target.value)}
                        >
                          <option value="specialist">Longevity specialist</option>
                          <option value="coordinator">Care coordinator</option>
                          <option value="billingLead">Billing lead</option>
                        </select>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => void remove(member.id)}
                        >
                          Remove {member.name}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Card>
      <Overlay name="Add staff member" open={open} onClose={() => setOpen(false)} opener={button}>
        <h2>Add staff member</h2>
        <TextField label="Full name" name="staff-name" value={form.name} error={errors.fields.name} onChange={(value) => setForm({ ...form, name: value })} />
        <TextField label="Email" name="staff-email" type="email" value={form.email} error={errors.fields.email} onChange={(value) => setForm({ ...form, email: value })} />
        <TextField label="Password" name="staff-password" type="password" value={form.password} error={errors.fields.password} onChange={(value) => setForm({ ...form, password: value })} />
        <SelectField
          label="Role"
          name="staff-role"
          value={form.role}
          onChange={(value) => setForm({ ...form, role: value })}
          options={[
            { value: 'specialist', label: 'Longevity specialist' },
            { value: 'coordinator', label: 'Care coordinator' },
            { value: 'billingLead', label: 'Billing lead' },
          ]}
        />
        <button type="button" disabled={busy} onClick={() => void add()}>
          Save staff member
        </button>
      </Overlay>
      <BottomBar>
        <button type="button" ref={button} onClick={() => setOpen(true)}>
          Add staff member
        </button>
      </BottomBar>
    </>
  );
}

export function StaffThreadsScreen(): JSX.Element {
  const { data: threads } = useLive<ThreadView[]>(async () => {
    const result = await api<{ threads: ThreadView[] }>('/api/message-threads');
    return result.data?.threads ?? null;
  });
  const oldestOpen = (threads ?? []).find((thread) => thread.state === 'open');
  return (
    <>
      <h1 tabIndex={-1}>Care messages</h1>
      <Card>
        <ul className="log">
          {(threads ?? []).map((thread) => (
            <li key={thread.memberId}>
              <Link to={`/staff/members/${thread.memberId}/messages`}>
                {thread.memberName} · {thread.state === 'open' ? 'Open' : 'Handled'}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <BottomBar>
        <Link
          to={
            oldestOpen
              ? `/staff/members/${oldestOpen.memberId}/messages`
              : '/staff/messages'
          }
          className="button"
        >
          Open oldest open thread
        </Link>
      </BottomBar>
    </>
  );
}

export function StaffMemberMessagesScreen({ memberId }: { memberId: string }): JSX.Element {
  const { announce } = useAnnounce();
  const errors = useFieldErrors();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { data: member } = useLive<MemberView>(async () => {
    const result = await api<{ member: MemberView }>(`/api/members/${memberId}`);
    return result.data?.member ?? null;
  }, [memberId]);
  const { data: messages, reload } = useLive<MessageView[]>(async () => {
    const result = await api<{ messages: MessageView[] }>(`/api/members/${memberId}/messages`);
    return result.data?.messages ?? null;
  }, [memberId]);

  const send = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const form = new FormData();
    form.append('body', text);
    const file = fileRef.current?.files?.[0];
    if (file) form.append('attachment', file);
    const result = await api(`/api/members/${memberId}/messages`, { method: 'POST', form });
    setBusy(false);
    if (result.error) {
      errors.show(result.error);
      announce(result.error.message);
      focusProblems();
      return;
    }
    errors.clear();
    setText('');
    if (fileRef.current) fileRef.current.value = '';
    announce(copy.replySent);
    reload();
  };

  const markHandled = async (): Promise<void> => {
    announce(copy.working);
    const result = await api(`/api/members/${memberId}/messages/handled`, {
      method: 'POST',
      json: {},
    });
    if (result.error) {
      announce(result.error.message);
      return;
    }
    announce(copy.threadHandled);
  };

  return (
    <>
      <h1 tabIndex={-1}>Messages with {member?.name ?? ''}</h1>
      <Problems fields={errors.fields} message={errors.message} />
      <Card>
        <div role="log" aria-label="Messages">
          <ul className="log">
          {(messages ?? []).map((message) => (
            <li key={message.id}>
              <p>
                <strong>{message.from.name}</strong>{' '}
                <span className="muted">{displayDateOfInstant(message.sentAt, PRACTICE_ZONE)}</span>
              </p>
              <p>{message.body}</p>
              {message.attachment ? (
                <p>
                  <a href={`/api/attachments/${message.attachment.id}`}>
                    Attachment ({message.attachment.kind})
                  </a>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        </div>
        <div className="field">
          <label htmlFor="field-reply">Reply</label>
          <textarea
            id="field-reply"
            aria-label="Reply"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="field-staff-attachment">Attachment</label>
          <input id="field-staff-attachment" type="file" aria-label="Attachment" ref={fileRef} />
        </div>
        <button type="button" className="quiet" onClick={() => void markHandled()}>
          Mark handled
        </button>
      </Card>
      <BottomBar>
        <button type="button" disabled={busy} onClick={() => void send()}>
          Send reply
        </button>
      </BottomBar>
    </>
  );
}

export { drawTimeLine };
