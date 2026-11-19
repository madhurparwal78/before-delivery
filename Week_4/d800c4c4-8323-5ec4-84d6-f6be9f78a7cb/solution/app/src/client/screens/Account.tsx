import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { request, sessionEnded, type Board, type Fee, type Hold, type Item, type Loan, type Membership } from "../api";
import { LOAN_WORD } from "../board/outline";
import { ActionButton, Dialog, DueLine, FormProblems, Num, PegStrip, Status, usePoll } from "../components/ui";
import { dollars } from "../format";
import { useShell, type Me } from "../shell";
import { PaneAnnouncements } from "./Pegboard";
import { useAnnouncer } from "./useAnnouncer";

const PENDING_COPY = "Payment pending — your membership starts when billing confirms it.";
const ACTIVE_COPY = "Your membership is active.";
const MEMBERSHIP_WORD = { "pending-payment": "pending payment", active: "active", lapsed: "lapsed" } as const;
const TIER_LABEL = { "pay-what-you-can": "Pay what you can", standard: "Standard", supporter: "Supporter" } as const;
export const FEE_WORD = { raised: "raised", settled: "settled", "waived-by-coordinator": "waived" } as const;

export function Account({ me, fromJoin }: { me: Me; fromJoin: boolean }) {
  const shell = useShell();
  const [membership, setMembership] = useState<Membership>(me.membership!);
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [items, setItems] = useState<Map<number, Item>>(new Map());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellingHold, setCancellingHold] = useState<number | null>(null);
  const news = useAnnouncer(me);
  const summary = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef<"opener" | "heading" | null>(null);
  const seenPending = useRef(me.membership!.status === "pending-payment");
  const activeAnnounced = useRef(false);
  const previousHolds = useRef<Map<number, Hold["status"]> | null>(null);
  const readyAnnounced = useRef(new Set<number>());

  useLayoutEffect(() => {
    if (focusAfter.current === "opener") opener.current?.focus();
    if (focusAfter.current === "heading") heading.current?.focus();
    focusAfter.current = null;
  });

  useEffect(() => {
    if (fromJoin) news.announce(me.membership!.status === "active" ? ACTIVE_COPY : PENDING_COPY);
    if (fromJoin && me.membership!.status === "active") activeAnnounced.current = true;
  }, []);

  const applyMembership = (next: Membership) => {
    setMembership(next);
    if (next.status === "active" && seenPending.current && !activeAnnounced.current) {
      activeAnnounced.current = true;
      news.announce(ACTIVE_COPY);
    }
  };

  const applyHolds = (next: Hold[]) => {
    setHolds(next);
    const before = previousHolds.current;
    previousHolds.current = new Map(next.map((h) => [h.id, h.status]));
    if (!before) return;
    const turned = next.filter((h) => h.status === "ready" && before.get(h.id) === "queued" && !readyAnnounced.current.has(h.id));
    if (turned.length === 0) return;
    turned.forEach((h) => readyAnnounced.current.add(h.id));
    return turned;
  };

  const read = useCallback(async () => {
    const [meAnswer, loanAnswer, holdAnswer, feeAnswer, boardAnswer] = await Promise.all([
      request<Me>("GET", "/api/me"),
      request<{ loans: Loan[] }>("GET", "/api/loans"),
      request<{ holds: Hold[] }>("GET", "/api/holds"),
      request<{ fees: Fee[] }>("GET", "/api/fees"),
      request<Board>("GET", "/api/board"),
    ]);
    if (meAnswer.status === 200) applyMembership(meAnswer.body.membership!);
    if (loanAnswer.status === 200) setLoans(loanAnswer.body.loans);
    if (feeAnswer.status === 200) setFees(feeAnswer.body.fees);
    let itemMap = items;
    if (boardAnswer.status === 200) {
      itemMap = new Map(boardAnswer.body.items.map((i) => [i.id, i]));
      setItems(itemMap);
      shell.setCounts(boardAnswer.body.counts);
    }
    if (holdAnswer.status === 200) {
      const turned = applyHolds(holdAnswer.body.holds);
      if (turned) news.announce(turned.map((h) => `Your hold on ${itemMap.get(h.item_id)?.name ?? "a tool"} is ready.`).join(" "));
    }
  }, [items]);

  const pendingCheck = useCallback(async () => {
    const answer = await request<Me>("GET", "/api/me");
    if (answer.status === 200) applyMembership(answer.body.membership!);
  }, []);

  useEffect(() => {
    void read();
  }, []);
  usePoll(read, 10_000);
  usePoll(pendingCheck, 3000, membership.status === "pending-payment");

  const confirmCancel = async () => {
    setCancelling(true);
    const answer = await request<{ membership: Membership }>("POST", "/api/membership/cancel");
    setCancelling(false);
    if (sessionEnded(answer)) {
      setDialogOpen(false);
      news.sessionEnded({ fields: {} });
      return;
    }
    if (answer.status === 200) {
      setMembership(answer.body.membership);
      setDialogOpen(false);
      focusAfter.current = "heading";
      news.announce(`Your membership ends on ${answer.body.membership.active_until}.`);
      return;
    }
    news.announce(answer.error);
  };

  const cancelHold = async (hold: Hold) => {
    setCancellingHold(hold.id);
    const answer = await request("DELETE", `/api/holds/${hold.id}`);
    setCancellingHold(null);
    if (sessionEnded(answer)) {
      news.sessionEnded({ fields: {} });
      return;
    }
    news.announce(answer.status === 200 ? "Hold cancelled." : answer.error);
    await read();
  };

  const open = loans?.filter((l) => l.status !== "returned-complete") ?? [];
  const done = loans?.filter((l) => l.status === "returned-complete") ?? [];

  return (
    <div class="page">
      <PegStrip />
      <h1>Your account</h1>
      <PaneAnnouncements news={news} summary={summary} showProblems={!dialogOpen} />
      <section class="panel membership" aria-labelledby="membership-heading">
        <div class="panel-head">
          <h2 id="membership-heading" tabIndex={-1} ref={heading}>
            Your membership
          </h2>
          <span class="membership-status">
            <strong>{MEMBERSHIP_WORD[membership.status]}</strong> · {TIER_LABEL[membership.tier]}
            {membership.ends_at_term && membership.active_until && (
              <>
                {" "}
                · <span>Active until <Num>{membership.active_until}</Num></span>
              </>
            )}
          </span>
        </div>
        {membership.status === "pending-payment" && <p class="note">Billing is confirming your first payment. This page updates on its own.</p>}
        {membership.status === "active" && !membership.ends_at_term && (
          <button type="button" class="btn" ref={opener} onClick={() => setDialogOpen(true)}>
            Cancel at end of term
          </button>
        )}
      </section>

      <h2>Loans</h2>
      <table class="ledger" aria-label="Your loans">
        <thead>
          <tr>
            <th scope="col">Loan</th>
            <th scope="col">Tools</th>
            <th scope="col">Status</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {loans === null ? (
            <tr>
              <td colSpan={4}>Loading your loans…</td>
            </tr>
          ) : loans.length === 0 ? (
            <tr>
              <td colSpan={4}>No loans yet. Borrow from the wall at the desk.</td>
            </tr>
          ) : (
            [...open, ...done].map((loan) => (
              <tr key={loan.id}>
                <td>
                  <a class="row-link" href={`/loans/${loan.id}`}>
                    <Num>{loan.ref}</Num>
                  </a>
                </td>
                <td>{loan.items.map((i) => i.name).join(", ")}</td>
                <td>
                  <Status word={LOAN_WORD[loan.status]!} />
                </td>
                <td>{loan.status === "returned-complete" ? <Num>{loan.returned_at?.slice(0, 10)}</Num> : <DueLine loan={loan} />}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h2>Holds</h2>
      <table class="ledger" aria-label="Your holds">
        <thead>
          <tr>
            <th scope="col">Tool</th>
            <th scope="col">Status</th>
            <th scope="col">Place</th>
            <th scope="col">
              <span class="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {holds.length === 0 ? (
            <tr>
              <td colSpan={4}>No holds. Place one from the pegboard when a tool is out.</td>
            </tr>
          ) : (
            holds.map((hold) => {
              const item = items.get(hold.item_id);
              return (
                <tr key={hold.id}>
                  <td>
                    {item?.name} <Num>{item?.tag}</Num>
                  </td>
                  <td>{hold.status}</td>
                  <td>{hold.position !== null && <Num>{hold.position}</Num>}</td>
                  <td>
                    {(hold.status === "queued" || hold.status === "ready") && (
                      <ActionButton
                        label={`Cancel hold ${item?.name ?? ""}`}
                        pendingLabel="Cancelling..."
                        pending={cancellingHold === hold.id}
                        onAct={() => void cancelHold(hold)}
                      />
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <h2>Fees</h2>
      <table class="ledger" aria-label="Your fees">
        <thead>
          <tr>
            <th scope="col">Fee</th>
            <th scope="col">Loan</th>
            <th scope="col">Total</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {fees.length === 0 ? (
            <tr>
              <td colSpan={4}>No fees.</td>
            </tr>
          ) : (
            fees.map((fee) => (
              <tr key={fee.id}>
                <td>
                  <a class="row-link" href={`/fees/${fee.id}`}>
                    Fee <Num>{fee.id}</Num>
                  </a>
                </td>
                <td>
                  <Num>{fee.loan_ref}</Num>
                </td>
                <td>
                  <Num>${dollars(fee.total_cents)}</Num>
                </td>
                <td>
                  <Status word={FEE_WORD[fee.status]} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {dialogOpen && (
        <Dialog
          label="Cancel membership"
          onEscape={() => {
            setDialogOpen(false);
            focusAfter.current = "opener";
          }}
        >
          <h2 class="dialog-title">Cancel membership</h2>
          <FormProblems problems={[]} summaryRef={summary} />
          <p>Your membership stays active until the end of the term you have paid for. Nothing is refunded.</p>
          <div class="dialog-actions">
            <ActionButton label="Confirm cancel" pendingLabel="Cancelling..." pending={cancelling} primary onAct={() => void confirmCancel()} />
            <button
              type="button"
              class="btn"
              onClick={() => {
                setDialogOpen(false);
                focusAfter.current = "opener";
              }}
            >
              Keep membership
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
