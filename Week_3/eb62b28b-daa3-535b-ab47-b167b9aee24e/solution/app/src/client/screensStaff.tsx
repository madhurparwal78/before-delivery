// The staff desk.

import { useEffect, useRef, useState } from "react";
import { BlendsAnswer, DrawAnswer, DrawsAnswer, MemberAnswer, MembersAnswer, MessagesAnswer, PlanAnswer, PlansListAnswer, PreviewAnswer, RangeChangesAnswer, RangesAnswer, MarkersAnswer, ReceiptAnswer, ReceiptPageAnswer, ResultsAnswer, ResultsFileAnswer, StaffListAnswer, StatesAnswer, ThreadsAnswer, type DrawView, type MarkerResults, type MemberAnyView, type PlanView, type PreviewRow, type RangeRow, type ReceiptView, type ResultEntry, type Role, type StaffView } from "../shared/api";
import type { ReceiptPage } from "../shared/api";
import { formatCents, formatDate, formatDateIn, twoTimeLine } from "../shared/format";
import { ACCOUNT_STATE_LABEL, AGE_BAND_LABEL, DRAW_STATE_LABEL, ROLE_LABEL, SEX_LABEL, THREAD_STATE_LABEL } from "../shared/labels";
import { addDays, localDate, localTime, weekdayOf } from "../shared/time";
import { getJson, sendJson, sendNoAnswer, serverNow, upload } from "./api";
import { ResultsList } from "./band";
import { BlendScreen } from "./blend";
import { CancelDrawDialog, MoveDrawDialog, StaffBookDraw } from "./drawDialogs";
import { BandGlyph, MessageGlyph, TubeGlyph } from "./glyphs";
import { MemberShell, StaffShell } from "./shells";
import { MembershipState, MessageForm, MessageLog, PlanSectionsView, ReceiptsTable } from "./screensMember";
import { NotFoundScreen, SEX_CHOICES, ZONE_CHOICES } from "./screensPublic";
import { closeDialog, navigate, openDialog, useSession } from "./stores";
import { ActionBar, Button, Dialog, Link, onSubmit, OpenerButton, PageHeading, Problems, RadioGroup, SelectField, Skeleton, StatePill, TextArea, TextField, useAction, useForm, useLoad, useMedia, type Action } from "./ui";

function useRole(): Role {
  const session = useSession();
  return session.kind === "live" ? session.view.user.role : "member";
}

const canBook = (role: Role): boolean => role === "owner" || role === "coordinator";
const canCare = (role: Role): boolean => role === "owner" || role === "coordinator" || role === "specialist";
const canSpecialize = (role: Role): boolean => role === "owner" || role === "specialist";

const staffLine = (draw: DrawView): string => twoTimeLine(draw.localDate, draw.startsAt, draw.timeZone);

const useMember = (memberId: string) => useLoad(() => getJson(`/api/members/${memberId}`, MemberAnswer), `member-${memberId}`);

const notFoundStaff = () => <NotFoundScreen />;

// Members.

function AddMemberDialog({ onAdded }: { onAdded: () => Promise<void> }) {
  const action = useAction();
  return (
    <Dialog id="add-member" title="Add member" action={action}>
      <AddMemberBody action={action} onAdded={onAdded} />
    </Dialog>
  );
}

function AddMemberBody({ action, onAdded }: { action: Action; onAdded: () => Promise<void> }) {
  const states = useLoad(() => getJson("/api/states", StatesAnswer), "states", false);
  const form = useForm("add-member", { name: "", email: "", password: "", dateOfBirth: "", sex: "", state: "", timeZone: "", phone: "", line1: "", line2: "", city: "", postalCode: "", gateNotes: "", cadence: "" });
  const submit = (): void => {
    void action.run(async () => {
      const answer = await sendJson("POST", "/api/members", {
        name: form.value("name"),
        email: form.value("email"),
        password: form.value("password"),
        dateOfBirth: form.value("dateOfBirth"),
        sex: form.value("sex"),
        state: form.value("state"),
        timeZone: form.value("timeZone"),
        phone: form.value("phone"),
        address: { line1: form.value("line1"), line2: form.value("line2"), city: form.value("city"), postalCode: form.value("postalCode") },
        gateNotes: form.value("gateNotes"),
        cadence: form.value("cadence") || null,
      }, MemberAnswer);
      await onAdded();
      closeDialog();
      return `${answer.member.name} added.`;
    });
  };
  const problem = action.problem;
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <TextField form={form} name="name" label="Full name" problem={problem} />
      <TextField form={form} name="email" label="Email" type="email" problem={problem} />
      <TextField form={form} name="password" label="Password" type="password" problem={problem} autoComplete="new-password" />
      <TextField form={form} name="dateOfBirth" label="Date of birth" problem={problem} hint="As YYYY-MM-DD" />
      <RadioGroup form={form} name="sex" label="Sex" problem={problem} choices={SEX_CHOICES} />
      <SelectField form={form} name="state" label="Home state" problem={problem} prompt="Choose a state" choices={(states.data?.states ?? []).map((entry) => ({ value: entry.state, label: entry.name }))} />
      <SelectField form={form} name="timeZone" label="Local time" problem={problem} prompt="Choose local time" choices={ZONE_CHOICES} />
      <TextField form={form} name="phone" label="Phone" type="tel" problem={problem} />
      <TextField form={form} name="line1" label="Address line 1" problem={problem} />
      <TextField form={form} name="line2" label="Address line 2" problem={problem} />
      <TextField form={form} name="city" label="City" problem={problem} />
      <TextField form={form} name="postalCode" label="ZIP code" problem={problem} />
      <TextField form={form} name="gateNotes" label="Gate notes" problem={problem} />
      <SelectField form={form} name="cadence" label="Plus cadence" problem={problem} prompt="Free" choices={[{ value: "sixMonths", label: "Every 6 months" }, { value: "yearly", label: "Yearly" }]} />
      <Button type="submit" action={action}>Save member</Button>
    </form>
  );
}

