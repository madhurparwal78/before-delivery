// The member pages.

import { useState } from "react";
import { DrawsAnswer, MaybePlanAnswer, MemberSelfAnswer, MembershipAnswer, MessageAnswer, MessagesAnswer, NoBlendOrBlendAnswer, ReceiptListAnswer, ResultsAnswer, type BlendView, type DrawView, type MemberView, type Membership, type MessageView, type PlanSections, type ReceiptItem } from "../shared/api";
import { dateTimeIn, formatCents, formatDate, formatDateIn } from "../shared/format";
import { ingredientName, PACKET_CAPSULES } from "../shared/ingredients";
import { CADENCE_LABEL, DRAW_STATE_LABEL, MEMBERSHIP_LABEL } from "../shared/labels";
import { cityOf } from "../shared/time";
import { download, getJson, sendJson, upload } from "./api";
import { ResultsList } from "./band";
import { CancelDrawDialog, MemberBookDraw, MoveDrawDialog } from "./drawDialogs";
import { BandGlyph, BandIllustration, MembershipGlyph, MessageGlyph, PacketGlyph, PlansGlyph, TubeGlyph } from "./glyphs";
import { CADENCE_CHOICES } from "./screensPublic";
import { ChangePasswordDialog, firstNameOf, MemberShell } from "./shells";
import { closeDialog, navigate, openDialog, useSession } from "./stores";
import { ActionBar, Button, Dialog, Link, onSubmit, OpenerButton, PageHeading, Problems, RadioGroup, Skeleton, StatePill, TextArea, TextField, useAction, useForm, useLoad, type Action } from "./ui";


function membershipLine(membership: Membership): string | null {
  if (membership.state === "cancelled" && membership.plusUntil) return `Plus until ${formatDate(membership.plusUntil)}`;
  if (membership.pendingCadence && membership.pendingFrom) return `${CADENCE_LABEL[membership.pendingCadence]} from ${formatDate(membership.pendingFrom)}`;
  if (membership.renewalDate) return `Renews ${formatDate(membership.renewalDate)}`;
  return null;
}

export function MembershipState({ membership }: { membership: Membership }) {
  const line = membershipLine(membership);
  return (
    <div data-part="membership-state" className="membership-state">
      <p className="membership-label">{MEMBERSHIP_LABEL[membership.state]}</p>
      {line ? <p>{line}</p> : null}
    </div>
  );
}

function useMe() {
  return useLoad(() => getJson("/api/me", MemberSelfAnswer), "me");
}

function drawLine(draw: DrawView): string {
  return `${formatDate(draw.localDate)}, ${draw.localTime} ${cityOf(draw.timeZone)} time`;
}

// Home.

export function MemberHomeScreen() {
  const session = useSession();
  const me = useMe();
  const draws = useLoad(() => getJson("/api/me/draws", DrawsAnswer), "my-draws");
  const name = session.kind === "live" ? firstNameOf(session.view.user.name) : "";
  const next = (draws.data?.draws ?? []).filter((draw) => draw.state === "booked").at(-1);
  return (
    <MemberShell>
      <section className="page-head">
        <PageHeading>{`Welcome, ${name}`}</PageHeading>
        <ActionBar><Link to="/me/draws" className="button button-primary">Book a draw</Link></ActionBar>
      </section>
      <div className="two-columns">
        <article className="card">
          <span className="card-glyph"><MembershipGlyph size={32} /></span>
          <h2>Membership</h2>
          {me.data ? <MembershipState membership={me.data.member.membership} /> : <div className="skeleton skeleton-line" />}
          <Link to="/me/membership" className="text-link">See your membership</Link>
        </article>
        <article className="card">
          <span className="card-glyph"><TubeGlyph size={32} /></span>
          <h2>Next draw</h2>
          {next ? <p>{drawLine(next)}</p> : <p className="muted">No draw booked yet.</p>}
          <Link to="/me/draws" className="text-link">See your draws</Link>
        </article>
        <article className="card">
          <BandIllustration />
          <h2>Results</h2>
          <p className="muted">Every released draw, read on the marker band.</p>
          <Link to="/me/results" className="text-link">Read your results</Link>
        </article>
        <article className="card">
          <span className="card-glyph"><PacketGlyph size={32} /></span>
          <h2>Plan and blend</h2>
          <p className="muted">Your longevity plan with today's morning and evening packets.</p>
          <Link to="/me/plan" className="text-link">Read your plan</Link>
        </article>
      </div>
    </MemberShell>
  );
}

