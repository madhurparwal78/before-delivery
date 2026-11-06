// The new-face application (/apply?step=1…5): About you, Your story, Photos, Guardian (minors only, as the
// server decides), Review. Each Next saves the step to the server draft; the draft id and token stay in this
// browser so a reload restores the step and its values. On a phone the sticky Back/Next bar never covers
// the focused field.

import { useEffect, useRef, useState, type FocusEvent } from "react";
import { api } from "../api.js";
import { definePage, navigate, useLocation } from "../router.js";
import { Heading } from "../ui/heading.js";
import { Button } from "../ui/button.js";
import { FieldError, RadioGroup, TextArea, TextField } from "../ui/fields.js";
import { Problems, useFormErrors } from "../ui/problems.js";
import { StatusLine, useAnnouncer } from "../ui/status.js";
import { PHONE } from "../ui/media.js";
import { BIO_LIMIT, graphemeCount } from "../../shared/text.js";
import { formatDate } from "../../shared/format.js";
import { isIsoDate, isOfficeId } from "../../shared/zones.js";
import { CITY } from "../public-data.js";
import { STORAGE_DOWN } from "../workspace/data.js";

interface Values {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  office: string;
  height: string;
  heightUnit: string;
  instagram: string;
  bio: string;
  guardianName: string;
  guardianEmail: string;
}

interface Draft {
  firstName?: string;
  lastName?: string;
  email?: string;
  dateOfBirth?: string | null;
  office?: string;
  height: { value: number; unit: "cm" } | null;
  instagramFollowers?: number | null;
  bio?: string;
  guardianName?: string;
  guardianEmail?: string;
  minor?: boolean;
  photos: Array<{ slot: string }>;
}

const EMPTY: Values = { firstName: "", lastName: "", email: "", dateOfBirth: "", office: "", height: "", heightUnit: "cm",
  instagram: "", bio: "", guardianName: "", guardianEmail: "" };
const CREDS_KEY = "rb.application";
const STEPS = ["About you", "Your story", "Photos", "Guardian", "Review"];
const SLOTS = [
  { slot: "front", label: "Front" },
  { slot: "profile", label: "Profile" },
  { slot: "full_length", label: "Full-length" },
  { slot: "smile", label: "Smiling" },
];
const FIELDS: Record<string, string> = {
  firstName: "ap-first", lastName: "ap-last", email: "ap-email", dateOfBirth: "ap-dob", office: "ap-office",
  height: "ap-height", instagramFollowers: "ap-instagram", bio: "ap-bio", guardianName: "ap-guardian-name",
  guardianEmail: "ap-guardian-email", front: "ap-photo-front", profile: "ap-photo-profile",
  full_length: "ap-photo-full_length", smile: "ap-photo-smile",
};
const STEP_OF: Record<string, number> = { firstName: 1, lastName: 1, email: 1, dateOfBirth: 1, office: 1, height: 2,
  instagramFollowers: 2, bio: 2, front: 3, profile: 3, full_length: 3, smile: 3, photos: 3, guardianName: 4, guardianEmail: 4 };

interface Creds {
  id: string;
  token: string;
}

function readCreds(): Creds | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CREDS_KEY) ?? "null") as Creds | null;
    return parsed?.id && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function fromDraft(draft: Draft): Values {
  return {
    firstName: draft.firstName ?? "",
    lastName: draft.lastName ?? "",
    email: draft.email ?? "",
    dateOfBirth: draft.dateOfBirth ?? "",
    office: draft.office ?? "",
    height: draft.height ? String(draft.height.value) : "",
    heightUnit: "cm",
    instagram: draft.instagramFollowers === null || draft.instagramFollowers === undefined ? "" : String(draft.instagramFollowers),
    bio: draft.bio ?? "",
    guardianName: draft.guardianName ?? "",
    guardianEmail: draft.guardianEmail ?? "",
  };
}

