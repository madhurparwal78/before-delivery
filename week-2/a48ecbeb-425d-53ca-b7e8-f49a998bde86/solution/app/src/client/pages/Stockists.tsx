import { ArrowRight, CircleCheck, CircleX, Clock, LocateFixed, MapPin, Upload } from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { longDateTime } from "../../shared/format";
import { api, ApiFailure, upload } from "../lib/api";
import { Link, navigate } from "../lib/router";
import "./account.css";

interface Stockist {
  name: string;
  address: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  distance_km: number | null;
}

interface Application {
  id: string;
  status: "submitted" | "approved" | "declined";
  business_name: string;
  submitted_at: string;
}

const CITIES = ["Montreal", "Quebec City", "Toronto", "Ottawa", "Halifax", "Calgary", "Vancouver"];

const PROVINCES: [code: string, name: string][] = [
  ["AB", "Alberta"],
  ["BC", "British Columbia"],
  ["MB", "Manitoba"],
  ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"],
  ["NT", "Northwest Territories"],
  ["NS", "Nova Scotia"],
  ["NU", "Nunavut"],
  ["ON", "Ontario"],
  ["PE", "Prince Edward Island"],
  ["QC", "Quebec"],
  ["SK", "Saskatchewan"],
  ["YT", "Yukon"],
];

const LICENCE_LIMIT = 5_000_000;
const LICENCE_TYPES = /\.(pdf|png|jpe?g)$/i;
const TOO_LARGE = "Licence files can be up to 5,000,000 bytes.";
const WRONG_TYPE = "Upload a PDF, PNG or JPEG.";
const UPLOADS_DOWN = "Uploads are unavailable right now. Nothing was submitted.";

const failureMessage = (error: unknown): string =>
  error instanceof ApiFailure ? error.message : "The shop can't update right now. Try again in a moment.";