// Membership.

function JoinDialog({ onDone }: { onDone: () => Promise<void> }) {
  const action = useAction();
  return (
    <Dialog id="join-plus" title="Join Plus" action={action}>
      <JoinBody action={action} onDone={onDone} />
    </Dialog>
  );
}

function JoinBody({ action, onDone }: { action: Action; onDone: () => Promise<void> }) {
  const form = useForm("join-plus", { cadence: "sixMonths" });
  const [requestKey] = useState(() => crypto.randomUUID());
  const submit = (): void => {
    void action.run(async () => {
      const answer = await fetchJoin(form.value("cadence"), requestKey);
      await onDone();
      closeDialog();
      return answer.state === "active"
        ? "Welcome to Plus. Your membership is active."
        : "Your payment is being confirmed. Plus shows Active once it is.";
    });
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <RadioGroup form={form} name="cadence" label="Billing cadence" problem={action.problem} choices={CADENCE_CHOICES} />
      <Button type="submit" action={action}>Confirm and join</Button>
    </form>
  );
}

async function fetchJoin(cadence: string, requestKey: string): Promise<Membership> {
  return (await sendJson("POST", "/api/me/membership", { cadence }, MembershipAnswer, { "Request-Key": requestKey })).membership;
}

function ChangeCadenceDialog({ current, onDone }: { current: string; onDone: () => Promise<void> }) {
  const action = useAction();
  return (
    <Dialog id="change-cadence" title="Change cadence" action={action}>
      <ChangeCadenceBody action={action} current={current} onDone={onDone} />
    </Dialog>
  );
}

function ChangeCadenceBody({ action, current, onDone }: { action: Action; current: string; onDone: () => Promise<void> }) {
  const form = useForm("change-cadence", { cadence: current });
  const submit = (): void => {
    void action.run(async () => {
      await sendJson("PATCH", "/api/me/membership", { cadence: form.value("cadence") }, MembershipAnswer);
      await onDone();
      closeDialog();
      return "Your cadence changes at your next renewal.";
    });
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <RadioGroup form={form} name="cadence" label="Billing cadence" problem={action.problem} choices={CADENCE_CHOICES} />
      <Button type="submit" action={action}>Confirm change</Button>
    </form>
  );
}

function CancelPlusDialog({ onDone }: { onDone: () => Promise<void> }) {
  const action = useAction();
  const confirm = (): void => {
    void action.run(async () => {
      await sendJson("POST", "/api/me/membership/cancel", {}, MembershipAnswer);
      await onDone();
      closeDialog();
      return "Plus stays until the end of your paid period.";
    });
  };
  return (
    <Dialog id="cancel-plus" title="Cancel Plus" action={action}>
      <p>Plus stays until the end of your paid period.</p>
      <div className="button-row">
        <Button action={action} onClick={confirm}>Yes, cancel Plus</Button>
        <Button kind="secondary" onClick={closeDialog}>Keep Plus</Button>
      </div>
    </Dialog>
  );
}

