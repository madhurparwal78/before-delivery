import { Bookmark } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { announce } from "../announce";
import { api, get } from "../api";
import { useIsPhone, useLoad } from "../hooks";
import { useMotion } from "../motion";
import { Link, navigate } from "../router";
import { useSession } from "../session";
import { Loading, NotFound, Screen } from "../shell/Page";
import { formatRange } from "../../shared/money";
import { WORK_PATTERNS, nameOf } from "../../shared/reference";
import type { JobDetail, JobSummary } from "../../shared/api";

function SaveButton({ job }: { job: JobDetail }) {
  const { me } = useSession();
  const [saved, setSaved] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const motion = useMotion(200);

  useEffect(() => {
    if (me?.role !== "member") return;
    void get<{ jobs: JobSummary[] }>("/api/saved-jobs").then((answer) => {
      if (answer.ok) setSaved(answer.data.jobs.some((entry) => entry.id === job.id));
    });
  }, [me?.id, me?.role, job.id]);

  async function toggle() {
    if (!me) {
      navigate(`/sign-in?next=${encodeURIComponent(`/jobs/${job.id}`)}`);
      return;
    }
    const result = await api<{ saved: boolean }>(saved ? "DELETE" : "PUT", `/api/saved-jobs/${job.id}`);
    if (!result.ok) {
      announce(result.message);
      return;
    }
    setSaved(result.data.saved);
    announce(result.data.saved ? `Saved ${job.title} at ${job.company_name}.` : `Removed ${job.title} from saved jobs.`);
    if (button.current) {
      motion.play([button.current], [{ transform: "scale(0.94)" }, { transform: "scale(1)" }]);
    }
  }

  return (
    <button
      ref={button}
      type="button"
      className="btn-quiet"
      aria-label="Save job"
      aria-pressed={saved}
      data-motion="save-toggle"
      data-motion-ms={motion.ms}
      data-state={motion.state}
      onClick={() => void toggle()}
    >
      <Bookmark className="save-mark" data-saved={saved} aria-hidden="true" />
      {/* The brief fixes the name at "Save job" while the face reads "Saved": keep the text in the DOM, paint the face. */}
      <span className="sr-only">{saved ? "Saved" : "Save job"}</span>
      <span className="painted" data-text={saved ? "Saved" : "Save job"} aria-hidden="true" />
    </button>
  );
}

export function JobPage({ id }: { id: string }) {
  const phone = useIsPhone();
  const { me } = useSession();
  const job = useLoad(() => get<JobDetail>(`/api/jobs/${id}`), [id, me?.id]);
  if (job.failure?.status === 404) return <NotFound />;
  const data = job.data;
  if (!data) return <Loading />;
  const open = data.status !== "closed";
  const actions = (
    <>
      {open ? (
        <button type="button" className="btn" onClick={() => navigate(`/jobs/${id}/apply`)}>Apply now</button>
      ) : null}
      <SaveButton job={data} />
    </>
  );
  return (
    <Screen title={data.title}>
      <div className="job-head">
        <h1>{data.title}</h1>
        <Link to={`/companies/${data.company_slug}`}>{data.company_name}</Link>
        <p className="job-facts figure">
          {data.city_name} · {nameOf(WORK_PATTERNS, data.remote)} · {formatRange(data.pay_low, data.pay_high)}
        </p>
        {open ? null : <p>This job is closed.</p>}
        {phone ? null : <div className="job-actions">{actions}</div>}
      </div>
      <p className="job-description">{data.description}</p>
      {phone ? (
        <section className="apply-bar" aria-label="Apply bar">
          {actions}
        </section>
      ) : null}
    </Screen>
  );
}