export function MembersScreen() {
  const role = useRole();
  const members = useLoad(() => getJson("/api/members", MembersAnswer), "members");
  return (
    <StaffShell>
      <section className="page-head">
        <PageHeading>Members</PageHeading>
        {role === "owner" ? <ActionBar><OpenerButton dialog="add-member">Add member</OpenerButton></ActionBar> : null}
      </section>
      <section className="card">
        {!members.data ? <Skeleton blocks={1} /> : (
          <ul className="row-list">
            {members.data.members.map((member) => (
              <li key={member.id}>
                <Link to={`/staff/members/${member.id}`} className="row-link">{member.name}</Link>
                <StatePill>{ACCOUNT_STATE_LABEL[member.accountState]}</StatePill>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddMemberDialog onAdded={members.reload} />
    </StaffShell>
  );
}

function RecordSections({ member, role }: { member: MemberAnyView; role: Role }) {
  const draws = useLoad(async () => (canCare(role) && member.accountState !== "erased" && member.accountState !== "erasing" ? getJson(`/api/draws?memberId=${member.id}`, DrawsAnswer) : { draws: [] }), `record-draws-${member.id}`);
  return (
    <>
      <section className="card">
        <h2>Draws</h2>
        {(draws.data?.draws ?? []).length === 0 ? <p className="muted">No draws yet.</p> : (
          <ul className="row-list">
            {(draws.data?.draws ?? []).map((draw) => (
              <li key={draw.id}>
                <Link to={`/staff/draws/${draw.id}`} className="row-link">{staffLine(draw)}</Link>
                <StatePill>{DRAW_STATE_LABEL[draw.state]}</StatePill>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card link-grid">
        <h2>Results, plan, blend and messages</h2>
        <Link to={`/staff/members/${member.id}/results`} className="text-link">Results</Link>
        {canSpecialize(role) ? <Link to={`/staff/members/${member.id}/plan`} className="text-link">Plan</Link> : null}
        {canSpecialize(role) ? <Link to={`/staff/members/${member.id}/blend`} className="text-link">Blend</Link> : null}
        <Link to={`/staff/members/${member.id}/messages`} className="text-link">Messages</Link>
      </section>
    </>
  );
}

export function MemberRecordScreen({ memberId }: { memberId: string }) {
  const role = useRole();
  const member = useMember(memberId);
  const restore = useAction();
  if (member.failed?.status === 404) return notFoundStaff();
  const data = member.data?.member;
  return (
    <StaffShell>
      {data ? (
        <>
          <section className="page-head">
            <PageHeading>{data.name}</PageHeading>
            {canBook(role) && data.accountState === "active" ? <ActionBar><OpenerButton dialog="book-draw">Book draw</OpenerButton></ActionBar> : null}
          </section>
          <div className="stack">
            <section className="card">
              <h2>Member details</h2>
              <StatePill>{ACCOUNT_STATE_LABEL[data.accountState]}</StatePill>
              <dl className="details">
                {data.email ? <><dt>Email</dt><dd>{data.email}</dd></> : null}
                {data.phone ? <><dt>Phone</dt><dd>{data.phone}</dd></> : null}
                {data.dateOfBirth ? <><dt>Date of birth</dt><dd>{formatDate(data.dateOfBirth)}</dd></> : null}
                {data.address ? <><dt>Address</dt><dd>{data.address.line1}{data.address.line2 ? `, ${data.address.line2}` : ""}, {data.address.city} {data.address.postalCode}</dd></> : null}
                {data.gateNotes ? <><dt>Gate notes</dt><dd>{data.gateNotes}</dd></> : null}
              </dl>
              {role === "owner" && data.accountState === "closing" ? (
                <Button kind="secondary" action={restore} onClick={() => void restore.run(async () => {
                  await sendJson("POST", `/api/members/${data.id}/restore`, {}, MemberAnswer);
                  await member.reload();
                  return `${data.name}'s account is back.`;
                })}>Bring back account</Button>
              ) : null}
              <Problems form="restore" action={restore} />
            </section>
            <section className="card">
              <h2>Membership</h2>
              <MembershipState membership={data.membership} />
            </section>
            <RecordSections member={data} role={role} />
          </div>
          {canBook(role) ? <StaffBookDraw member={data} chooseMember={false} /> : null}
        </>
      ) : <Skeleton />}
    </StaffShell>
  );
}

// Results on the staff side.

function CorrectDialog({ target, onSaved }: { target: { marker: MarkerResults; entry: ResultEntry } | null; onSaved: () => Promise<void> }) {
  const action = useAction();
  return (
    <Dialog id="correct-value" title="Correct value" action={action}>
      {target ? <CorrectBody action={action} target={target} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function CorrectBody({ action, target, onSaved }: { action: Action; target: { marker: MarkerResults; entry: ResultEntry }; onSaved: () => Promise<void> }) {
  const form = useForm("correct-value", { value: target.entry.value, note: target.entry.note ?? "" });
  const submit = (): void => {
    void action.run(async () => {
      await sendNoAnswer("PATCH", `/api/results/${target.entry.resultId}`, { value: form.value("value"), note: form.value("note") });
      await onSaved();
      closeDialog();
      return `${target.marker.name} corrected.`;
    });
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <TextField form={form} name="value" label="Value" problem={action.problem} inputMode="text" />
      <TextField form={form} name="note" label="Note" problem={action.problem} />
      <Button type="submit" action={action}>Save correction</Button>
    </form>
  );
}

export function StaffResultsScreen({ memberId }: { memberId: string }) {
  const role = useRole();
  const member = useMember(memberId);
  const results = useLoad(() => getJson(`/api/members/${memberId}/results`, ResultsAnswer), `staff-results-${memberId}`);
  const [target, setTarget] = useState<{ marker: MarkerResults; entry: ResultEntry } | null>(null);
  if (member.failed?.status === 404 || results.failed?.status === 404) return notFoundStaff();
  const name = member.data?.member.name;
  return (
    <StaffShell>
      {name ? (
        <section className="page-head">
          <PageHeading>{`Results for ${name}`}</PageHeading>
          <ActionBar><Link to={`/staff/members/${memberId}`} className="button button-primary">Back to member</Link></ActionBar>
        </section>
      ) : <Skeleton blocks={1} />}
      <div className="stack">
        {results.data ? (results.data.markers.length === 0 ? (
          <section className="card empty"><BandGlyph size={40} /><p>No results yet for this member.</p></section>
        ) : (
          <ResultsList
            markers={results.data.markers}
            zone="phoenix"
            dialogPrefix="staff"
            {...(canSpecialize(role) ? {
              action: (marker: MarkerResults, entry: ResultEntry) => (
                <Button kind="secondary" onClick={(event) => {
                  setTarget({ marker, entry });
                  openDialog("correct-value", event.currentTarget);
                }}>Correct value</Button>
              ),
            } : {})}
          />
        )) : <Skeleton />}
      </div>
      <CorrectDialog target={target} onSaved={results.reload} />
    </StaffShell>
  );
}

// Plans on the staff side.

function EditPlanDialog({ memberId, plans, onPublished, onSaved }: { memberId: string; plans: readonly PlanView[]; onPublished: (plan: PlanView) => void; onSaved: () => Promise<void> }) {
  const action = useAction();
  return (
    <Dialog id="edit-plan" title="Edit plan" action={action}>
      <EditPlanBody action={action} memberId={memberId} plans={plans} onPublished={onPublished} onSaved={onSaved} />
    </Dialog>
  );
}

function EditPlanBody({ action, memberId, plans, onPublished, onSaved }: { action: Action; memberId: string; plans: readonly PlanView[]; onPublished: (plan: PlanView) => void; onSaved: () => Promise<void> }) {
  const opened = useRef(plans);
  const openDraft = opened.current.find((plan) => plan.state === "draft");
  const latest = opened.current.find((plan) => plan.state === "published");
  const start = openDraft ?? latest;
  const draftId = useRef(openDraft?.id ?? null);
  const basedOn = useRef(openDraft?.basedOnPlanId ?? latest?.id ?? null);
  const form = useForm("edit-plan", {
    nutrition: start?.sections.nutrition ?? "",
    movement: start?.sections.movement ?? "",
    sleep: start?.sections.sleep ?? "",
    supplements: start?.sections.supplements ?? "",
  });
  const sections = () => ({ nutrition: form.value("nutrition"), movement: form.value("movement"), sleep: form.value("sleep"), supplements: form.value("supplements") });
  const saveDraft = async (): Promise<PlanView> => {
    const answer = draftId.current
      ? await sendJson("PUT", `/api/longevity-plans/${draftId.current}`, { sections: sections() }, PlanAnswer)
      : await sendJson("POST", `/api/members/${memberId}/plans`, { basedOnPlanId: basedOn.current, sections: sections() }, PlanAnswer);
    draftId.current = answer.plan.id;
    return answer.plan;
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(() => undefined)}>
      <TextArea form={form} name="nutrition" label="Nutrition" problem={action.problem} />
      <TextArea form={form} name="movement" label="Movement" problem={action.problem} />
      <TextArea form={form} name="sleep" label="Sleep" problem={action.problem} />
      <TextArea form={form} name="supplements" label="Supplements notes" problem={action.problem} />
      <div className="button-row">
        <Button kind="secondary" action={action} onClick={() => void action.run(async () => {
          await saveDraft();
          await onSaved();
          closeDialog();
          return "Draft saved.";
        })}>Save draft</Button>
        <Button action={action} onClick={() => void action.run(async () => {
          const draft = await saveDraft();
          const published = await sendJson("POST", `/api/longevity-plans/${draft.id}/publish`, {}, PlanAnswer);
          closeDialog();
          onPublished(published.plan);
          return "Plan published.";
        })}>Publish plan</Button>
      </div>
    </form>
  );
}

export function StaffPlanScreen({ memberId }: { memberId: string }) {
  const member = useMember(memberId);
  const plans = useLoad(() => getJson(`/api/members/${memberId}/plans`, PlansListAnswer), `plans-${memberId}`);
  const blends = useLoad(() => getJson(`/api/members/${memberId}/blends`, BlendsAnswer), `blends-${memberId}`);
  if (member.failed?.status === 404 || plans.failed?.status === 404) return notFoundStaff();
  const name = member.data?.member.name;
  const list = plans.data?.plans ?? [];
  const published = list.filter((plan) => plan.state === "published");
  const latest = published[0];
  const earlier = published.slice(1);
  return (
    <StaffShell>
      {name ? (
        <section className="page-head">
          <PageHeading>{`Plan for ${name}`}</PageHeading>
          <ActionBar><OpenerButton dialog="edit-plan">Edit plan</OpenerButton></ActionBar>
        </section>
      ) : <Skeleton blocks={1} />}
      <div className="stack">
        {!plans.data ? <Skeleton /> : latest ? (
          <>
            {latest.publishedAt ? <p className="byline">Published {formatDateIn(latest.publishedAt, "phoenix")} by {latest.publishedBy}</p> : null}
            <PlanSectionsView sections={latest.sections} blend={blends.data?.blends[0] ?? null} />
          </>
        ) : <section className="card"><p className="muted">No plan is published yet.</p></section>}
        {published.length > 0 ? (
          <section className="card">
            <h2>Earlier plans</h2>
            <ul aria-label="Earlier plans" className="row-list">
              {earlier.map((plan) => (
                <li key={plan.id}>
                  <Link to={`/staff/members/${memberId}/plans/${plan.id}`} className="row-link">
                    {`Published ${plan.publishedAt ? formatDateIn(plan.publishedAt, "phoenix") : ""} by ${plan.publishedBy ?? ""}`}
                  </Link>
                </li>
              ))}
            </ul>
            {earlier.length === 0 ? <p className="muted">No earlier plans yet.</p> : null}
          </section>
        ) : null}
      </div>
      {plans.data ? (
        <EditPlanDialog
          memberId={memberId}
          plans={list}
          onSaved={plans.reload}
          onPublished={(plan) => navigate(`/staff/members/${memberId}/plans/${plan.id}`)}
        />
      ) : null}
    </StaffShell>
  );
}

export function PlanPageScreen({ memberId, planId }: { memberId: string; planId: string }) {
  const plans = useLoad(() => getJson(`/api/members/${memberId}/plans`, PlansListAnswer), `plan-page-${memberId}`);
  const blends = useLoad(() => getJson(`/api/members/${memberId}/blends`, BlendsAnswer), `plan-page-blends-${memberId}`);
  if (plans.failed?.status === 404) return notFoundStaff();
  const published = (plans.data?.plans ?? []).filter((plan) => plan.state === "published");
  const plan = published.find((entry) => entry.id === planId);
  if (plans.data && !plan) return notFoundStaff();
  const isLatest = published[0]?.id === planId;
  return (
    <StaffShell>
      {plan ? (
        <>
          <section className="page-head">
            <PageHeading>{`Plan published ${plan.publishedAt ? formatDateIn(plan.publishedAt, "phoenix") : ""}`}</PageHeading>
            <ActionBar><Link to={`/staff/members/${memberId}/plan`} className="button button-primary">Back to plan</Link></ActionBar>
          </section>
          <div className="stack">
            <p className="byline">Published {plan.publishedAt ? formatDateIn(plan.publishedAt, "phoenix") : ""} by {plan.publishedBy}</p>
            <PlanSectionsView sections={plan.sections} blend={isLatest ? (blends.data?.blends[0] ?? null) : plan.blend} />
          </div>
        </>
      ) : <Skeleton />}
    </StaffShell>
  );
}

// Blends on the staff side.

export function StaffBlendScreen({ memberId, blendId }: { memberId: string; blendId: string | null }) {
  const member = useMember(memberId);
  const blends = useLoad(() => getJson(`/api/members/${memberId}/blends`, BlendsAnswer), `staff-blends-${memberId}`);
  if (member.failed?.status === 404 || blends.failed?.status === 404) return notFoundStaff();
  const name = member.data?.member.name;
  const all = blends.data?.blends;
  if (all && blendId && !all.some((blend) => blend.id === blendId)) return notFoundStaff();
  return (
    <StaffShell>
      {name && all ? (
        <BlendScreen
          key={blendId ?? "current"}
          memberId={memberId}
          memberName={name}
          startFrom={(blendId ? all.find((blend) => blend.id === blendId) : all[0]) ?? null}
        />
      ) : <Skeleton />}
    </StaffShell>
  );
}

// Care messages on the staff side.

export function StaffThreadScreen({ memberId }: { memberId: string }) {
  const member = useMember(memberId);
  const messages = useLoad(() => getJson(`/api/members/${memberId}/messages`, MessagesAnswer), `thread-${memberId}`);
  const handled = useAction();
  if (member.failed?.status === 404 || messages.failed?.status === 404) return notFoundStaff();
  const name = member.data?.member.name;
  return (
    <StaffShell>
      {name && (messages.data || messages.failed) ? (
        <>
          <section className="page-head"><PageHeading>{`Messages with ${name}`}</PageHeading></section>
          <div className="stack">
            <section className="card"><MessageLog messages={messages.data?.messages ?? []} /></section>
            <MessageForm
              path={`/api/members/${memberId}/messages`}
              form={`reply-${memberId}`}
              field="Reply"
              button="Send reply"
              sentCopy="Reply sent."
              onSent={messages.reload}
              extra={<Button kind="secondary" action={handled} onClick={() => void handled.run(async () => {
                await sendNoAnswer("POST", `/api/members/${memberId}/messages/handled`, {});
                return "Thread marked handled.";
              })}>Mark handled</Button>}
            />
          </div>
        </>
      ) : <Skeleton />}
    </StaffShell>
  );
}

export function CareMessagesScreen() {
  const threads = useLoad(() => getJson("/api/message-threads", ThreadsAnswer), "threads");
  const list = threads.data?.threads ?? [];
  const oldestOpen = list.find((thread) => thread.state === "open");
  return (
    <StaffShell>
      <section className="page-head">
        <PageHeading>Care messages</PageHeading>
        <ActionBar>{oldestOpen ? <Link to={`/staff/members/${oldestOpen.memberId}/messages`} className="button button-primary">Open oldest open thread</Link> : <span role="link" aria-disabled="true" className="button button-primary">Open oldest open thread</span>}</ActionBar>
      </section>
      <section className="card">
        {list.length === 0 ? <div className="empty"><MessageGlyph size={40} /><p>No care threads yet.</p></div> : (
          <ul className="row-list">
            {list.map((thread) => (
              <li key={thread.memberId}>
                <Link to={`/staff/members/${thread.memberId}/messages`} className="row-link">{thread.memberName}</Link>
                <span className="muted">{formatDateIn(thread.lastMessageAt, "phoenix")}</span>
                <StatePill>{THREAD_STATE_LABEL[thread.state]}</StatePill>
              </li>
            ))}
          </ul>
        )}
      </section>
    </StaffShell>
  );
}

// The draw calendar: a week in Phoenix time from 1100 px wide, one day below that.

const SUNDAY = 0;

function mondayOf(date: string): string {
  const weekday = weekdayOf(date);
  return addDays(date, weekday === SUNDAY ? -6 : 1 - weekday);
}

function DrawLink({ draw }: { draw: DrawView }) {
  return (
    <div className="calendar-draw">
      <Link to={`/staff/draws/${draw.id}`} className="row-link">{staffLine(draw)}</Link>
      <span className="muted">{draw.memberName}</span>
    </div>
  );
}

export function CalendarScreen() {
  const weekView = useMedia("(min-width: 1100px)");
  const [anchor, setAnchor] = useState<string | null>(null);
  const today = localDate(serverNow(), "phoenix");
  const shown = anchor ?? today;
  const from = weekView ? mondayOf(shown) : shown;
  const to = weekView ? addDays(from, 5) : shown;
  const draws = useLoad(() => getJson(`/api/draws?from=${from}&to=${to}`, DrawsAnswer), `calendar-${from}-${to}`);
  const list = draws.data?.draws ?? [];
  const onDay = (date: string): DrawView[] => list.filter((draw) => localDate(new Date(draw.startsAt), "phoenix") === date);
  const days = weekView ? Array.from({ length: 6 }, (_, index) => addDays(from, index)) : [shown];
  const step = weekView ? 7 : 1;
  const rows = [...new Set(list.map((draw) => wholeHour(new Date(draw.startsAt))))].sort();
  return (
    <StaffShell>
      <section className="page-head">
        <PageHeading>Draw calendar</PageHeading>
        <ActionBar><OpenerButton dialog="book-draw">Book draw</OpenerButton></ActionBar>
      </section>
      <section className="card">
        <div className="calendar-nav">
          <Button kind="secondary" onClick={() => setAnchor(addDays(shown, -step))}>{weekView ? "Previous week" : "Previous day"}</Button>
          <p className="calendar-title">{weekView ? `${formatDate(from)} to ${formatDate(to)}` : formatDate(shown)}</p>
          <Button kind="secondary" onClick={() => setAnchor(addDays(shown, step))}>{weekView ? "Next week" : "Next day"}</Button>
        </div>
        {weekView ? (
          <table className="calendar-week" aria-label="Draws this week in Phoenix time">
            <thead>
              <tr><th scope="col">Phoenix time</th>{days.map((day) => <th key={day} scope="col">{formatDate(day)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((hour) => (
                <tr key={hour}>
                  <th scope="row">{hour}</th>
                  {days.map((day) => (
                    <td key={day}>{onDay(day).filter((draw) => wholeHour(new Date(draw.startsAt)) === hour).map((draw) => <DrawLink key={draw.id} draw={draw} />)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="calendar-day">
            {onDay(shown).length === 0 ? <div className="empty"><TubeGlyph size={40} /><p>No draws on this day.</p></div> : null}
            {onDay(shown).map((draw) => <DrawLink key={draw.id} draw={draw} />)}
          </div>
        )}
        {weekView && rows.length === 0 ? <div className="empty empty-week"><TubeGlyph size={40} /><p>No draws this week.</p></div> : null}
      </section>
      <StaffBookDraw member={null} chooseMember />
    </StaffShell>
  );
}

function wholeHour(instant: Date): string {
  return `${localTime(instant, "phoenix").slice(0, 2)}:00`;
}

// One draw.

function PreviewTable({ rows }: { rows: readonly PreviewRow[] }) {
  return (
    <div role="region" aria-label="Preview rows" tabIndex={0} className="table-frame">
      <table aria-label="Preview">
        <thead><tr><th scope="col">Row</th><th scope="col">Kit code</th><th scope="col">Marker</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Status</th><th scope="col">Reason</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.row}>
              <td>{row.row}</td><td>{row.kitCode ?? ""}</td><td>{row.source?.marker ?? ""}</td><td>{row.value ?? ""}</td><td>{row.unit ?? ""}</td><td>{row.status}</td><td>{row.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BringInResultsDialog({ draw, onSaved }: { draw: DrawView; onSaved: () => Promise<void> }) {
  const action = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const reportInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<readonly PreviewRow[] | null>(null);
  const preview = (): void => {
    void action.run(async () => {
      const file = fileInput.current?.files?.[0];
      const parts = new FormData();
      if (file) parts.set("file", file);
      const answer = await upload(`/api/draws/${draw.id}/results-file/preview`, parts, PreviewAnswer);
      setRows(answer.rows);
      const count = (status: PreviewRow["status"]): number => answer.rows.filter((row) => row.status === status).length;
      return `${count("matched")} matched, ${count("unknown")} unknown, ${count("refused")} refused. Nothing is saved yet.`;
    });
  };
  const save = (): void => {
    void action.run(async () => {
      const file = fileInput.current?.files?.[0];
      const report = reportInput.current?.files?.[0];
      const parts = new FormData();
      if (file) parts.set("file", file);
      if (report) parts.set("report", report);
      await upload(`/api/draws/${draw.id}/results-file`, parts, ResultsFileAnswer);
      await onSaved();
      closeDialog();
      return "Results saved and the report is stored.";
    });
  };
  return (
    <Dialog id="bring-in-results" title="Bring in results" action={action}>
      <div className="stack">
        <div className="field"><label htmlFor="results-file">Results file</label><input ref={fileInput} id="results-file" type="file" /></div>
        <div className="field"><label htmlFor="report-pdf">Report PDF</label><input ref={reportInput} id="report-pdf" type="file" /></div>
        <Button kind="secondary" action={action} onClick={preview}>Preview</Button>
        {rows ? <PreviewTable rows={rows} /> : null}
        <Button action={action} onClick={save}>Save results</Button>
      </div>
    </Dialog>
  );
}

export function StaffDrawScreen({ drawId }: { drawId: string }) {
  const role = useRole();
  const draw = useLoad(() => getJson(`/api/draws/${drawId}`, DrawAnswer), `draw-${drawId}`);
  const visitAction = useAction();
  const releaseAction = useAction();
  if (draw.failed?.status === 404) return notFoundStaff();
  const data = draw.data?.draw;
  const firstName = data?.memberName?.trim().split(/\s+/)[0] ?? "";
  return (
    <StaffShell>
      {data ? (
        <>
          <section className="page-head">
            <PageHeading>{`Draw for ${data.memberName ?? ""} on ${formatDate(data.localDate)}`}</PageHeading>
            <ActionBar>
              {data.state === "collected" ? <OpenerButton dialog="bring-in-results">Bring in results</OpenerButton> : null}
              {data.state === "ready" && canSpecialize(role) ? (
                <Button action={releaseAction} onClick={() => void releaseAction.run(async () => {
                  await sendJson("POST", `/api/draws/${data.id}/release`, {}, DrawAnswer);
                  await draw.reload();
                  return `Results released. A notice is on its way to ${firstName}.`;
                })}>Release results</Button>
              ) : null}
              {data.state === "booked" && canBook(role) ? (
                <Button action={visitAction} onClick={() => void visitAction.run(async () => {
                  await sendNoAnswer("POST", `/api/draws/${data.id}/visit-page`, {});
                  await draw.reload();
                  return `A new visit page is on its way to ${data.phlebotomistName}.`;
                })}>Send new visit page</Button>
              ) : null}
            </ActionBar>
          </section>
          <div className="stack">
            <Problems form="draw-actions" action={visitAction} />
            <Problems form="draw-actions" action={releaseAction} />
            <section className="card">
              <StatePill>{DRAW_STATE_LABEL[data.state]}</StatePill>
              <dl className="details">
                <dt>Time</dt><dd>{staffLine(data)}</dd>
                <dt>Phlebotomist</dt><dd>{data.phlebotomistName}</dd>
                <dt>Visit page</dt><dd>{{ live: "Live", ended: "Ended", none: "None" }[data.visitPage.state]}</dd>
                {data.kitCodes.length > 0 ? <><dt>Kit codes</dt><dd>{data.kitCodes.join(", ")}</dd></> : null}
                {data.collectedAt ? <><dt>Collected</dt><dd>{formatDateIn(data.collectedAt, "phoenix")}</dd></> : null}
              </dl>
              <div className="button-row">
                {canBook(role) && data.state === "booked" ? <OpenerButton dialog="move-draw" kind="secondary">Move draw</OpenerButton> : null}
                {canBook(role) && data.state === "booked" ? <OpenerButton dialog="cancel-draw" kind="secondary">Cancel draw</OpenerButton> : null}
                {canBook(role) && data.visitPage.state === "live" ? (
                  <Button kind="secondary" action={visitAction} onClick={() => void visitAction.run(async () => {
                    await sendNoAnswer("DELETE", `/api/draws/${data.id}/visit-page`);
                    await draw.reload();
                    return "Visit page ended.";
                  })}>End visit page</Button>
                ) : null}
                {data.state === "ready" ? <a className="text-link" href={`/api/draws/${data.id}/report`}>Open the report PDF</a> : null}
              </div>
            </section>
          </div>
          {data.state === "collected" ? <BringInResultsDialog draw={data} onSaved={draw.reload} /> : null}
          {data.state === "booked" ? <MoveDrawDialog draw={data} audience="staff" onMoved={draw.reload} /> : null}
          {data.state === "booked" ? <CancelDrawDialog draw={data} audience="staff" onCancelled={draw.reload} /> : null}
        </>
      ) : <Skeleton />}
    </StaffShell>
  );
}

export function ResultsToReleaseScreen() {
  const draws = useLoad(() => getJson("/api/draws?state=ready", DrawsAnswer), "ready-draws");
  const list = draws.data?.draws ?? [];
  const next = list[0];
  return (
    <StaffShell>
      <section className="page-head">
        <PageHeading>Results to release</PageHeading>
        <ActionBar>{next ? <Link to={`/staff/draws/${next.id}`} className="button button-primary">Open next draw</Link> : <span role="link" aria-disabled="true" className="button button-primary">Open next draw</span>}</ActionBar>
      </section>
      <section className="card">
        {list.length === 0 ? <div className="empty"><BandGlyph size={40} /><p>Nothing is waiting to be released.</p></div> : (
          <ul className="row-list">
            {list.map((draw) => <li key={draw.id}><Link to={`/staff/draws/${draw.id}`} className="row-link">{`${draw.memberName ?? ""}, ${staffLine(draw)}`}</Link></li>)}
          </ul>
        )}
      </section>
    </StaffShell>
  );
}

// The range table.

function ChangeRangesDialog({ onSaved }: { onSaved: () => Promise<void> }) {
  const action = useAction();
  return (
    <Dialog id="change-ranges" title="Change ranges" action={action}>
      <ChangeRangesBody action={action} onSaved={onSaved} />
    </Dialog>
  );
}

const ROW_KEYS = ["female", "male"].flatMap((sex) => ["age18To39", "age40To59", "age60Plus"].map((band) => `${sex}|${band}`));

const boundKey = (row: string, bound: string): string => `${row}|${bound}`;

function ChangeRangesBody({ action, onSaved }: { action: Action; onSaved: () => Promise<void> }) {
  const markers = useLoad(() => getJson("/api/markers", MarkersAnswer), "range-markers", false);
  const form = useForm("change-ranges", { marker: "", effectiveFrom: "" });
  const marker = form.value("marker");
  const today = localDate(serverNow(), "phoenix");
  const current = useLoad(async () => (marker ? getJson(`/api/ranges?marker=${marker}&on=${today}`, RangesAnswer) : null), `current-ranges-${marker}`, false);
  useEffect(() => {
    for (const row of current.data?.ranges ?? []) {
      const key = `${row.sex}|${row.ageBand}`;
      form.set(boundKey(key, "low"), row.low);
      form.set(boundKey(key, "high"), row.high);
      form.set(boundKey(key, "optimalLow"), row.optimalLow);
      form.set(boundKey(key, "optimalHigh"), row.optimalHigh);
    }
  }, [current.data]);
  const markerName = (id: string): string => markers.data?.categories.flatMap((category) => category.markers).find((entry) => entry.id === id)?.name ?? id;
  const submit = (): void => {
    void action.run(async () => {
      const ranges: unknown[] = ROW_KEYS.map((key) => {
        const [sex = "", ageBand = ""] = key.split("|");
        return {
          sex,
          ageBand,
          low: form.value(boundKey(key, "low")),
          high: form.value(boundKey(key, "high")),
          optimalLow: form.value(boundKey(key, "optimalLow")),
          optimalHigh: form.value(boundKey(key, "optimalHigh")),
        };
      });
      const effectiveFrom = form.value("effectiveFrom");
      await sendNoAnswer("POST", "/api/range-changes", { marker, effectiveFrom, ranges });
      await onSaved();
      closeDialog();
      return `New ranges for ${markerName(marker)} take effect on ${formatDate(effectiveFrom)}.`;
    });
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <SelectField form={form} name="marker" label="Marker" problem={action.problem} prompt="Choose a marker" choices={(markers.data?.categories ?? []).flatMap((category) => category.markers).map((entry) => ({ value: entry.id, label: entry.name }))} />
      <TextField form={form} name="effectiveFrom" label="Takes effect on" problem={action.problem} hint="As YYYY-MM-DD" />
      {ROW_KEYS.map((key) => {
        const [sex = "female", band = "age18To39"] = key.split("|");
        const label = `${sex === "female" ? SEX_LABEL.female : SEX_LABEL.male} ${band === "age18To39" ? AGE_BAND_LABEL.age18To39 : band === "age40To59" ? AGE_BAND_LABEL.age40To59 : AGE_BAND_LABEL.age60Plus}`;
        return (
          <fieldset key={key} className="bound-row">
            <legend>{label}</legend>
            <TextField form={form} name={boundKey(key, "low")} label={`Low, ${label}`} problem={action.problem} />
            <TextField form={form} name={boundKey(key, "high")} label={`High, ${label}`} problem={action.problem} />
            <TextField form={form} name={boundKey(key, "optimalLow")} label={`Optimal low, ${label}`} problem={action.problem} />
            <TextField form={form} name={boundKey(key, "optimalHigh")} label={`Optimal high, ${label}`} problem={action.problem} />
          </fieldset>
        );
      })}
      <Button type="submit" action={action}>Save ranges</Button>
    </form>
  );
}

function RangesTable({ rows }: { rows: readonly RangeRow[] }) {
  return (
    <div role="region" aria-label="Ranges in force" tabIndex={0} className="table-frame">
      <table aria-label="Ranges in force">
        <thead><tr><th scope="col">Sex</th><th scope="col">Age</th><th scope="col">Low</th><th scope="col">High</th><th scope="col">Optimal low</th><th scope="col">Optimal high</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.sex}-${row.ageBand}`}>
              <td>{SEX_LABEL[row.sex]}</td><td>{AGE_BAND_LABEL[row.ageBand]}</td><td>{row.low}</td><td>{row.high}</td><td>{row.optimalLow}</td><td>{row.optimalHigh}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RangesScreen() {
  const changes = useLoad(() => getJson("/api/range-changes", RangeChangesAnswer), "range-changes");
  const markers = useLoad(() => getJson("/api/markers", MarkersAnswer), "marker-names", false);
  const form = useForm("ranges-view", { marker: "ldl" });
  const marker = form.value("marker");
  const tableShown = useRef(false);
  const today = localDate(serverNow(), "phoenix");
  const ranges = useLoad(() => getJson(`/api/ranges?marker=${marker}&on=${today}`, RangesAnswer), `ranges-${marker}`);
  const all = (markers.data?.categories ?? []).flatMap((category) => category.markers);
  const nameOf = (id: string): string => all.find((entry) => entry.id === id)?.name ?? id;
  // The changes card waits for the first table, which would push it down a screen.
  if (ranges.data) tableShown.current = true;
  return (
    <StaffShell>
      <section className="page-head">
        <PageHeading>Range table</PageHeading>
        <ActionBar><OpenerButton dialog="change-ranges">Change ranges</OpenerButton></ActionBar>
      </section>
      <div className="stack">
        <section className="card stack">
          <div className="narrow"><SelectField form={form} name="marker" label="Show marker" problem={null} choices={all.map((entry) => ({ value: entry.id, label: entry.name }))} /></div>
          {ranges.data ? (
            <>
              <p className="muted">In force from {formatDate(ranges.data.effectiveFrom)}</p>
              <RangesTable rows={ranges.data.ranges} />
            </>
          ) : <Skeleton blocks={1} />}
        </section>
        {tableShown.current ? (
          <section className="card">
            <h2>Range changes</h2>
            <ul className="row-list">
              {(changes.data?.changes ?? []).map((change) => (
                <li key={change.id}><span>{nameOf(change.marker)} from {formatDate(change.effectiveFrom)}</span><span className="muted">{change.createdBy}</span></li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <ChangeRangesDialog onSaved={async () => {
        await changes.reload();
        await ranges.reload();
      }} />
    </StaffShell>
  );
}

// Receipts.

export function ReceiptsScreen() {
  const currentMonth = localDate(serverNow(), "phoenix").slice(0, 7);
  const form = useForm("receipts", { month: currentMonth });
  const typed = form.value("month");
  const [month, setMonth] = useState(currentMonth);
  const [cursor, setCursor] = useState<string | null>(null);
  const action = useAction();
  const load = useLoad(() => getJson(`/api/receipts?month=${encodeURIComponent(month)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, ReceiptPageAnswer), `receipts-${month}-${cursor ?? ""}`);
  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(typed) && typed !== month) {
      setMonth(typed);
      setCursor(null);
    }
  }, [typed, month]);
  const failure = load.failed;
  const { refuse } = action;
  useEffect(() => {
    if (failure && failure.status === 422) refuse(failure.message, true);
  }, [failure, refuse]);
  // The rows on screen stay until the next page answers, so paging never flashes an empty table.
  const shownPage = useRef<ReceiptPage | null>(null);
  if (load.data) shownPage.current = load.data;
  if (failure) shownPage.current = null;
  const page = shownPage.current;
  return (
    <StaffShell>
      <section className="page-head"><PageHeading>Receipts</PageHeading></section>
      <section className="card stack">
        <Problems form="receipts" action={action} />
        <form className="narrow" noValidate onSubmit={onSubmit(() => {
          if (typed !== month) {
            setMonth(typed);
            setCursor(null);
          }
        })}>
          <TextField form={form} name="month" label="Month" problem={action.problem} hint="As YYYY-MM" />
        </form>
        <ReceiptsTable receipts={page?.receipts ?? []} />
        <ActionBar>
          <Button disabled={!page?.nextCursor} onClick={() => setCursor(page?.nextCursor ?? null)}>Next page</Button>
        </ActionBar>
      </section>
    </StaffShell>
  );
}

export function ReceiptPageScreen({ receiptId, memberView }: { receiptId: string; memberView: boolean }) {
  const receipt = useLoad(() => getJson(`/api/receipts/${receiptId}`, ReceiptAnswer), `receipt-${receiptId}`);
  if (receipt.failed?.status === 404) return notFoundStaff();
  const data = receipt.data?.receipt;
  const Shell = memberView ? MemberShell : StaffShell;
  return <Shell>{data ? <ReceiptDocument receipt={data} /> : <Skeleton />}</Shell>;
}

function ReceiptDocument({ receipt }: { receipt: ReceiptView }) {
  return (
    <>
      <section className="page-head">
        <PageHeading>{`Receipt ${receipt.number}`}</PageHeading>
        <ActionBar><Button onClick={() => window.print()}>Print receipt</Button></ActionBar>
      </section>
      <section className="card stack receipt">
        <div>
          <h2>{receipt.practice.name}</h2>
          <p>{receipt.practice.address}</p>
          <p>Tax number {receipt.practice.taxNumber}</p>
        </div>
        <dl className="details">
          <dt>Member</dt><dd>{receipt.memberName}</dd>
          <dt>Paid date</dt><dd>{formatDate(receipt.paidDate)}</dd>
        </dl>
        <div role="region" aria-label="Receipt lines" tabIndex={0} className="table-frame">
          <table aria-label="Receipt lines">
            <thead><tr><th scope="col">Item</th><th scope="col">Period</th><th scope="col">Amount</th></tr></thead>
            <tbody>
              {receipt.items.map((item, index) => (
                <tr key={index}>
                  <td>{item.description}</td>
                  <td>{item.periodStart ? formatDate(item.periodStart) : ""}{item.periodEnd ? ` to ${formatDate(item.periodEnd)}` : ""}</td>
                  <td>{formatCents(item.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="receipt-total"><span>Total {formatCents(receipt.amountCents)}</span> <StatePill tone="good">Paid</StatePill></p>
      </section>
    </>
  );
}

// The team.

function AddStaffDialog({ onAdded }: { onAdded: () => Promise<void> }) {
  const action = useAction();
  return (
    <Dialog id="add-staff" title="Add staff member" action={action}>
      <AddStaffBody action={action} onAdded={onAdded} />
    </Dialog>
  );
}

const STAFF_ROLE_CHOICES = [
  { value: "specialist", label: ROLE_LABEL.specialist },
  { value: "coordinator", label: ROLE_LABEL.coordinator },
  { value: "billingLead", label: ROLE_LABEL.billingLead },
];

function AddStaffBody({ action, onAdded }: { action: Action; onAdded: () => Promise<void> }) {
  const form = useForm("add-staff", { name: "", email: "", password: "", role: "coordinator" });
  const submit = (): void => {
    void action.run(async () => {
      const name = form.value("name");
      await sendNoAnswer("POST", "/api/staff", { name, email: form.value("email"), password: form.value("password"), role: form.value("role") });
      await onAdded();
      closeDialog();
      return `${name} added.`;
    });
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <TextField form={form} name="name" label="Full name" problem={action.problem} />
      <TextField form={form} name="email" label="Email" type="email" problem={action.problem} />
      <TextField form={form} name="password" label="Starting password" type="password" problem={action.problem} autoComplete="new-password" />
      <SelectField form={form} name="role" label="Role" problem={action.problem} choices={STAFF_ROLE_CHOICES} />
      <Button type="submit" action={action}>Save staff member</Button>
    </form>
  );
}

function TeamRow({ person, onChanged }: { person: StaffView; onChanged: () => Promise<void> }) {
  const action = useAction();
  const form = useForm(`team-${person.id}`, { role: person.role });
  return (
    <li className="team-row">
      <div>
        <p className="ingredient-name">{person.name}</p>
        <p className="muted">{person.email}</p>
      </div>
      {person.role === "owner" ? <StatePill>{ROLE_LABEL.owner}</StatePill> : (
        <>
          <div className="field field-inline">
            <label htmlFor={`team-${person.id}-role`}>{`Role of ${person.name}`}</label>
            <select
              id={`team-${person.id}-role`}
              value={form.value("role")}
              onChange={(event) => {
                const role = event.target.value;
                form.set("role", role);
                void action.run(async () => {
                  await sendNoAnswer("PATCH", `/api/staff/${person.id}`, { role });
                  await onChanged();
                  return `${person.name} is now a ${STAFF_ROLE_CHOICES.find((choice) => choice.value === role)?.label.toLowerCase() ?? role}.`;
                });
              }}
            >
              {STAFF_ROLE_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </div>
          <Button kind="secondary" action={action} onClick={() => void action.run(async () => {
            await sendNoAnswer("DELETE", `/api/staff/${person.id}`);
            await onChanged();
            return `${person.name} removed.`;
          })}>{`Remove ${person.name}`}</Button>
        </>
      )}
    </li>
  );
}

export function TeamScreen() {
  const team = useLoad(() => getJson("/api/staff", StaffListAnswer), "team");
  return (
    <StaffShell>
      <section className="page-head">
        <PageHeading>Team</PageHeading>
        <ActionBar><OpenerButton dialog="add-staff">Add staff member</OpenerButton></ActionBar>
      </section>
      <section className="card">
        {!team.data ? <Skeleton blocks={1} /> : (
          <ul className="team-list">
            {team.data.staff.map((person) => <TeamRow key={person.id} person={person} onChanged={team.reload} />)}
          </ul>
        )}
      </section>
      <AddStaffDialog onAdded={team.reload} />
    </StaffShell>
  );
}

