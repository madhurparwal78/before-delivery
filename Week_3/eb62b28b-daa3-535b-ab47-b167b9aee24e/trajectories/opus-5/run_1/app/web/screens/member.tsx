import { useEffect, useRef, useState } from 'react';
import { api, startDownload } from '../app/api';
import {
  Link,
  Problems,
  focusProblems,
  useAnnounce,
  useFieldErrors,
  useLive,
  useRemembered,
  useRouter,
  useSession,
} from '../app/shell';
import { Overlay } from '../components/overlays';
import {
  BottomBar,
  Card,
  DialogMessage,
  Glyph,
  RadioGroup,
  TableFrame,
  TextField,
} from '../components/pieces';
import { BookDrawDialog } from '../components/bookDraw';
import { MarkerBand } from '../components/markerBand';
import {
  BlendView,
  Cadence,
  DrawView,
  INGREDIENTS,
  MarkerResultsView,
  MemberView,
  MessageView,
  PlanView,
  ReceiptListItem,
  cadenceLabel,
  copy,
  displayDate,
  displayDateOfInstant,
  displayTimeOfInstant,
  drawStateLabel,
  formatMoney,
  membershipStateLabel,
  strengthLabel,
} from '../app/types';
import { ChangePasswordDialog } from './staffPieces';

export function useMe(): MemberView | null {
  const { data } = useLive<MemberView>(async () => {
    const result = await api<{ member: MemberView }>('/api/me');
    return result.data?.member ?? null;
  });
  return data;
}

const MEMBER_LINKS: [string, string][] = [
  ['/me', 'Home'],
  ['/me/membership', 'Membership'],
  ['/me/draws', 'Draws'],
  ['/me/results', 'Results'],
  ['/me/plan', 'Plan'],
  ['/me/messages', 'Messages'],
  ['/me/records', 'Records'],
  ['/me/account', 'Account'],
];