export function MembershipScreen() {
  const membership = useLoad(() => getJson("/api/me/membership", MembershipAnswer), "my-membership");
  const current = membership.data?.membership;
  const isFree = current?.state === "free";
  return (
    <MemberShell>
      <section className="page-head">
        <PageHeading>Membership</PageHeading>
        {current ? (
          <ActionBar>
            {isFree ? <OpenerButton key="join" dialog="join-plus">Join Plus</OpenerButton> : <OpenerButton key="change" dialog="change-cadence">Change cadence</OpenerButton>}
          </ActionBar>
        ) : null}
      </section>
      <section className="card">
        {current ? <MembershipState membership={current} /> : <Skeleton blocks={1} />}
        {current && (current.state === "active" || current.state === "pending") ? <OpenerButton dialog="cancel-plus" kind="secondary">Cancel Plus</OpenerButton> : null}
      </section>
      <JoinDialog onDone={membership.reload} />
      <ChangeCadenceDialog current={current?.cadence ?? "sixMonths"} onDone={membership.reload} />
      <CancelPlusDialog onDone={membership.reload} />
    </MemberShell>
  );
}

// Draws.

export function MemberDrawsScreen() {
  const draws = useLoad(() => getJson("/api/me/draws", DrawsAnswer), "my-draws");
  const me = useMe();
  return (
    <MemberShell>
      <section className="page-head">
        <PageHeading>Your draws</PageHeading>
        <ActionBar><OpenerButton dialog="book-draw">Book a draw</OpenerButton></ActionBar>
      </section>
      <section className="card">
        {!draws.data ? <Skeleton blocks={1} /> : draws.data.draws.length === 0 ? (
          <div className="empty"><TubeGlyph size={40} /><p>No draws yet. Book a fasting morning draw at your door.</p></div>
        ) : (
          <ul className="row-list">
            {draws.data.draws.map((draw) => (
              <li key={draw.id}>
                <Link to={`/me/draws/${draw.id}`} className="row-link">{drawLine(draw)}</Link>
                <StatePill>{DRAW_STATE_LABEL[draw.state]}</StatePill>
              </li>
            ))}
          </ul>
        )}
      </section>
      {me.data?.member.timeZone ? <MemberBookDraw zone={me.data.member.timeZone} /> : null}
    </MemberShell>
  );
}

export function MemberDrawScreen({ drawId, notFound }: { drawId: string; notFound: () => React.ReactNode }) {
  const draws = useLoad(() => getJson("/api/me/draws", DrawsAnswer), `my-draw-${drawId}`);
  const draw = draws.data?.draws.find((entry) => entry.id === drawId);
  if (draws.data && !draw) return notFound();
  return (
    <MemberShell>
      {draw ? (
        <>
          <section className="page-head">
            <PageHeading>{`Draw on ${formatDate(draw.localDate)}`}</PageHeading>
            {draw.state === "booked" ? <ActionBar><OpenerButton dialog="move-draw">Move draw</OpenerButton></ActionBar> : null}
          </section>
          <section className="card">
            <StatePill>{DRAW_STATE_LABEL[draw.state]}</StatePill>
            <dl className="details">
              <dt>Time</dt><dd>{drawLine(draw)}</dd>
              <dt>Phlebotomist</dt><dd>{draw.phlebotomistName}</dd>
              {draw.state === "booked" ? <><dt>Changes close</dt><dd>{dateTimeIn(draw.changesCloseAt, draw.timeZone)}</dd></> : null}
              {draw.kitCodes.length > 0 ? <><dt>Kit codes</dt><dd>{draw.kitCodes.join(", ")}</dd></> : null}
            </dl>
            {draw.state === "booked" ? <OpenerButton dialog="cancel-draw" kind="secondary">Cancel draw</OpenerButton> : null}
          </section>
          <MoveDrawDialog draw={draw} audience="member" onMoved={draws.reload} />
          <CancelDrawDialog draw={draw} audience="member" onCancelled={draws.reload} />
        </>
      ) : <Skeleton />}
    </MemberShell>
  );
}

// Results.