function ApplyPage() {
  const { query } = useLocation();
  const step = Number(query.get("step") ?? "1");
  const [creds, setCreds] = useState<Creds | null>(readCreds);
  const [values, setValues] = useState<Values>(EMPTY);
  const [minor, setMinor] = useState<boolean | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [loaded, setLoaded] = useState(!readCreds());
  const { message, announce } = useAnnouncer();
  const form = useFormErrors(FIELDS);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusStep = useRef(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!(step >= 1 && step <= 5)) navigate("/apply?step=1", { replace: true });
  }, [step]);

  useEffect(() => {
    const saved = readCreds();
    if (!saved) return;
    void api<Draft>("GET", `/api/applications/${encodeURIComponent(saved.id)}`, undefined,
      { headers: { "X-Application-Token": saved.token } }).then((result) => {
      if (result.ok) {
        setValues(fromDraft(result.data));
        setMinor(result.data.minor ?? null);
        setAdded(Object.fromEntries(result.data.photos.map((photo) => [photo.slot, true])));
      } else {
        localStorage.removeItem(CREDS_KEY);
        setCreds(null);
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (focusStep.current) {
      focusStep.current = false;
      heading.current?.focus();
    }
  }, [step]);

  const set = (key: keyof Values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  const go = (to: number) => {
    focusStep.current = true;
    navigate(`/apply?step=${to}`);
  };
  const tokenHeader = (c: Creds) => ({ headers: { "X-Application-Token": c.token } });

  const ensureDraft = async (): Promise<Creds | null> => {
    if (creds) return creds;
    const result = await api<{ id: string; token: string }>("POST", "/api/applications",
      { office: isOfficeId(values.office) ? values.office : "toronto" });
    if (!result.ok) {
      announce(result.status === 429
        ? `Too many requests from this connection. Try again in ${String(result.error.retryAfterSeconds)} seconds.`
        : "The application could not be started. Try again in a moment.");
      return null;
    }
    const made = { id: result.data.id, token: result.data.token };
    localStorage.setItem(CREDS_KEY, JSON.stringify(made));
    setCreds(made);
    return made;
  };

  const stepFields = (): Record<string, unknown> => {
    if (step === 1) {
      return { firstName: values.firstName, lastName: values.lastName, email: values.email,
        dateOfBirth: values.dateOfBirth, office: values.office };
    }
    if (step === 2) {
      const typed = values.height.trim();
      const instagram = values.instagram.replace(/,/g, "").trim();
      return {
        height: { value: values.heightUnit === "cm" && /^\d+$/.test(typed) ? Number(typed) : typed, unit: values.heightUnit },
        instagramFollowers: instagram === "" ? null : /^\d+$/.test(instagram) ? Number(instagram) : instagram,
        bio: values.bio,
      };
    }
    return { guardianName: values.guardianName, guardianEmail: values.guardianEmail };
  };

  const after = (from: number, isMinor: boolean | null) => (from === 3 ? (isMinor ? 4 : 5) : from + 1);

  const next = async () => {
    if (step === 3) {
      form.clear();
      go(after(3, minor));
      return;
    }
    setPending(true);
    announce("Saving…");
    const draft = await ensureDraft();
    if (!draft) {
      setPending(false);
      return;
    }
    const result = await api<Draft>("PATCH", `/api/applications/${encodeURIComponent(draft.id)}`, stepFields(), tokenHeader(draft));
    setPending(false);
    if (result.ok) {
      form.clear();
      setMinor(result.data.minor ?? null);
      announce("Step saved.");
      go(after(step, result.data.minor ?? null));
    } else if (!form.take(result.error, announce)) {
      announce(result.error.error === "already_submitted" ? "This application was already sent."
        : "The step could not be saved. Try again in a moment.");
    }
  };

  const back = () => go(step === 5 && !minor ? 3 : step - 1);

  const upload = async (slot: string, label: string, file: File | undefined) => {
    if (!file) return;
    const draft = await ensureDraft();
    if (!draft) return;
    setUploading(slot);
    announce(`Uploading ${label.toLowerCase()} photo…`);
    const body = new FormData();
    body.append("file", file);
    const result = await api("PUT", `/api/applications/${encodeURIComponent(draft.id)}/photos/${slot}`, body, tokenHeader(draft));
    setUploading(null);
    const errors = { ...form.errors };
    delete errors[slot];
    if (result.ok) {
      form.set(errors);
      setAdded((current) => ({ ...current, [slot]: true }));
      announce(`${label} photo added.`);
      return;
    }
    if (result.status === 503) {
      announce(STORAGE_DOWN);
      return;
    }
    const copy = result.status === 413 ? "That photo is larger than 8,000,000 bytes."
      : result.error.errors?.file ?? "That file is not a JPEG, PNG or WebP photo.";
    form.set({ ...errors, [slot]: copy });
    announce(copy);
  };

  const sendApplication = async () => {
    if (!creds) return;
    setPending(true);
    announce("Sending application…");
    const result = await api<{ status: string; minor: boolean }>("POST",
      `/api/applications/${encodeURIComponent(creds.id)}/submit`, {}, tokenHeader(creds));
    setPending(false);
    if (result.ok) {
      localStorage.removeItem(CREDS_KEY);
      setSent(true);
      announce(result.data.minor
        ? "Application sent. We have emailed your guardian for consent and will review it once they approve."
        : "Application sent. Our scouts will be in touch by email.");
      return;
    }
    if (form.take(result.error, announce)) {
      const steps = Object.keys(result.error.errors ?? {}).map((key) => STEP_OF[key] ?? 5);
      if (steps.length) go(Math.min(...steps));
      return;
    }
    announce(result.error.error === "already_submitted" ? "This application was already sent."
      : "The application could not be sent. Try again in a moment.");
  };

  const keepAboveBar = (event: FocusEvent<HTMLFormElement>) => {
    const target = event.target;
    if (!matchMedia(PHONE).matches || !bar.current || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement) || target.type === "radio" || target.type === "file") return;
    const field = target.getBoundingClientRect();
    const top = bar.current.getBoundingClientRect().top;
    if (field.bottom > top - 8) window.scrollBy(0, field.bottom - top + 16);
  };

  if (sent) {
    return (
      <div className="apply-page">
        <Heading lines={["Apply to Vesper & Rowe"]} />
        <StatusLine name="Application" message={message} />
        <section className="panel">
          <h2>Thank you</h2>
          <p className="muted">Keep an eye on your inbox; we reply to every application.</p>
        </section>
      </div>
    );
  }

  const current = step >= 1 && step <= 5 ? step : 1;
  return (
    <div className="apply-page">
      <Heading lines={["Apply to", "Vesper & Rowe"]} />
      <p className="lede">New faces from Toronto and Vancouver: tell us about yourself and add four photos. It takes about
        ten minutes, and you can come back to it on this device.</p>
      <StatusLine name="Application" message={message} />
      <p className="eyebrow num">Step {current === 5 && !minor ? 4 : current} of {minor ? 5 : 4}</p>
      {!loaded ? <p className="muted">Loading your application…</p> : (
        <form className="stepped-form" noValidate onFocus={keepAboveBar} onSubmit={(event) => {
          event.preventDefault();
          void (current === 5 ? sendApplication() : next());
        }}>
          <Problems items={form.problems} />
          <h2 ref={heading} tabIndex={-1}>{STEPS[current - 1]}</h2>
          {current === 1 ? (
            <>
              <TextField id="ap-first" label="First name" value={values.firstName} onChange={set("firstName")}
                autoComplete="given-name" error={form.error("firstName")} />
              <TextField id="ap-last" label="Last name" value={values.lastName} onChange={set("lastName")}
                autoComplete="family-name" error={form.error("lastName")} />
              <TextField id="ap-email" label="Email" type="email" value={values.email} onChange={set("email")}
                autoComplete="email" error={form.error("email")} />
              <TextField id="ap-dob" label="Date of birth" type="date" value={values.dateOfBirth}
                onChange={set("dateOfBirth")} autoComplete="bday" error={form.error("dateOfBirth")} />
              <RadioGroup id="ap-office" label="Office" name="ap-office" value={values.office} onChange={set("office")}
                error={form.error("office")} choices={[{ value: "toronto", label: "Toronto" }, { value: "vancouver", label: "Vancouver" }]} />
            </>
          ) : null}
          {current === 2 ? (
            <>
              <RadioGroup id="ap-unit" label="Height unit" name="ap-unit" value={values.heightUnit} onChange={set("heightUnit")}
                choices={[{ value: "cm", label: "cm" }, { value: "ft_in", label: "ft and in" }]} />
              <TextField id="ap-height" label="Height" inputMode={values.heightUnit === "cm" ? "numeric" : "text"}
                value={values.height} onChange={set("height")} error={form.error("height")}
                hint={values.heightUnit === "cm" ? "In centimetres, for example 171" : "For example 5 ft 7 in"} />
              <TextField id="ap-instagram" label="Instagram followers" inputMode="numeric" value={values.instagram}
                onChange={set("instagram")} error={form.error("instagramFollowers")} />
              <TextArea id="ap-bio" label="Bio" value={values.bio} onChange={set("bio")} error={form.error("bio")}
                hint={<span className="num">{graphemeCount(values.bio)} of {BIO_LIMIT}</span>} />
            </>
          ) : null}
          {current === 3 ? (
            <div className="photo-slots">
              {SLOTS.map(({ slot, label }) => (
                <div key={slot} className="photo-slot">
                  <label htmlFor={`ap-photo-${slot}`} className="btn-quiet photo-pick">{label} photo</label>
                  <input id={`ap-photo-${slot}`} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden"
                    aria-describedby={form.error(slot) ? `ap-photo-${slot}-error` : `ap-photo-${slot}-state`}
                    onChange={(event) => void upload(slot, label, event.target.files?.[0])} />
                  <p id={`ap-photo-${slot}-state`} className="muted">
                    {uploading === slot ? "Uploading…" : added[slot] ? "Added" : "Not added yet"}
                  </p>
                  <FieldError id={`ap-photo-${slot}`} error={form.error(slot)} />
                </div>
              ))}
            </div>
          ) : null}
          {current === 4 ? (
            <>
              <p className="muted">Because you are under 18, a parent or guardian approves your application by email
                before our scouts review it.</p>
              <TextField id="ap-guardian-name" label="Guardian name" value={values.guardianName} onChange={set("guardianName")}
                error={form.error("guardianName")} />
              <TextField id="ap-guardian-email" label="Guardian email" type="email" value={values.guardianEmail}
                onChange={set("guardianEmail")} error={form.error("guardianEmail")} />
            </>
          ) : null}
          {current === 5 ? (
            <dl className="review">
              <div><dt>Name</dt><dd>{values.firstName} {values.lastName}</dd></div>
              <div><dt>Email</dt><dd>{values.email}</dd></div>
              <div><dt>Date of birth</dt><dd>{isIsoDate(values.dateOfBirth) ? formatDate(values.dateOfBirth) : ""}</dd></div>
              <div><dt>Office</dt><dd>{isOfficeId(values.office) ? CITY[values.office] : ""}</dd></div>
              <div><dt>Photos</dt><dd className="num">{SLOTS.filter(({ slot }) => added[slot]).length} of 4 added</dd></div>
              {minor ? <div><dt>Guardian</dt><dd>{values.guardianName} ({values.guardianEmail})</dd></div> : null}
            </dl>
          ) : null}
          <div ref={bar} className="sticky-bar step-bar">
            {current > 1 ? <Button variant="quiet" onClick={back}>Back</Button> : <span />}
            {current < 5
              ? <Button type="submit" pending={pending} pendingLabel="Saving…">Next</Button>
              : <Button type="submit" pending={pending} pendingLabel="Sending application…">Send application</Button>}
          </div>
        </form>
      )}
    </div>
  );
}

definePage({ pattern: "/apply", kind: "public", render: () => <ApplyPage /> });