export function MemberNav(): JSX.Element {
  const { signOut } = useSession();
  const { navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const signOutNow = async (): Promise<void> => {
    await signOut();
    navigate('/signin');
  };
  return (
    <header className="site-header" data-state="solid">
      <div className="bar">
        <Link to="/me" className="brand">
          <Glyph kind="marker" />
          Ocotillo
        </Link>
        <div className="header-spacer" />
        <nav aria-label="Member" className="member-nav wide-only">
          <ul>
            {MEMBER_LINKS.map(([to, label]) => (
              <li key={to}>
                <Link to={to}>{label}</Link>
              </li>
            ))}
            <li>
              <button type="button" className="quiet" onClick={() => void signOutNow()}>
                Sign out
              </button>
            </li>
          </ul>
        </nav>
        <button
          type="button"
          className="quiet narrow-only"
          ref={menuButton}
          onClick={() => setMenuOpen(true)}
        >
          Menu
        </button>
      </div>
      <Overlay
        name="Menu"
        kind="sheet"
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        opener={menuButton}
      >
        <nav aria-label="Member" className="member-nav">
          <ul>
            {MEMBER_LINKS.map(([to, label]) => (
              <li key={to}>
                <Link to={to} onClick={() => setMenuOpen(false)}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <button type="button" onClick={() => void signOutNow()}>
          Sign out
        </button>
        <button type="button" className="quiet" onClick={() => setMenuOpen(false)}>
          Close
        </button>
      </Overlay>
    </header>
  );
}

export function MemberHomeScreen(): JSX.Element {
  const me = useMe();
  const firstName = (me?.name ?? '').split(' ')[0] ?? '';
  return (
    <>
      <h1 tabIndex={-1}>Welcome, {firstName}</h1>
      <div className="grid two">
        <Card>
          <h2>Membership</h2>
          <p data-part="membership-state">
            {me ? membershipStateLabel[me.membership.state] : ''}
          </p>
          <Link to="/me/membership">Go to Membership</Link>
        </Card>
        <Card>
          <h2>Your next steps</h2>
          <p>Book a draw, read your results and follow your plan.</p>
          <Link to="/me/results">See your results</Link>
        </Card>
      </div>
      <BottomBar>
        <Link to="/me/draws" className="button">
          Book a draw
        </Link>
      </BottomBar>
    </>
  );
}

export function MembershipScreen(): JSX.Element {
  const me = useMe();
  const { announce } = useAnnounce();
  const [joinOpen, setJoinOpen] = useRemembered('membership-join-open', false);
  const [changeOpen, setChangeOpen] = useRemembered('membership-change-open', false);
  const [cancelOpen, setCancelOpen] = useRemembered('membership-cancel-open', false);
  const [cadence, setCadence] = useRemembered<Cadence>('membership-cadence', 'yearly');
  const [dialogMessage, setDialogMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const joinButton = useRef<HTMLButtonElement | null>(null);
  const changeButton = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const requestKey = useRef(`join-${Math.random().toString(36).slice(2)}`);

  const membership = me?.membership;
  const line = ((): string => {
    if (!membership) return '';
    if (membership.state === 'cancelled' && membership.plusUntil) {
      return copy.plusUntilLine(displayDate(membership.plusUntil));
    }
    if (membership.pendingCadence && membership.pendingFrom) {
      return copy.pendingCadenceLine(membership.pendingCadence, displayDate(membership.pendingFrom));
    }
    if (membership.renewalDate) return copy.renewsLine(displayDate(membership.renewalDate));
    return '';
  })();

  const act = async (
    run: () => Promise<{ error: { message: string } | null; status: number }>,
    close: () => void,
    success: string,
  ): Promise<void> => {
    setBusy(true);
    setDialogMessage(null);
    announce(copy.working);
    const result = await run();
    setBusy(false);
    if (result.error) {
      setDialogMessage(result.error.message);
      announce(result.error.message);
      return;
    }
    announce(success);
    close();
  };

  return (
    <>
      <h1 tabIndex={-1}>Membership</h1>
      <Card>
        <p data-part="membership-state">
          {membership ? membershipStateLabel[membership.state] : ''}
          {line === '' ? '' : ` · ${line}`}
        </p>
        {membership?.state === 'free' ? (
          <button type="button" ref={joinButton} onClick={() => setJoinOpen(true)}>
            Join Plus
          </button>
        ) : (
          <div className="radio-row">
            <button type="button" ref={changeButton} onClick={() => setChangeOpen(true)}>
              Change cadence
            </button>
            {membership?.state === 'cancelled' ? null : (
              <button
                type="button"
                className="quiet"
                ref={cancelButton}
                onClick={() => setCancelOpen(true)}
              >
                Cancel Plus
              </button>
            )}
          </div>
        )}
      </Card>
      <Card>
        <h2>Records and receipts</h2>
        <Link to="/me/records">Open records and receipts</Link>
      </Card>
      <Overlay
        name="Join Plus"
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        opener={joinButton}
      >
        <h2>Join Plus</h2>
        <DialogMessage text={dialogMessage} />
        <RadioGroup
          label="Billing cadence"
          name="join-cadence"
          value={cadence}
          onChange={(value) => setCadence(value as Cadence)}
          options={[
            { value: 'sixMonths', label: cadenceLabel.sixMonths },
            { value: 'yearly', label: cadenceLabel.yearly },
          ]}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(
              async () => {
                const result = await api<{ membership: { state: string } }>('/api/me/membership', {
                  method: 'POST',
                  json: { cadence },
                  requestKey: requestKey.current,
                });
                return result;
              },
              () => setJoinOpen(false),
              copy.joinActive,
            )
          }
        >
          Confirm and join
        </button>
      </Overlay>
      <Overlay
        name="Change cadence"
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        opener={changeButton}
      >
        <h2>Change cadence</h2>
        <DialogMessage text={dialogMessage} />
        <RadioGroup
          label="Billing cadence"
          name="change-cadence"
          value={cadence}
          onChange={(value) => setCadence(value as Cadence)}
          options={[
            { value: 'sixMonths', label: cadenceLabel.sixMonths },
            { value: 'yearly', label: cadenceLabel.yearly },
          ]}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(
              () => api('/api/me/membership', { method: 'PATCH', json: { cadence } }),
              () => setChangeOpen(false),
              copy.cadenceSaved,
            )
          }
        >
          Confirm change
        </button>
      </Overlay>
      <Overlay
        name="Cancel Plus"
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        opener={cancelButton}
      >
        <h2>Cancel Plus</h2>
        <DialogMessage text={dialogMessage} />
        <p>Plus stays until the end of your paid period.</p>
        <div className="radio-row">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(
                () => api('/api/me/membership/cancel', { method: 'POST', json: {} }),
                () => setCancelOpen(false),
                copy.cancelSaved,
              )
            }
          >
            Yes, cancel Plus
          </button>
          <button type="button" className="quiet" onClick={() => setCancelOpen(false)}>
            Keep Plus
          </button>
        </div>
      </Overlay>
      <BottomBar>
        {membership?.state === 'free' ? (
          <button type="button" onClick={() => setJoinOpen(true)}>
            Join Plus
          </button>
        ) : (
          <button type="button" onClick={() => setChangeOpen(true)}>
            Change cadence
          </button>
        )}
      </BottomBar>
    </>
  );
}

export function MemberDrawsScreen(): JSX.Element {
  const me = useMe();
  const { navigate } = useRouter();
  const [bookOpen, setBookOpen] = useState(false);
  const bookButton = useRef<HTMLButtonElement | null>(null);
  const { data: draws, reload } = useLive<DrawView[]>(async () => {
    const result = await api<{ draws: DrawView[] }>('/api/me/draws');
    return result.data?.draws ?? null;
  });
  return (
    <>
      <h1 tabIndex={-1}>Your draws</h1>
      <Card>
        <ul className="log">
          {(draws ?? []).map((draw) => (
            <li key={draw.id}>
              <Link to={`/me/draws/${draw.id}`}>
                {displayDate(draw.localDate)}, {draw.localTime} · {drawStateLabel[draw.state]}
              </Link>
            </li>
          ))}
        </ul>
        {draws && draws.length === 0 ? <p className="muted">No draws yet.</p> : null}
      </Card>
      <BookDrawDialog
        name="Book draw"
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        opener={bookButton}
        asStaff={false}
        members={[]}
        member={me}
        onDone={(draw) => {
          setBookOpen(false);
          reload();
          navigate(`/me/draws/${draw.id}`);
        }}
      />
      <BottomBar>
        <button type="button" ref={bookButton} onClick={() => setBookOpen(true)}>
          Book a draw
        </button>
      </BottomBar>
    </>
  );
}

export function MemberDrawScreen({ drawId }: { drawId: string }): JSX.Element {
  const me = useMe();
  const { announce } = useAnnounce();
  const [moveOpen, setMoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [dialogMessage, setDialogMessage] = useState<string | null>(null);
  const moveButton = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const { data: draw, reload } = useLive<DrawView>(async () => {
    const result = await api<{ draws: DrawView[] }>('/api/me/draws');
    return result.data?.draws.find((entry) => entry.id === drawId) ?? null;
  }, [drawId]);

  const cancelDraw = async (): Promise<void> => {
    announce(copy.working);
    const result = await api(`/api/me/draws/${drawId}/cancel`, { method: 'POST', json: {} });
    if (result.error) {
      setDialogMessage(result.error.message);
      announce(result.error.message);
      return;
    }
    announce(copy.drawCancelled);
    setCancelOpen(false);
    reload();
  };

  return (
    <>
      <h1 tabIndex={-1}>Draw on {draw ? displayDate(draw.localDate) : ''}</h1>
      <Card>
        {draw ? (
          <>
            <p>
              {displayDate(draw.localDate)}, {draw.localTime} · {drawStateLabel[draw.state]}
            </p>
            <p>{draw.phlebotomistName}</p>
            <p className="muted">
              Changes close {displayDateOfInstant(draw.changesCloseAt, draw.timeZone)},{' '}
              {displayTimeOfInstant(draw.changesCloseAt, draw.timeZone)}
            </p>
            {draw.kitCodes.length > 0 ? (
              <ul className="kit-list">
                {draw.kitCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
            ) : null}
            <div className="radio-row">
              <button type="button" className="quiet" ref={cancelButton} onClick={() => setCancelOpen(true)}>
                Cancel draw
              </button>
            </div>
          </>
        ) : null}
      </Card>
      {draw ? (
        <BookDrawDialog
          name="Move draw"
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          opener={moveButton}
          asStaff={false}
          members={[]}
          member={me}
          draw={draw}
          onDone={() => {
            setMoveOpen(false);
            reload();
          }}
        />
      ) : null}
      <Overlay
        name="Cancel draw"
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        opener={cancelButton}
      >
        <h2>Cancel draw</h2>
        <DialogMessage text={dialogMessage} />
        <div className="radio-row">
          <button type="button" onClick={() => void cancelDraw()}>
            Yes, cancel this draw
          </button>
          <button type="button" className="quiet" onClick={() => setCancelOpen(false)}>
            Keep this draw
          </button>
        </div>
      </Overlay>
      <BottomBar>
        <button type="button" ref={moveButton} onClick={() => setMoveOpen(true)}>
          Move draw
        </button>
      </BottomBar>
      <p>
        <Link to="/me/draws">Back to your draws</Link>
      </p>
    </>
  );
}

export function MemberResultsScreen(): JSX.Element {
  const me = useMe();
  const { announce } = useAnnounce();
  const previous = useRef<Map<string, string>>(new Map());
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const { data: markers } = useLive<MarkerResultsView[]>(async () => {
    const result = await api<{ markers: MarkerResultsView[] }>('/api/me/results');
    return result.data?.markers ?? null;
  });

  useEffect(() => {
    if (!markers || !me?.timeZone) return;
    const lines: Record<string, string> = {};
    for (const marker of markers) {
      for (const draw of marker.draws) {
        const key = `${marker.marker}:${draw.drawId}`;
        const stamp = `${draw.value}|${draw.correctedAt ?? ''}`;
        const before = previous.current.get(key);
        if (before && before !== stamp && draw.correctedBy && draw.correctedAt) {
          lines[marker.marker] = copy.correctionArrived(
            draw.correctedBy,
            marker.name,
            displayTimeOfInstant(draw.correctedAt, me.timeZone),
            me.timeZone,
          );
        }
        previous.current.set(key, stamp);
      }
    }
    if (Object.keys(lines).length > 0) {
      setCorrections((current) => ({ ...current, ...lines }));
      const first = Object.values(lines)[0];
      if (first) announce(first);
    }
  }, [markers, me?.timeZone, announce]);

  return (
    <>
      <h1 tabIndex={-1}>Your results</h1>
      {(markers ?? []).map((marker) => (
        <MarkerBand
          key={marker.marker}
          marker={marker}
          zone={me?.timeZone ?? 'phoenix'}
          correctionLine={corrections[marker.marker] ?? null}
        />
      ))}
      {markers && markers.length === 0 ? (
        <Card>
          <p className="muted">No released results yet.</p>
        </Card>
      ) : null}
      <BottomBar>
        <Link to="/me/messages" className="button">
          Message your care team
        </Link>
      </BottomBar>
    </>
  );
}

export function MemberPlanScreen(): JSX.Element {
  const { data: plan } = useLive<PlanView | null>(async () => {
    const result = await api<{ plan: PlanView | null }>('/api/me/plan');
    return result.data ? (result.data.plan as PlanView | null) : null;
  });
  const { data: blend } = useLive<BlendView | null>(async () => {
    const result = await api<{ blend: BlendView | null }>('/api/me/blend');
    return result.data ? (result.data.blend as BlendView | null) : null;
  });
  return (
    <>
      <h1 tabIndex={-1}>Your longevity plan</h1>
      {plan ? (
        <>
          <Card>
            <p>
              {copy.planByline(
                displayDateOfInstant(plan.publishedAt ?? plan.updatedAt, 'phoenix'),
                plan.publishedBy ?? '',
              )}
            </p>
            <h2>Nutrition</h2>
            <PlanText text={plan.sections.nutrition} />
            <h2>Movement</h2>
            <PlanText text={plan.sections.movement} />
            <h2>Sleep</h2>
            <PlanText text={plan.sections.sleep} />
            <h2>Supplements</h2>
            <PlanText text={plan.sections.supplements} />
            <BlendSummary blend={blend ?? plan.blend} />
          </Card>
        </>
      ) : (
        <Card>
          <p className="muted">Your specialist has not published a plan yet.</p>
        </Card>
      )}
      <BottomBar>
        <Link to="/me/messages" className="button">
          Message your care team
        </Link>
      </BottomBar>
    </>
  );
}

export function PlanText({ text }: { text: string }): JSX.Element {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split('\n');
        if (lines.every((line) => line.startsWith('- '))) {
          return (
            <ul key={index}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block}</p>;
      })}
    </>
  );
}

export function BlendSummary({ blend }: { blend: BlendView | null }): JSX.Element {
  if (!blend) return <p className="muted">No blend yet.</p>;
  return (
    <>
      <p>Morning packet {blend.morningCapsules} of 4 capsules</p>
      <p>Evening packet {blend.eveningCapsules} of 4 capsules</p>
      <ul>
        {blend.items.map((item) => {
          const ingredient = INGREDIENTS.find((entry) => entry.id === item.ingredient);
          return (
            <li key={item.ingredient}>
              {ingredient ? ingredient.name : item.ingredient}{' '}
              {ingredient ? strengthLabel(ingredient) : ''} · {item.capsulesPerDay} a day
            </li>
          );
        })}
      </ul>
      <p>30-day list price {formatMoney(blend.listPriceCents)}</p>
      <p>Member price {formatMoney(blend.memberPriceCents)}</p>
    </>
  );
}

export function MemberMessagesScreen(): JSX.Element {
  const me = useMe();
  const { announce } = useAnnounce();
  const errors = useFieldErrors();
  const [text, setText] = useRemembered('member-message', '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { data: messages, reload } = useLive<MessageView[]>(async () => {
    const result = await api<{ messages: MessageView[] }>('/api/me/messages');
    return result.data?.messages ?? null;
  });

  const send = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const form = new FormData();
    form.append('body', text);
    const file = fileRef.current?.files?.[0];
    if (file) form.append('attachment', file);
    const result = await api<{ message: MessageView }>('/api/me/messages', {
      method: 'POST',
      form,
    });
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
    announce(copy.messageSent);
    reload();
  };

  return (
    <>
      <h1 tabIndex={-1}>Messages</h1>
      <Problems fields={errors.fields} message={errors.message} />
      <Card>
        <div role="log" aria-label="Messages">
          <ul className="log">
          {(messages ?? []).map((message) => (
            <li key={message.id} className={message.from.role === 'member' ? 'mine' : ''}>
              <p>
                <strong>{message.from.name}</strong>{' '}
                <span className="muted">
                  {displayDateOfInstant(message.sentAt, me?.timeZone ?? 'phoenix')}
                </span>
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
          <label htmlFor="field-message">Message</label>
          <textarea
            id="field-message"
            aria-label="Message"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="muted">{[...text].length} of 2,000 characters</p>
        </div>
        <div className="field">
          <label htmlFor="field-attachment">Attachment</label>
          <input id="field-attachment" type="file" aria-label="Attachment" ref={fileRef} />
        </div>
      </Card>
      <BottomBar>
        <button type="button" disabled={busy} onClick={() => void send()}>
          Send message
        </button>
      </BottomBar>
    </>
  );
}

export function MemberRecordsScreen(): JSX.Element {
  const { announce } = useAnnounce();
  const [problem, setProblem] = useState<string | null>(null);
  const { data: receipts } = useLive<ReceiptListItem[]>(async () => {
    const result = await api<{ receipts: ReceiptListItem[] }>('/api/me/receipts');
    return result.data?.receipts ?? null;
  });

  const download = async (): Promise<void> => {
    announce(copy.working);
    const response = await fetch('/api/me/results-history', { credentials: 'same-origin' });
    if (response.status === 429) {
      const body = (await response.json()) as { error: { message: string } };
      setProblem(body.error.message);
      announce(body.error.message);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    startDownload(url);
    URL.revokeObjectURL(url);
    setProblem(null);
    announce(copy.downloadStarted);
  };

  return (
    <>
      <h1 tabIndex={-1}>Records and receipts</h1>
      <Problems message={problem} />
      <Card>
        <h2>Receipts</h2>
        <TableFrame name="Receipts table">
          <table>
            <caption>Receipts</caption>
            <thead>
              <tr>
                <th scope="col">Receipt</th>
                <th scope="col">Paid</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(receipts ?? []).map((receipt) => (
                <tr key={receipt.id}>
                  <td>
                    <Link to={`/receipts/${receipt.id}`}>{receipt.number}</Link>
                  </td>
                  <td>{displayDate(receipt.paidDate)}</td>
                  <td>{formatMoney(receipt.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Card>
      <BottomBar>
        <button type="button" onClick={() => void download()}>
          Download results history
        </button>
      </BottomBar>
    </>
  );
}

export function MemberAccountScreen(): JSX.Element {
  const me = useMe();
  const { announce } = useAnnounce();
  const { navigate } = useRouter();
  const errors = useFieldErrors();
  const [form, setForm] = useState({
    phone: '',
    line1: '',
    line2: '',
    city: '',
    postalCode: '',
    gateNotes: '',
  });
  const loaded = useRef(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me || loaded.current) return;
    loaded.current = true;
    setForm({
      phone: me.phone ?? '',
      line1: me.address?.line1 ?? '',
      line2: me.address?.line2 ?? '',
      city: me.address?.city ?? '',
      postalCode: me.address?.postalCode ?? '',
      gateNotes: me.gateNotes ?? '',
    });
  }, [me]);

  const save = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api('/api/me', {
      method: 'PATCH',
      json: {
        phone: form.phone,
        address: {
          line1: form.line1,
          line2: form.line2,
          city: form.city,
          postalCode: form.postalCode,
        },
        gateNotes: form.gateNotes,
      },
    });
    setBusy(false);
    if (result.error) {
      errors.show(result.error);
      announce(result.error.message);
      focusProblems();
      return;
    }
    errors.clear();
    announce(copy.profileSaved);
  };

  const closeAccount = async (): Promise<void> => {
    announce(copy.working);
    const result = await api<{ member: MemberView }>('/api/me/closure', {
      method: 'POST',
      json: {},
    });
    if (result.error) {
      announce(result.error.message);
      return;
    }
    const member = result.data?.member;
    if (member?.erasesAt && member.timeZone) {
      announce(
        copy.accountClosing(
          displayDateOfInstant(member.erasesAt, member.timeZone),
          displayTimeOfInstant(member.erasesAt, member.timeZone),
          member.timeZone,
        ),
      );
    }
    setCloseOpen(false);
    navigate('/me/account');
  };

  return (
    <>
      <h1 tabIndex={-1}>Your account</h1>
      <Problems fields={errors.fields} message={errors.message} />
      {me && me.accountState === 'closing' && me.erasesAt && me.timeZone ? (
        <Card>
          <p>
            {copy.accountClosing(
              displayDateOfInstant(me.erasesAt, me.timeZone),
              displayTimeOfInstant(me.erasesAt, me.timeZone),
              me.timeZone,
            )}
          </p>
        </Card>
      ) : null}
      <Card>
        <TextField
          label="Phone"
          name="phone"
          value={form.phone}
          onChange={(value) => setForm({ ...form, phone: value })}
        />
        <TextField
          label="Address line 1"
          name="line1"
          value={form.line1}
          error={errors.fields['address.line1']}
          onChange={(value) => setForm({ ...form, line1: value })}
        />
        <TextField
          label="Address line 2"
          name="line2"
          value={form.line2}
          onChange={(value) => setForm({ ...form, line2: value })}
        />
        <TextField
          label="City"
          name="city"
          value={form.city}
          error={errors.fields['address.city']}
          onChange={(value) => setForm({ ...form, city: value })}
        />
        <TextField
          label="ZIP code"
          name="postalCode"
          value={form.postalCode}
          error={errors.fields.postalCode}
          onChange={(value) => setForm({ ...form, postalCode: value })}
        />
        <TextField
          label="Gate notes"
          name="gateNotes"
          value={form.gateNotes}
          onChange={(value) => setForm({ ...form, gateNotes: value })}
        />
      </Card>
      <Card>
        <h2>Password and closing</h2>
        <div className="radio-row">
          <ChangePasswordDialog />
          <button type="button" className="quiet" ref={closeButton} onClick={() => setCloseOpen(true)}>
            Close account
          </button>
        </div>
      </Card>
      <Overlay
        name="Close account"
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        opener={closeButton}
      >
        <h2>Close account</h2>
        <p>Your Plus runs to the end of the paid period.</p>
        <div className="radio-row">
          <button type="button" onClick={() => void closeAccount()}>
            Yes, close my account
          </button>
          <button type="button" className="quiet" onClick={() => setCloseOpen(false)}>
            Keep my account
          </button>
        </div>
      </Overlay>
      <BottomBar>
        <button type="button" disabled={busy} onClick={() => void save()}>
          Save profile
        </button>
      </BottomBar>
    </>
  );
}