export function StockistsPage() {
  const [all, setAll] = useState<Stockist[] | null>(null);
  const [city, setCity] = useState("");
  const [results, setResults] = useState<Stockist[]>([]);
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    api<{ stockists: Stockist[] }>("GET", "/api/stockists")
      .then((body) => setAll(body.stockists))
      .catch((error: unknown) => setMessage(failureMessage(error)));
  }, []);

  const nearest = async (lat: number, lng: number, place: string) => {
    try {
      const { stockists } = await api<{ stockists: Stockist[] }>("GET", `/api/stockists?lat=${lat}&lng=${lng}`);
      setResults(stockists);
      setMessage(`Showing ${stockists.length} stockists nearest ${place}.`);
    } catch (error) {
      setMessage(failureMessage(error));
    }
  };

  const chooseCity = (event: ChangeEvent<HTMLSelectElement>) => {
    const chosen = event.target.value;
    setCity(chosen);
    const anchor = all?.find((s) => s.city === chosen);
    if (anchor) void nearest(anchor.lat, anchor.lng, chosen);
  };

  const locate = () => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setCity("");
        void nearest(position.coords.latitude, position.coords.longitude, "your location");
      },
      () => {
        setLocating(false);
        setMessage("Location is off. Pick a city instead.");
      },
    );
  };

  return (
    <div className="page">
      <h1>Find Ceibo near you</h1>
      <p className="lede">Pick a city or share your location to see the five nearest shops that stock our cans.</p>
      <section className="panel" aria-label="Nearest stockists">
        <div className="stockist-controls">
          <div className="field">
            <label htmlFor="stockist-near">Near</label>
            <select id="stockist-near" value={city} onChange={chooseCity} disabled={all === null}>
              <option value="">Choose a city</option>
              {CITIES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-secondary" onClick={locate} disabled={locating} aria-busy={locating}>
            <LocateFixed aria-hidden="true" size={18} />
            Use my location
          </button>
        </div>
        <p className="status-line" role="status" aria-label="Stockist results">
          {message}
        </p>
        {results.length > 0 && (
          <ul className="stockist-list" aria-label="Stockists">
            {results.map((s) => (
              <li key={s.name}>
                <MapPin aria-hidden="true" size={20} />
                <div>
                  <p>
                    <strong>{s.name}</strong>
                  </p>
                  <p>{s.address}</p>
                </div>
                {s.distance_km !== null && <span className="num distance">{s.distance_km.toFixed(1)} km</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel apply-cta" aria-label="Stock Ceibo">
        <p>Run a café or grocery? We'd love to be on your shelf.</p>
        <Link className="btn btn-primary" href="/stockists/apply">
          Apply to stock Ceibo
          <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </section>
    </div>
  );
}

type ApplyField = "business_name" | "contact_name" | "email" | "province" | "licence";

/** Hands the applicant's email to the application page once, on arrival from the form. */
let arrival: { id: string; email: string } | null = null;

export function ApplyPage() {
  const [values, setValues] = useState({ business_name: "", contact_name: "", email: "", province: "" });
  const [licence, setLicence] = useState<File | null>(null);
  const [fields, setFields] = useState<Partial<Record<ApplyField, string>>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const text = (name: keyof typeof values) => ({
    id: `apply-${name}`,
    value: values[name],
    "aria-invalid": fields[name] ? true : undefined,
    "aria-describedby": fields[name] ? `apply-${name}-error` : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [name]: event.target.value })),
  });

  const fieldError = (name: ApplyField) =>
    fields[name] && (
      <p id={`apply-${name}-error`} className="field-error">
        {fields[name]}
      </p>
    );

  const refuseLicence = (copy: string) => {
    setFields({ licence: copy });
    setMessage(copy);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (licence && licence.size > LICENCE_LIMIT) return refuseLicence(TOO_LARGE);
    if (licence && !LICENCE_TYPES.test(licence.name)) return refuseLicence(WRONG_TYPE);
    const form = new FormData();
    for (const [name, value] of Object.entries(values)) form.append(name, value);
    if (licence) form.append("licence", licence);
    setBusy(true);
    setFields({});
    setMessage("Uploading your licence.");
    try {
      const { application } = await upload<{ application: Application }>("/api/retailer-applications", form);
      arrival = { id: application.id, email: values.email.trim() };
      navigate(`/stockists/applications/${application.id}`);
    } catch (error) {
      setBusy(false);
      if (!(error instanceof ApiFailure)) return setMessage(UPLOADS_DOWN);
      if (error.status === 413) return refuseLicence(TOO_LARGE);
      if (error.status === 415) return refuseLicence(WRONG_TYPE);
      if (error.status === 422) {
        const found = error.body.fields ?? {};
        setFields(found);
        return setMessage(Object.values(found).join(" "));
      }
      setMessage(error.status === 503 ? UPLOADS_DOWN : error.message);
    }
  };

  return (
    <div className="page page-narrow">
      <Link className="text-link" href="/stockists">
        Back to stockists
      </Link>
      <h1>Apply to stock Ceibo</h1>
      <p className="lede">Tell us about your shop and upload your business licence. We reply within 5 business days.</p>
      <form className="panel" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="apply-business_name">Business name</label>
          <input type="text" autoComplete="organization" {...text("business_name")} />
          {fieldError("business_name")}
        </div>
        <div className="field">
          <label htmlFor="apply-contact_name">Contact name</label>
          <input type="text" autoComplete="name" {...text("contact_name")} />
          {fieldError("contact_name")}
        </div>
        <div className="field">
          <label htmlFor="apply-email">Email</label>
          <input type="email" autoComplete="email" {...text("email")} />
          {fieldError("email")}
        </div>
        <div className="field">
          <label htmlFor="apply-province">Province</label>
          <select {...text("province")}>
            <option value="">Choose a province or territory</option>
            {PROVINCES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          {fieldError("province")}
        </div>
        <div className="field">
          <label htmlFor="apply-licence">Business licence (PDF, PNG or JPEG)</label>
          <input
            id="apply-licence"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            aria-invalid={fields.licence ? true : undefined}
            aria-describedby={fields.licence ? "apply-licence-error" : "apply-licence-hint"}
            onChange={(event) => setLicence(event.target.files?.[0] ?? null)}
          />
          <p id="apply-licence-hint" className="hint">
            Up to 5,000,000 bytes.
          </p>
          {fieldError("licence")}
        </div>
        <p className="status-line" role="status" aria-label="Application status">
          {message}
        </p>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Upload aria-hidden="true" size={18} />
          Submit application
        </button>
      </form>
    </div>
  );
}

const STATUS_BADGE = {
  submitted: { word: "Submitted", className: "badge badge-pending", Icon: Clock },
  approved: { word: "Approved", className: "badge badge-applied", Icon: CircleCheck },
  declined: { word: "Declined", className: "badge badge-rejected", Icon: CircleX },
} as const;

export function ApplicationPage({ id }: { id: string }) {
  const [application, setApplication] = useState<Application | null>(null);
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState("");
  const [email] = useState(() => (arrival?.id === id ? arrival.email : null));

  useEffect(() => {
    arrival = null;
    api<{ application: Application }>("GET", `/api/retailer-applications/${encodeURIComponent(id)}`)
      .then((body) => setApplication(body.application))
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
        else setFailure(failureMessage(error));
      });
  }, [id]);

  if (missing) {
    return (
      <div className="page page-narrow">
        <h1>We couldn't find that page.</h1>
      </div>
    );
  }

  const badge = application ? STATUS_BADGE[application.status] : null;
  return (
    <div className="page page-narrow">
      <h1>Application received</h1>
      <p className="lede" role="status">
        {email ? `Application received. We'll reply to ${email} within 5 business days.` : failure}
      </p>
      <div className="panel" aria-busy={application === null}>
        {application && badge ? (
          <dl className="sub-facts">
            <div>
              <dt>Business</dt>
              <dd>{application.business_name}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={badge.className}>
                  <badge.Icon aria-hidden="true" size={16} />
                  {badge.word}
                </span>
              </dd>
            </div>
            <div>
              <dt>Received on</dt>
              <dd>{longDateTime(new Date(application.submitted_at))}</dd>
            </div>
          </dl>
        ) : (
          !failure && <div className="skeleton record-skeleton" />
        )}
      </div>
    </div>
  );
}
