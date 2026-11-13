import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";
import { announce } from "../announce";
import { get, post } from "../api";
import { ReviewArticle } from "../components/ReviewArticle";
import { SpecimenTile, rowKey, reportsText, TileLoading } from "../components/SpecimenTile";
import { ActionButton, TextArea } from "../components/ui";
import { useAction, useIsPhone, useLoad } from "../hooks";
import { useLive, useLiveReload } from "../live";
import { Link, setAddress, useLocation } from "../router";
import { useSession } from "../session";
import { NotFound } from "../shell/Page";
import { SiteHeader } from "../shell/SiteHeader";
import { showToast } from "../toast";
import { formatRange, formatRupees } from "../../shared/money";
import { OUTCOMES, WORK_PATTERNS, monthYear, nameOf, PREVIEW_CHARS } from "../../shared/reference";
import type { Company, InterviewNote, JobSummary, PayRow, Review } from "../../shared/api";

const TABS = ["reviews", "pay", "interviews", "jobs"] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = { reviews: "Reviews", pay: "Pay", interviews: "Interviews", jobs: "Jobs" };

const reviewLine = (count: number): string => (count === 0 ? "No ratings yet" : count === 1 ? "1 review" : `${count} reviews`);
const score = (value: number | null): string => (value === null ? "–" : value.toFixed(1));

function ReplyBox({ review, onPosted }: { review: Review; onPosted: () => void }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | undefined>();
  const { busy, run } = useAction();

  async function send() {
    setError(undefined);
    const result = await run(() => post(`/api/employer/reviews/${review.id}/reply`, { body }));
    if (result.ok) {
      showToast("Reply posted.");
      setOpen(false);
      onPosted();
    } else {
      setError(result.fields?.["body"] ?? result.message);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-quiet" onClick={() => setOpen(true)}>
        Reply to {review.title}
      </button>
    );
  }
  return (
    <div className="reply-form">
      <TextArea label="Your public reply" value={body} onChange={(event) => setBody(event.target.value)} error={error} />
      <ActionButton type="button" busy={busy} onClick={() => void send()}>
        Post reply
      </ActionButton>
    </div>
  );
}

