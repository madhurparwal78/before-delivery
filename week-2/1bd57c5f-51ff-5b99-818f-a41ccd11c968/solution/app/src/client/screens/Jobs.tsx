import { Plus } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { JOB_STATUS_LABELS, type Job, type User } from "../../shared/domain";
import { useAnnounce } from "../activity";
import { ApiFailure, api } from "../api";
import { Dialog } from "../components/Dialog";
import { ErrorSummary, FieldError, type FieldProblem } from "../components/ErrorSummary";
import { EmptyGlyph, StageGlyph } from "../components/Glyphs";
import { COPY } from "../copy";
import { followLink, navigate } from "../router";

const FIELD_IDS = { name: "job-name", address: "job-address", time_zone: "job-zone" } as const;

function NewJobDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (job: Job) => void }) {
  const announce = useAnnounce();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [zone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const zones = useMemo(() => {
    const names = Intl.supportedValuesOf("timeZone");
    return names.includes(zone) ? names : [zone, ...names];
  }, [zone]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    announce(COPY.saving);
    try {
      const job = await api<Job>("POST", "/api/jobs", { name, address, time_zone: zone });
      setErrors({});
      announce("Job created.");
      onCreated(job);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setErrors(failure.body.fields ?? {});
        announce(failure.message);
      } else announce("Creating a job needs a connection.");
    } finally {
      setPending(false);
    }
  };

  const problems: FieldProblem[] = Object.entries(errors).map(([field, message]) => ({
    target: FIELD_IDS[field as keyof typeof FIELD_IDS] ?? FIELD_IDS.name,
    message,
  }));

  return (
    <Dialog open={open} title="New job" onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorSummary problems={problems} />
        <div className="field">
          <label htmlFor={FIELD_IDS.name}>Job name</label>
          <input id={FIELD_IDS.name} className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} />
          <FieldError id="job-name-error" message={errors.name} />
        </div>
        <div className="field">
          <label htmlFor={FIELD_IDS.address}>Address</label>
          <input
            id={FIELD_IDS.address}
            className="input"
            autoComplete="street-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            aria-invalid={errors.address ? true : undefined}
          />
          <FieldError id="job-address-error" message={errors.address} />
        </div>
        <div className="field">
          <label htmlFor={FIELD_IDS.time_zone}>Time zone</label>
          <select
            id={FIELD_IDS.time_zone}
            className="input"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            aria-invalid={errors.time_zone ? true : undefined}
          >
            {zones.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <FieldError id="job-zone-error" message={errors.time_zone} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
            Create job
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Jobs({ user }: { user: User }) {
  const announce = useAnnounce();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<{ jobs: Job[] }>("GET", "/api/jobs")
      .then(({ jobs: list }) => setJobs(list))
      .catch((failure: unknown) => {
        if (!(failure instanceof ApiFailure)) announce("Your jobs need a connection to load.");
        setJobs([]);
      });
  }, [announce]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Your jobs</h1>
        {user.is_owner && (
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden="true" />
            New job
          </button>
        )}
      </div>
      {jobs === null ? (
        <p className="loading">Loading</p>
      ) : jobs.length === 0 ? (
        <p className="empty">
          <EmptyGlyph />
          {COPY.noJobs}
        </p>
      ) : (
        <ul className="job-rows">
          {jobs.map((job) => (
            <li key={job.id} className="job-row">
              <div>
                <a href={`/jobs/${job.id}`} onClick={followLink}>
                  {job.name}
                </a>
                <span className="job-address">{job.address}</span>
              </div>
              <div className="job-meta">
                <span className={`stage stage--${job.status}`}>
                  <StageGlyph status={job.status} />
                  {JOB_STATUS_LABELS[job.status]}
                </span>
                <span className="progress mono">{job.progress.percent}% verified</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <NewJobDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(job) => {
          setCreating(false);
          navigate(`/jobs/${job.id}`, { state: { tab: "setup" } });
        }}
      />
    </div>
  );
}