export function MemberResultsScreen() {
  const results = useLoad(() => getJson("/api/me/results", ResultsAnswer), "my-results");
  const me = useMe();
  const zone = me.data?.member.timeZone;
  return (
    <MemberShell>
      <section className="page-head">
        <PageHeading>Your results</PageHeading>
        <ActionBar><Link to="/me/messages" className="button button-primary">Message your care team</Link></ActionBar>
      </section>
      <div className="stack">
        {!results.data || !zone ? <Skeleton /> : results.data.markers.length === 0 ? (
          <section className="card empty"><BandGlyph size={40} /><p>Your results appear here once a specialist releases them.</p></section>
        ) : <ResultsList markers={results.data.markers} zone={zone} dialogPrefix="me" />}
      </div>
    </MemberShell>
  );
}

// Plan.

function PlanText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).filter((block) => block.trim() !== "");
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        return lines.every((line) => line.startsWith("- "))
          ? <ul key={index} className="plan-list">{lines.map((line, at) => <li key={at}>{line.slice(2)}</li>)}</ul>
          : <p key={index}>{block}</p>;
      })}
    </>
  );
}

export function PlanSectionsView({ sections, blend }: { sections: PlanSections; blend: BlendView | null }) {
  return (
    <>
      <section className="card"><h2>Nutrition</h2><PlanText text={sections.nutrition} /></section>
      <section className="card"><h2>Movement</h2><PlanText text={sections.movement} /></section>
      <section className="card"><h2>Sleep</h2><PlanText text={sections.sleep} /></section>
      <section className="card">
        <h2>Supplements</h2>
        <PlanText text={sections.supplements} />
        {blend ? <BlendSummary blend={blend} /> : <p className="muted">No blend yet.</p>}
      </section>
    </>
  );
}

function BlendSummary({ blend }: { blend: BlendView }) {
  return (
    <div className="blend-summary">
      <p><strong>Morning packet:</strong> {blend.morningCapsules} of {PACKET_CAPSULES} capsules. <strong>Evening packet:</strong> {blend.eveningCapsules} of {PACKET_CAPSULES} capsules.</p>
      <ul className="plan-list">
        {blend.items.map((item) => <li key={item.ingredient}>{ingredientName(item.ingredient)}, {item.capsulesPerDay} a day</li>)}
      </ul>
      <p>30-day list price {formatCents(blend.listPriceCents)} · Member price {formatCents(blend.memberPriceCents)}</p>
    </div>
  );
}

export function MemberPlanScreen() {
  const plan = useLoad(() => getJson("/api/me/plan", MaybePlanAnswer), "my-plan");
  const blend = useLoad(() => getJson("/api/me/blend", NoBlendOrBlendAnswer), "my-blend");
  const me = useMe();
  const zone = me.data?.member.timeZone;
  const current = plan.data?.plan;
  return (
    <MemberShell>
      <section className="page-head">
        <PageHeading>Your longevity plan</PageHeading>
        <ActionBar><Link to="/me/messages" className="button button-primary">Message your care team</Link></ActionBar>
      </section>
      <div className="stack">
        {!plan.data ? <Skeleton /> : !current ? (
          <section className="card empty"><PacketGlyph size={40} /><p>Your specialist's plan appears here once it is published.</p></section>
        ) : (
          <>
            {current.publishedAt && zone ? <p className="byline">Published {formatDateIn(current.publishedAt, zone)} by {current.publishedBy}</p> : null}
            <PlanSectionsView sections={current.sections} blend={blend.data?.blend ?? current.blend} />
          </>
        )}
      </div>
    </MemberShell>
  );
}

// Care messages, shared with the staff thread.

