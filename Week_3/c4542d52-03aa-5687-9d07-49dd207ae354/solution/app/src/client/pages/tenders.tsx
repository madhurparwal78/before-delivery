import { useEffect, useRef, useState } from "react";
import type { Tender } from "../../shared/types.js";
import { dollars, displayInstant, groupThousands } from "../../shared/format.js";
import { ApiFailure, api } from "../api.js";
import { announce } from "../announce.js";
import { useResource, useSettled, useSocketGate } from "../hooks.js";
import { useLive } from "../live.js";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { Band, CountedNumber, Countdown, LabelledValue, TextField, groupedCount, ScrollRegion } from "../ui.js";
import { FailurePage } from "./notFound.js";

const TOPICS = ["tenders", "registry", "documents"];

export function TendersPage() {
  const { person } = useSession();
  const tenders = useResource<{ tenders: Tender[] }>("/api/tenders", TOPICS);
  const list = tenders.data?.tenders ?? [];
  const noneOpen = tenders.data !== undefined && !list.some((tender) => tender.state === "open");
  return (
    <main className={noneOpen && list.length === 0 ? "chapter chapter-empty" : "chapter"}>
      <div className="chapter-band">
        <div className="sheet">
          <p className="note">{person.name}</p>
          <h1 tabIndex={-1}>Tender offers</h1>
        </div>
      </div>
      {noneOpen && (
        <Band tone="black" className={list.length === 0 ? "band-fill-inner" : "band-inner"}>
          No tender is open.
        </Band>
      )}
      {list.length > 0 && (
        <section className="sheet">
          <p className="note">Harbourline Secondary Partners buys every Tidecraft tender.</p>
          <ul role="list" aria-label="Tender offers" className="rows">
            {list.map((tender) => (
              <li key={tender.id} className="row-item">
                <Link href={`/tenders/${tender.id}`}>{tender.title}</Link>
                <span>{tender.id}</span>
                <span>{tender.state === "open" ? `Closes ${displayInstant(tender.closes_at)}` : "Closed"}</span>
                <span className="amount">{dollars(tender.price_per_share)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export function TenderPage({ id }: { id: string }) {
  const { person } = useSession();
  const tender = useResource<Tender>(`/api/tenders/${id}`, TOPICS);
  if (tender.error) return <FailurePage failure={tender.error} />;
  if (!tender.data) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  return <TenderChapter tender={tender.data} investor={person.role === "investor"} reload={tender.reload} />;
}

function TenderChapter({ tender, investor, reload }: { tender: Tender; investor: boolean; reload: () => void }) {
  const { person } = useSession();
  const closed = tender.state !== "open";
  return (
    <main className="chapter">
      <div className="chapter-band">
        <div className="sheet">
          <p className="note">
            {person.name}
            <br />
            {tender.id}
          </p>
          <h1 tabIndex={-1}>{tender.title}</h1>
          <p className="band-timer">
            {closed ? <span role="timer" aria-label="Tender closes in">Closed</span> : <Countdown to={tender.closes_at} label="Tender closes in" done="Closed" />}
          </p>
        </div>
      </div>
      <section className="sheet">
        <p className="note">Bought by {tender.buyer}. Lots are whole shares.</p>
        <div className="figures">
          <LabelledValue label="Price per share">{dollars(tender.price_per_share)}</LabelledValue>
          <LabelledValue label="Share cap">{groupThousands(tender.share_cap)}</LabelledValue>
          <LabelledValue label="Remaining cap">{groupThousands(tender.remaining_cap)}</LabelledValue>
          {tender.oversubscribed_by > 0 && <LabelledValue label="Oversubscribed by">{groupThousands(tender.oversubscribed_by)}</LabelledValue>}
        </div>
      </section>
      {investor && tender.mine && <InvestorPanel tender={tender} reload={reload} closed={closed} />}
      {!investor && tender.submissions && <SubmissionsTable submissions={tender.submissions} />}
    </main>
  );
}

export function SubmissionsTable({ submissions }: { submissions: NonNullable<Tender["submissions"]> }) {
  return (
    <section className="sheet">
      <p className="note">Every submission, in the order it arrived.</p>
      <ScrollRegion label="Submissions scroll area">
        <table aria-label="Tender submissions" className="plain-table">
          <thead>
            <tr>
              <th scope="col">Holder</th>
              <th scope="col" className="num">
                Shares
              </th>
              <th scope="col" className="num">
                Order
              </th>
              <th scope="col" className="num">
                Allocation
              </th>
              <th scope="col" className="num">
                Proceeds
              </th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((submission) => (
              <tr key={submission.holder_id}>
                <td>{submission.holder_name}</td>
                <td className="num">{groupThousands(submission.shares)}</td>
                <td className="num">{submission.sequence}</td>
                <td className="num">{submission.allocation === null ? "—" : groupThousands(submission.allocation)}</td>
                <td className="num">{submission.proceeds === null ? "—" : dollars(submission.proceeds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </section>
  );
}

function InvestorPanel({ tender, reload, closed }: { tender: Tender; reload: () => void; closed: boolean }) {
  const mine = tender.mine;
  const gate = useSocketGate();
  const live = useLive();
  const [shares, setShares] = useState(mine?.draft_shares ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"nda" | "submit" | "withdraw" | null>(null);
  const [vaultDown, setVaultDown] = useState(false);
  const loaded = useRef(false);
  const dirty = useRef(false);
  const sawOpen = useRef(false);
  if (tender.state === "open") sawOpen.current = true;

  const saveDraft = (value: string) => {
    dirty.current = false;
    api("PUT", `/api/tenders/${tender.id}/draft`, { shares: value === "" ? null : value }).catch((failure: unknown) => {
      if (!(failure instanceof ApiFailure)) throw failure;
    });
  };
  useSettled(shares, 500, (value) => {
    if (!loaded.current) return;
    if (live.open) saveDraft(value);
    else dirty.current = true;
  });
  useEffect(() => {
    if (live.open && dirty.current) saveDraft(shares);
    // The draft is saved once the socket is open again.
  }, [live.open]);
  useEffect(() => {
    loaded.current = true;
  }, []);

  if (!mine) return null;
  const submitted = mine.submission !== null;
  const ndaSealed = mine.nda.status === "sealed";

  const sign = async () => {
    setBusy("nda");
    announce("Sealing your NDA in the vault.");
    try {
      await api("POST", `/api/tenders/${tender.id}/nda`, {});
      setVaultDown(false);
      announce("NDA signed and sealed.");
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setVaultDown(failure.code === "vault_unavailable");
    } finally {
      setBusy(null);
      reload();
    }
  };

  const submit = async () => {
    setBusy("submit");
    setError(undefined);
    const digits = shares.replace(/,/g, "");
    try {
      const next = await api<Tender>("POST", `/api/tenders/${tender.id}/submissions`, { shares: /^\d+$/.test(digits) ? Number.parseInt(digits, 10) : shares });
      announce(`Tender submitted: ${groupThousands(next.mine?.submission?.shares ?? 0)} shares at ${dollars(tender.price_per_share)}.`);
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      setError(failure.fields.shares ?? (failure.code === "tender_closed" ? "This tender has closed." : failure.body.error.message));
    } finally {
      setBusy(null);
      reload();
    }
  };

  const withdraw = async () => {
    setBusy("withdraw");
    try {
      await api("DELETE", `/api/tenders/${tender.id}/submissions/mine`);
      announce("Tender withdrawn.");
      setShares("");
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
    } finally {
      setBusy(null);
      reload();
    }
  };

  return (
    <>
      {vaultDown && (
        <Band tone="red" role="alert">
          The document vault can't be reached. Your NDA is pending and you can't tender yet.
        </Band>
      )}
      <section className="sheet">
        <p className="note">{ndaSealed ? "Your NDA is sealed in the vault." : "Sign the NDA to tender"}</p>
        <div className="form-column">
          {!ndaSealed && !closed && (
            <button type="button" className="button button-secondary" disabled={gate || busy !== null} onClick={() => void sign()}>
              {mine.nda.status === "pending" ? "Retry signing" : "Sign NDA"}
            </button>
          )}
          <form
            className="form-column"
            onSubmit={(event) => {
              event.preventDefault();
              if (!submitted && ndaSealed) void submit();
            }}
          >
            <TextField
              label="Shares to tender"
              value={submitted ? groupThousands(mine.submission?.shares ?? 0) : shares}
              readOnly={submitted}
              inputMode="numeric"
              error={error}
              onValue={(value) => {
                setShares(value);
                setError(undefined);
              }}
            />
            {!submitted && (
              <button type="submit" className="button button-primary" disabled={gate || busy !== null || !ndaSealed || closed}>
                {busy === "submit" ? "Submitting" : "Submit tender"}
              </button>
            )}
            {submitted && !closed && (
              <button type="button" className="button button-secondary" disabled={gate || busy !== null} onClick={() => void withdraw()}>
                Withdraw tender
              </button>
            )}
          </form>
        </div>
      </section>
      <section className="sheet" aria-label="Your allocation">
        <p className="note">Allocated pro rata in whole shares when the tender closes.</p>
        {mine.allocation !== null && mine.proceeds !== null ? (
          <p className="allocation">
            Allocated <CountedNumber value={String(mine.allocation)} render={groupedCount} fromZero={sawOpen.current} /> shares, proceeds{" "}
            <CountedNumber value={mine.proceeds} decimals={2} render={dollars} fromZero={sawOpen.current} />
          </p>
        ) : submitted ? (
          <p className="allocation">Projected allocation {groupThousands(mine.projected_allocation ?? 0)}</p>
        ) : (
          <p className="allocation-empty">{closed ? "You did not tender in this offer." : "Submit shares to see your projected allocation."}</p>
        )}
      </section>
    </>
  );
}
