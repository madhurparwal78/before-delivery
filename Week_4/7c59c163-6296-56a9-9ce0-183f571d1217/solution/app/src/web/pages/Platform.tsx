import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { Dialog } from "../components/Dialog";
import { Shell } from "../components/Shell";
import { Banner, Skeleton, Status, TableScroll } from "../components/ui";
import { COPY } from "../copy";

interface PlatformVenue {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
  member_count: number;
  created_at: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  keycloak: "Keycloak (sign-in)",
  killbill: "Kill Bill (payments)",
  postgres: "Postgres (ledger)",
  valkey: "Valkey (rate limits, live book)",
  svix: "Svix (webhooks)",
  minio: "MinIO (statements, documents)",
  mailpit: "Mail",
};

export function PlatformPage() {
  const [venues, setVenues] = useState<PlatformVenue[] | null>(null);
  const [health, setHealth] = useState<{ providers: Record<string, "up" | "down">; checked_at: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "", time_zone: "America/New_York", owner_email: "" });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [down, setDown] = useState(false);
  const slugInput = useRef<HTMLInputElement>(null);
  const load = () => api<{ venues: PlatformVenue[] }>("/api/platform/venues").then((r) => setVenues(r.venues)).catch(() => setVenues([]));
  useEffect(() => {
    void load();
    api<NonNullable<typeof health>>("/api/platform/health").then(setHealth).catch(() => undefined);
  }, []);

  const onboard = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const venue = await api<PlatformVenue>("/api/platform/venues", { body: form });
      setOpen(false);
      setDown(false);
      setStatus(`${venue.name} is live; the owner has an invite email.`);
      setForm({ slug: "", name: "", time_zone: "America/New_York", owner_email: "" });
      void load();
    } catch (err) {
      if (err instanceof ApiError && err.code === "slug_taken") setError("That slug is taken — choose another.");
      else if (err instanceof ApiError && err.status === 503) {
        setDown(true);
        setError(COPY.invite.keycloakDown);
      } else setError("Use a 3 to 20 character slug of lowercase letters, digits or -, a name, an IANA time zone and the owner's email.");
    }
  };

  return (
    <Shell field="slate">
      <div className="page-head">
        <h1>Platform</h1>
        <button type="button" className="pill" onClick={() => { setError(""); setOpen(true); }}>Onboard venue</button>
      </div>
      {down && <Banner>{COPY.invite.keycloakDown}</Banner>}
      <Status label="Platform updates" message={status} className="page-status" />
      {venues === null ? (
        <Skeleton />
      ) : (
        <div className="card-grid two">
          <section className="card" aria-labelledby="venues-title">
            <h2 className="card-title" id="venues-title">Venues</h2>
            <TableScroll labelledBy="venues-title">
              <table className="table" aria-labelledby="venues-title">
                <thead>
                  <tr><th scope="col">Venue</th><th scope="col">Slug</th><th scope="col">Time zone</th><th scope="col">People</th></tr>
                </thead>
                <tbody>
                  {venues.map((v) => (
                    <tr key={v.id}>
                      <td>{v.name}</td>
                      <td>{v.slug}</td>
                      <td>{v.time_zone}</td>
                      <td className="numeric">{v.member_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>
          <section className="card" aria-label="Provider health">
            <h2 className="card-title">Provider health</h2>
            {health === null ? (
              <Skeleton rows={7} />
            ) : (
              <ul className="health">
                {Object.entries(health.providers).map(([name, state]) => (
                  <li key={name} className={`health-${state}`}>
                    <span>{PROVIDER_LABEL[name] ?? name}</span>
                    <span className="health-state">{state === "up" ? "Up" : "Down"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <Dialog title="Onboard venue" open={open} onClose={() => setOpen(false)} initialFocus={slugInput}>
        <form className="form" onSubmit={(e) => void onboard(e)} noValidate>
          {(
            [
              ["slug", "Slug", "text"],
              ["name", "Venue name", "text"],
              ["time_zone", "Time zone", "text"],
              ["owner_email", "Owner email", "email"],
            ] as const
          ).map(([key, label, type], i) => (
            <div className="field-row" key={key}>
              <label htmlFor={`onboard-${key}`}>{label}</label>
              <input ref={i === 0 ? slugInput : undefined} id={`onboard-${key}`} type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </div>
          ))}
          <p className="field-error" role="status" aria-live="polite">{error}</p>
          <div className="dialog-actions">
            <button type="submit" className="pill">Onboard venue</button>
          </div>
        </form>
      </Dialog>
    </Shell>
  );
}
