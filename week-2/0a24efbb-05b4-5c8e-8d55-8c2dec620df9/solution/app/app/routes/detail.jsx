import { data, useLoaderData } from "react-router";
import { queueHref } from "../../src/queue-query.mjs";
import { Icon } from "../icons.jsx";
import { Page } from "../page.jsx";
import { Absent, Chip, Queue, Trail, claimedOut, loadQueue } from "../queue.jsx";
import { LEAVE_LABELS, TYPE_LABELS, punch } from "../words.js";

export async function loader({ request, params, context }) {
  const { caller, desk } = context;
  const found = await desk.detail(caller, params.id).catch((error) => {
    throw error.status === 404 ? data(null, { status: 404 }) : error;
  });
  const { request: correction } = found;
  const queue = await loadQueue(request, context, `Correction for ${correction.day}`);
  const own = correction.work_address.toLowerCase() === caller.workAddress.toLowerCase();
  const pending = correction.state === "pending";
  return {
    queue,
    found,
    mayDecide: caller.role === "manager" && !own && pending,
    mayWithdraw: own && pending,
  };
}

function Punch({ label, value, missing = "Not recorded" }) {
  return (
    <div className="punch">
      <dt>{label}</dt>
      <dd className="num">{value ?? missing}</dd>
    </div>
  );
}

function differences(request, evidence) {
  const differ = [];
  if (request.claimed_in && punch(evidence.recorded_in, request.day) !== request.claimed_in) differ.push("sign in");
  if (request.claimed_out && punch(evidence.recorded_out, request.day) !== claimedOut(request)) differ.push("sign out");
  if (!differ.length) return null;
  return `The claimed ${differ.join(" and ")} ${differ.length > 1 ? "differ" : "differs"} from the record.`;
}

function Pane({ found, mayDecide, mayWithdraw }) {
  const { request, evidence, leave, audit, contact } = found;
  const differ = differences(request, evidence);
  return (
    <section className="pane" aria-labelledby="pane-title" data-pane={request.id}>
      <div className="pane-head">
        <Chip state={request.state} />
        <h1 id="pane-title" tabIndex={-1}>
          Correction for <span className="nowrap">{request.day}</span>
        </h1>
      </div>
      <p className="raised-by">
        {request.manager ? `Raised by ${request.person}, reporting to ${request.manager}` : `Raised by ${request.person}`}
      </p>
      {contact && (
        <section className="contact" aria-labelledby="pane-contact">
          <h2 id="pane-contact"><Icon name="user" />Contact on file</h2>
          <p className="num">{`Phone ${contact.phone}`}</p>
          <p>{contact.private_note}</p>
        </section>
      )}
      <div className="evidence">
        <section className="block" aria-labelledby="ev-record">
          <h2 id="ev-record"><Icon name="clock" />What the clock recorded</h2>
          <dl>
            <Punch label="Sign in" value={punch(evidence.recorded_in, request.day)} />
            <Punch label="Sign out" value={punch(evidence.recorded_out, request.day)} />
          </dl>
        </section>
        <section className="block" aria-labelledby="ev-claim">
          <h2 id="ev-claim"><Icon name="check" />What is claimed</h2>
          <p className="claim-type">{TYPE_LABELS[request.correction_type]}</p>
          <dl>
            <Punch label="Sign in" value={request.claimed_in} missing={<Absent words="Not claimed" />} />
            <Punch label="Sign out" value={claimedOut(request)} missing={<Absent words="Not claimed" />} />
          </dl>
          {differ && <p className="differs">{differ}</p>}
        </section>
        <section className="block" aria-labelledby="ev-leave">
          <h2 id="ev-leave"><Icon name="calendar" />Leave that day</h2>
          <p className="leave">{leave ? `${LEAVE_LABELS[leave.kind]}, ${leave.status}` : "No leave recorded"}</p>
        </section>
      </div>
      <section className="pane-part" aria-labelledby="pane-reason">
        <h2 id="pane-reason">Reason given</h2>
        <p className="prose">{request.reason}</p>
      </section>
      {mayDecide && (
        <form className="decide" data-decide={request.id} noValidate>
          <div className="field">
            <label className="label" htmlFor="decide-note">Note</label>
            <textarea id="decide-note" name="note" rows={3} aria-describedby="decide-note-help" />
            <span className="help" id="decide-note-help">Required when rejecting. At least ten characters.</span>
          </div>
          <p className="inline-alert" data-inline hidden />
          <div className="pair">
            <button type="button" className="btn primary" data-outcome="approve">
              <Icon name="check" />
              Approve
            </button>
            <button type="button" className="btn" data-outcome="reject">
              <Icon name="cross" />
              Reject
            </button>
          </div>
        </form>
      )}
      {mayWithdraw && (
        <div className="withdraw" data-withdraw={request.id}>
          <p className="inline-alert" data-inline hidden />
          <button type="button" className="btn" data-withdraw-button>
            <Icon name="slash" />
            Withdraw
          </button>
        </div>
      )}
      <section className="pane-part" aria-labelledby="pane-trail">
        <h2 id="pane-trail">What happened</h2>
        <Trail entries={audit} />
      </section>
    </section>
  );
}

export default function DetailScreen() {
  const { queue, found, mayDecide, mayWithdraw } = useLoaderData();
  const title = `Correction for ${found.request.day}`;
  return (
    <Page title={title} crumb={title} deskHref={queueHref("/requests", queue.values)} layout="split">
      {/* The pane's first-level heading comes first in reading order; the grid still sets the queue on the left. */}
      <Pane found={found} mayDecide={mayDecide} mayWithdraw={mayWithdraw} />
      <Queue queue={queue} path={`/requests/${found.request.id}`} headingLevel={2} selected={found.request.id}
        canRaise={queue.role !== "admin" && "plain"} />
    </Page>
  );
}