export function MessageLog({ messages }: { messages: readonly MessageView[] }) {
  return (
    <div role="log" aria-label="Messages" tabIndex={0} className="message-log">
      {messages.length === 0 ? <div className="empty"><MessageGlyph size={40} /><p>No messages yet.</p></div> : null}
      {messages.map((message) => (
        <article key={message.id} className={message.from.role === "member" ? "message message-member" : "message message-staff"}>
          <p className="message-from">{message.from.name}</p>
          <p className="message-body">{message.body}</p>
          {message.attachment ? (
            <a className="text-link" href={`/api/attachments/${message.attachment.id}`}>
              {message.attachment.kind === "pdf" ? "Open the attached PDF" : "Open the attached photo"}
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function MessageForm({ path, form: formId, field, button, sentCopy, onSent, extra }: { path: string; form: string; field: string; button: string; sentCopy: string; onSent: () => Promise<void>; extra?: React.ReactNode }) {
  const form = useForm(formId, { body: "" });
  const action = useAction();
  const [fileKey, setFileKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const count = [...form.value("body")].length;
  const submit = (): void => {
    void action.run(async () => {
      const parts = new FormData();
      parts.set("body", form.value("body"));
      if (file) parts.set("attachment", file);
      await upload(path, parts, MessageAnswer);
      form.set("body", "");
      setFile(null);
      setFileKey((key) => key + 1);
      await onSent();
      return sentCopy;
    });
  };
  return (
    <form className="card stack" noValidate onSubmit={onSubmit(submit)}>
      <Problems form={formId} action={action} />
      <TextArea form={form} name="body" label={field} problem={action.problem} rows={4} />
      <p className="field-hint">{count.toLocaleString("en-US")} of 2,000 characters</p>
      <div className="field">
        <label htmlFor={`${formId}-attachment`}>Attachment</label>
        <input key={fileKey} id={`${formId}-attachment`} type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </div>
      <div className="button-row">
        <ActionBar><Button type="submit" action={action}>{button}</Button></ActionBar>
        {extra}
      </div>
    </form>
  );
}

export function MemberMessagesScreen() {
  const messages = useLoad(() => getJson("/api/me/messages", MessagesAnswer), "my-messages");
  return (
    <MemberShell>
      <section className="page-head"><PageHeading>Messages</PageHeading></section>
      {messages.data || messages.failed ? (
        <div className="stack">
          <section className="card"><MessageLog messages={messages.data?.messages ?? []} /></section>
          <MessageForm path="/api/me/messages" form="member-message" field="Message" button="Send message" sentCopy="Message sent." onSent={messages.reload} />
        </div>
      ) : <Skeleton />}
    </MemberShell>
  );
}

// Records and receipts.

export function ReceiptsTable({ receipts }: { receipts: readonly ReceiptItem[] }) {
  return (
    <>
      <div role="region" aria-label="Receipts table" tabIndex={0} className="table-frame">
        <table aria-label="Receipts">
          <thead><tr><th scope="col">Receipt</th><th scope="col">Member</th><th scope="col">Paid</th><th scope="col">Amount</th></tr></thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td><Link to={`/receipts/${receipt.id}`} className="row-link">{receipt.number}</Link></td>
                <td>{receipt.memberName}</td>
                <td>{formatDate(receipt.paidDate)}</td>
                <td>{formatCents(receipt.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {receipts.length === 0 ? <div className="empty"><PlansGlyph size={40} /><p>No receipts to show.</p></div> : null}
    </>
  );
}

export function RecordsScreen() {
  const receipts = useLoad(() => getJson("/api/me/receipts", ReceiptListAnswer), "my-receipts");
  const action = useAction();
  return (
    <MemberShell>
      <section className="page-head">
        <PageHeading>Records and receipts</PageHeading>
        <ActionBar>
          <Button action={action} onClick={() => void action.run(async () => {
            await download("/api/me/results-history", "ocotillo-results-history.csv");
            return "Your results history is downloading.";
          })}>Download results history</Button>
        </ActionBar>
      </section>
      <section className="card"><h2>Receipts</h2><ReceiptsTable receipts={receipts.data?.receipts ?? []} /></section>
    </MemberShell>
  );
}

// Account.

function closingCopy(member: MemberView): string | null {
  if (member.accountState !== "closing" || !member.erasesAt || !member.timeZone) return null;
  return `Your account is closing. It will be erased at ${dateTimeIn(member.erasesAt, member.timeZone)} unless the practice brings it back.`;
}

function ProfileForm({ member, onSaved }: { member: MemberView; onSaved: () => Promise<void> }) {
  const form = useForm("profile", {
    phone: member.phone ?? "",
    line1: member.address?.line1 ?? "",
    line2: member.address?.line2 ?? "",
    city: member.address?.city ?? "",
    postalCode: member.address?.postalCode ?? "",
    gateNotes: member.gateNotes ?? "",
  });
  const action = useAction();
  const submit = (): void => {
    void action.run(async () => {
      await sendJson("PATCH", "/api/me", {
        phone: form.value("phone"),
        address: { line1: form.value("line1"), line2: form.value("line2"), city: form.value("city"), postalCode: form.value("postalCode") },
        gateNotes: form.value("gateNotes"),
      }, MemberSelfAnswer);
      await onSaved();
      return "Profile saved.";
    });
  };
  return (
    <form className="card stack" noValidate onSubmit={onSubmit(submit)}>
      <h2>Profile</h2>
      <Problems form="profile" action={action} />
      <TextField form={form} name="phone" label="Phone" type="tel" problem={action.problem} autoComplete="tel" />
      <TextField form={form} name="line1" label="Address line 1" problem={action.problem} autoComplete="address-line1" />
      <TextField form={form} name="line2" label="Address line 2" problem={action.problem} autoComplete="address-line2" />
      <TextField form={form} name="city" label="City" problem={action.problem} autoComplete="address-level2" />
      <TextField form={form} name="postalCode" label="ZIP code" problem={action.problem} autoComplete="postal-code" />
      <TextField form={form} name="gateNotes" label="Gate notes" problem={action.problem} />
      <ActionBar><Button type="submit" action={action}>Save profile</Button></ActionBar>
    </form>
  );
}

function CloseAccountDialog({ onClosed }: { onClosed: () => Promise<MemberView | null> }) {
  const action = useAction();
  const confirm = (): void => {
    void action.run(async () => {
      const answer = await sendJson("POST", "/api/me/closure", {}, MemberSelfAnswer);
      await onClosed();
      closeDialog();
      navigate("/me/account", { replace: true });
      return closingCopy(answer.member);
    });
  };
  return (
    <Dialog id="close-account" title="Close account" action={action}>
      <p>Your Plus runs to the end of the paid period. After the wait, your personal data is erased everywhere.</p>
      <div className="button-row">
        <Button action={action} onClick={confirm}>Yes, close my account</Button>
        <Button kind="secondary" onClick={closeDialog}>Keep my account</Button>
      </div>
    </Dialog>
  );
}

export function AccountScreen() {
  const me = useMe();
  const member = me.data?.member;
  const copy = member ? closingCopy(member) : null;
  return (
    <MemberShell>
      <section className="page-head"><PageHeading>Your account</PageHeading></section>
      {member ? (
        <div className="stack">
          {copy ? <p className="card closing-note">{copy}</p> : null}
          <ProfileForm member={member} onSaved={me.reload} />
          <section className="card stack">
            <h2>Security and closing</h2>
            <div className="button-row">
              <Button kind="secondary" onClick={(event) => openDialog("change-password", event.currentTarget)}>Change password</Button>
              {member.accountState === "active" ? <OpenerButton dialog="close-account" kind="secondary">Close account</OpenerButton> : null}
            </div>
          </section>
          <ChangePasswordDialog />
          <CloseAccountDialog onClosed={async () => {
            await me.reload();
            return null;
          }} />
        </div>
      ) : <Skeleton />}
    </MemberShell>
  );
}