function ReviewsSection({ company, canReply, reload }: { company: Company; canReply: boolean; reload: () => void }) {
  return (
    <section className="section" id="reviews" aria-labelledby="reviews-title">
      <h2 id="reviews-title">Reviews</h2>
      {company.reviews.length === 0 ? (
        <p>No reviews yet.</p>
      ) : (
        <ul className="reviews" aria-label="Reviews">
          {company.reviews.map((review) => (
            <li key={review.id}>
              <ReviewArticle review={review}>{canReply && !review.reply ? <ReplyBox review={review} onPosted={reload} /> : null}</ReviewArticle>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PaySection({ company }: { company: Company }) {
  return (
    <section className="section" id="pay" aria-labelledby="pay-title">
      <h2 id="pay-title">Pay</h2>
      {company.pay_rows.length === 0 ? (
        <p>No pay reports yet.</p>
      ) : (
        <table className="pay-table" aria-label="Pay by role">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">City</th>
              <th scope="col">Reports</th>
              <th scope="col">Low</th>
              <th scope="col">Median</th>
              <th scope="col">High</th>
            </tr>
          </thead>
          <tbody>
            {company.pay_rows.map((row) => (
              <tr key={rowKey(row)} data-id={rowKey(row)} data-pay-row="">
                <td>{row.role_name}</td>
                <td>{row.city_name}</td>
                {row.band ? (
                  <>
                    <td className="figure">{reportsText(row)}</td>
                    <td className="figure" data-label="Low">{formatRupees(row.band.low)}</td>
                    <td className="figure" data-label="Median">{formatRupees(row.band.median)}</td>
                    <td className="figure" data-label="High">{formatRupees(row.band.high)}</td>
                  </>
                ) : (
                  <td className="figure" colSpan={4}>{reportsText(row)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NoteItem({ note }: { note: InterviewNote }) {
  const text = note.truncated && Array.from(note.text).length >= PREVIEW_CHARS ? `${note.text}…` : note.text;
  return (
    <article className="note" data-id={note.id}>
      <p className="text">{text}</p>
      <p className="meta">
        {note.role_name} · Difficulty {note.difficulty} of 5 · {nameOf(OUTCOMES, note.outcome)} · {note.author_label} · {monthYear(note.posted_month)}
      </p>
    </article>
  );
}

function InterviewsSection({ company }: { company: Company }) {
  return (
    <section className="section" id="interviews" aria-labelledby="interviews-title">
      <h2 id="interviews-title">Interviews</h2>
      {company.interview_notes.length === 0 ? (
        <p>No interview notes yet.</p>
      ) : (
        <ul className="notes" aria-label="Interview notes">
          {company.interview_notes.map((note) => (
            <li key={note.id}>
              <NoteItem note={note} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function JobItem({ job }: { job: JobSummary }) {
  return (
    <li data-id={job.id}>
      <Link to={`/jobs/${job.id}`}>{job.title}</Link>
      <p className="meta figure">
        {job.city_name} · {nameOf(WORK_PATTERNS, job.remote)} · {formatRange(job.pay_low, job.pay_high)}
      </p>
    </li>
  );
}

function JobsSection({ company }: { company: Company }) {
  return (
    <section className="section" id="jobs" aria-labelledby="jobs-title">
      <h2 id="jobs-title">Jobs</h2>
      {company.jobs.length === 0 ? (
        <p>No open jobs right now.</p>
      ) : (
        <ul className="jobs-list" aria-label="Open jobs">
          {company.jobs.map((job) => (
            <JobItem key={job.id} job={job} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Tabs({ tab, onSelect, children }: { tab: Tab; onSelect: (tab: Tab) => void; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const last = useRef<{ x: number; y: number } | undefined>(undefined);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1);
    const next = TABS[Math.max(0, Math.min(TABS.length - 1, index))];
    if (!next) return;
    onSelect(next);
    list.current?.querySelector<HTMLElement>(`#tab-${next}`)?.focus();
  }

  function swipeStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    start.current = { x: touch.clientX, y: touch.clientY };
    last.current = start.current;
  }

  function swipeMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (touch) last.current = { x: touch.clientX, y: touch.clientY };
  }

  function swipeEnd() {
    const from = start.current;
    const to = last.current;
    start.current = undefined;
    if (!from || !to) return;
    const dx = to.x - from.x;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(to.y - from.y)) return;
    const next = TABS[TABS.indexOf(tab) + (dx < 0 ? 1 : -1)];
    if (next) onSelect(next);
  }

  return (
    <>
      <div ref={list} className="tabs" role="tablist" aria-label="Company sections" onKeyDown={onKeyDown}>
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`tab-${name}`}
            className="tab"
            aria-selected={tab === name}
            aria-controls="company-panel"
            tabIndex={tab === name ? 0 : -1}
            onClick={() => onSelect(name)}
          >
            {TAB_NAMES[name]}
          </button>
        ))}
      </div>
      <div id="company-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} onTouchStart={swipeStart} onTouchMove={swipeMove} onTouchEnd={swipeEnd}>
        {children}
      </div>
    </>
  );
}

/** The row whose centre has crossed the middle of the window, or none above the first row. */
function rowInView(): string {
  const middle = window.innerHeight / 2;
  let key = "none";
  for (const element of document.querySelectorAll<HTMLElement>("[data-pay-row]")) {
    const box = element.getBoundingClientRect();
    if (box.top + box.height / 2 <= middle + 1) key = element.dataset["id"] ?? key;
  }
  return key;
}

function resolvedRows(before: PayRow[], after: PayRow[]): PayRow[] {
  return after.filter((row) => {
    const earlier = before.find((candidate) => rowKey(candidate) === rowKey(row));
    return earlier !== undefined && earlier.report_count < earlier.threshold && row.band !== null;
  });
}

export function CompanyPage({ slug }: { slug: string }) {
  const { me } = useSession();
  const phone = useIsPhone();
  const { query } = useLocation();
  const company = useLoad(() => get<Company>(`/api/companies/${slug}`), [slug, me?.id]);
  const [bandKey, setBandKey] = useState("none");
  const current = useRef<Company | undefined>(undefined);
  current.current = company.data;
  const tab: Tab = TABS.find((name) => name === query.get("tab")) ?? "reviews";

  useLive("company.changed", (event) => {
    const before = current.current;
    if (event.slug !== slug || !event.company || !before) return;
    if (before.viewer_unlocked) {
      for (const row of resolvedRows(before.pay_rows, event.company.pay_rows)) announce(`Pay range now shown for ${row.role_name}`);
    }
    company.patch(() => event.company ?? before);
  });
  useLive("member.unlocked", () => {
    announce("Full pay and review detail is now unlocked.");
    company.reload();
  });
  useLiveReload(company.reload);

  const rowSignature = company.data?.pay_rows.map(rowKey).join(",") ?? "";
  const update = useCallback(() => setBandKey(rowInView()), []);
  useEffect(() => {
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update, rowSignature, tab, phone]);

  const target = query.get("tab");
  const ready = company.data !== undefined;
  useEffect(() => {
    if (ready && !phone && target && TABS.some((name) => name === target)) document.getElementById(target)?.scrollIntoView();
  }, [ready, phone, target]);

  if (company.failure?.status === 404) return <NotFound />;
  const data = company.data;
  if (!data) {
    return (
      <div className="split">
        <SiteHeader />
        <div className="split-field"><TileLoading /></div>
        <div className="split-main"><p>Loading</p></div>
      </div>
    );
  }

  const isTeam = me !== null && (me.role === "employer_admin" || me.role === "recruiter") && me.company_slug === data.slug && data.verified;
  const caption = `${data.name}, ${data.city_name}. ${reviewLine(data.rating.review_count)}`;
  const select = (next: Tab) => setAddress(`/companies/${slug}?tab=${next}`, true);
  const sections: Record<Tab, ReactNode> = {
    reviews: <ReviewsSection company={data} canReply={isTeam} reload={company.reload} />,
    pay: <PaySection company={data} />,
    interviews: <InterviewsSection company={data} />,
    jobs: <JobsSection company={data} />,
  };

  return (
    <div className="split">
      <SiteHeader />
      <div className="split-field">
        <SpecimenTile bandKey={bandKey} rows={data.pay_rows} unlocked={data.viewer_unlocked} glass={() => ({ seed: data.name, caption })} />
      </div>
      <div className="split-main">
        <div className="company-head">
          {data.mark_url ? <img className="mark" src={data.mark_url} alt={`${data.name} mark`} width="64" height="64" /> : null}
          <h1>{data.name}</h1>
          {data.verified ? <p className="verified">Verified employer</p> : null}
          {data.rating.review_count === 0 ? (
            <p className="no-ratings">No ratings yet</p>
          ) : (
            <>
              <div className="rating">
                <span className="rating-figure">{score(data.rating.overall)}</span>
                <span className="count">{reviewLine(data.rating.review_count)}</span>
              </div>
              <dl className="sub-ratings figure">
                <dt>Work-life balance</dt>
                <dd>{score(data.rating.work_life)}</dd>
                <dt>Pay</dt>
                <dd>{score(data.rating.pay)}</dd>
                <dt>Management</dt>
                <dd>{score(data.rating.management)}</dd>
              </dl>
            </>
          )}
        </div>
        {!data.viewer_unlocked ? (
          <section className="unlock" aria-labelledby="unlock-title">
            <h2 id="unlock-title">Contribute once to unlock</h2>
            <p>Share one review, pay report or interview note to unlock full pay and review detail.</p>
            {!me || me.role === "member" ? <Link to="/contribute" className="btn">Share something</Link> : null}
          </section>
        ) : null}
        {phone ? (
          <Tabs tab={tab} onSelect={select}>
            {sections[tab]}
          </Tabs>
        ) : (
          TABS.map((name) => <div key={name}>{sections[name]}</div>)
        )}
      </div>
    </div>
  );
}


