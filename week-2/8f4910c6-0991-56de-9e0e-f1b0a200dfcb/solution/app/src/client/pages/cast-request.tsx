// The four-step cast request (/cast-request?step=1…4). Each Next is checked by the server; the draft and its
// idempotency key stay in this browser; leaving by an in-app link asks first.

import { useEffect, useRef, useState } from "react";
import { api, newKey } from "../api.js";
import { Link, definePage, navigate, useLeaveGuard, useLocation } from "../router.js";
import { Heading } from "../ui/heading.js";
import { Button } from "../ui/button.js";
import { FieldError, RadioGroup, TextArea, TextField } from "../ui/fields.js";
import { Problems, useFormErrors } from "../ui/problems.js";
import { AlertDialog } from "../ui/dialog.js";
import { clearTray, useTray } from "../tray.js";
import { formatDate } from "../../shared/format.js";
import { isIsoDate, isOfficeId } from "../../shared/zones.js";
import { CITY } from "../public-data.js";

interface Values {
  name: string;
  company: string;
  email: string;
  office: string;
  shootDate: string;
  brief: string;
}

interface Draft {
  values: Values;
  key: string;
}

const DRAFT_KEY = "rb.castRequest";
const EMPTY: Values = { name: "", company: "", email: "", office: "", shootDate: "", brief: "" };
const STEPS = ["Your tray", "Your details", "The job", "Review and send"];
const FIELDS: Record<string, string> = {
  talentSlugs: "cr-tray", name: "cr-name", company: "cr-company", email: "cr-email", office: "cr-office",
  shootDate: "cr-shoot", brief: "cr-brief",
};
const STEP_OF: Record<string, number> = { talentSlugs: 1, name: 2, company: 2, email: 2, office: 2, shootDate: 3, brief: 3 };

function loadDraft(): Draft {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as Draft | null;
    if (parsed && parsed.key) return { key: parsed.key, values: { ...EMPTY, ...parsed.values } };
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
  return { key: newKey(), values: EMPTY };
}

function CastRequestPage() {
  const { query } = useLocation();
  const step = Number(query.get("step"));
  const tray = useTray();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [sent, setSent] = useState<{ reference: string; city: string } | null>(null);
  const [leave, setLeave] = useState<{ href: string; source: HTMLElement | null } | null>(null);
  const form = useFormErrors(FIELDS);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const focusStep = useRef(false);
  const stay = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!(step >= 1 && step <= 4)) navigate("/cast-request?step=1", { replace: true });
  }, [step]);
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);
  useEffect(() => {
    if (focusStep.current) {
      focusStep.current = false;
      stepHeading.current?.focus();
    }
  }, [step]);
  useEffect(() => {
    if (sent) sentHeading.current?.focus();
  }, [sent]);

  useLeaveGuard(!sent, (href, source) => setLeave({ href, source }));

  const set = (key: keyof Values) => (value: string) => setDraft({ ...draft, values: { ...draft.values, [key]: value } });
  const body = { ...draft.values, talentSlugs: tray.map((item) => item.slug) };
  const go = (to: number) => {
    focusStep.current = true;
    navigate(`/cast-request?step=${to}`);
  };

  const next = async () => {
    setPending(true);
    const result = await api("POST", "/api/cast-requests/checks", { step, draft: body });
    setPending(false);
    if (result.ok) {
      form.clear();
      go(step + 1);
    } else if (!form.take(result.error)) {
      setNotice("Your details could not be checked. Try again in a moment.");
    }
  };

  const send = async () => {
    setPending(true);
    setNotice("");
    const result = await api<{ reference: string }>("POST", "/api/cast-requests", body, { idempotencyKey: draft.key });
    setPending(false);
    if (result.ok) {
      const office = draft.values.office;
      localStorage.removeItem(DRAFT_KEY);
      clearTray();
      setSent({ reference: result.data.reference, city: isOfficeId(office) ? CITY[office] : "" });
      return;
    }
    if (form.take(result.error)) {
      const first = Object.keys(result.error.errors ?? {})[0];
      if (first && STEP_OF[first] && STEP_OF[first] !== step) go(STEP_OF[first]);
      return;
    }
    if (result.status === 429) {
      setNotice(`Too many requests from this connection. Try again in ${String(result.error.retryAfterSeconds)} seconds.`);
    } else if (result.error.error === "idempotency_key_reused") {
      setDraft({ ...draft, key: newKey() });
      setNotice("This request changed after it was first sent. Send it again to submit the new version.");
    } else {
      setNotice("The cast request could not be sent. Try again in a moment.");
    }
  };

  if (sent) {
    return (
      <>
        <Heading lines={["Cast request"]} />
        <section className="panel">
          <h2 ref={sentHeading} tabIndex={-1}>Cast request sent</h2>
          <p>Cast request {sent.reference} sent. A booker in {sent.city} will reply by email.</p>
          <p><Link href="/boards">Back to the boards</Link></p>
        </section>
      </>
    );
  }

  const { values } = draft;
  const current = step >= 1 && step <= 4 ? step : 1;
  return (
    <>
      <Heading lines={["Cast request"]} />
      <p className="eyebrow num">Step {current} of 4</p>
      <form className="stepped-form" noValidate onSubmit={(event) => {
        event.preventDefault();
        void (current === 4 ? send() : next());
      }}>
        <Problems items={form.problems} />
        <h2 ref={stepHeading} tabIndex={-1}>{STEPS[current - 1]}</h2>
        {current === 1 ? (
          <div id="cr-tray" tabIndex={-1} className="step-tray">
            {tray.length ? (
              <ol className="summary-list">
                {tray.map((item) => <li key={item.slug}>{item.displayName}</li>)}
              </ol>
            ) : <p className="muted">Your tray is empty. Add talent from a board first.</p>}
            <FieldError id="cr-tray" error={form.error("talentSlugs")} />
            <p><Link href="/tray">Change the tray</Link></p>
          </div>
        ) : null}
        {current === 2 ? (
          <>
            <TextField id="cr-name" label="Your name" value={values.name} onChange={set("name")} autoComplete="name"
              error={form.error("name")} />
            <TextField id="cr-company" label="Company" value={values.company} onChange={set("company")}
              autoComplete="organization" error={form.error("company")} />
            <TextField id="cr-email" label="Email" type="email" value={values.email} onChange={set("email")}
              autoComplete="email" error={form.error("email")} />
            <RadioGroup id="cr-office" label="Office" name="cr-office" value={values.office} onChange={set("office")}
              error={form.error("office")} choices={[{ value: "toronto", label: "Toronto" }, { value: "vancouver", label: "Vancouver" }]} />
          </>
        ) : null}
        {current === 3 ? (
          <>
            <TextField id="cr-shoot" label="Shoot date" type="date" value={values.shootDate} onChange={set("shootDate")}
              error={form.error("shootDate")} />
            <TextArea id="cr-brief" label="Brief" value={values.brief} onChange={set("brief")} error={form.error("brief")} />
          </>
        ) : null}
        {current === 4 ? (
          <dl className="review">
            <div><dt>Talent</dt><dd>{tray.map((item) => item.displayName).join(", ") || "None"}</dd></div>
            <div><dt>Your name</dt><dd>{values.name}</dd></div>
            <div><dt>Company</dt><dd>{values.company}</dd></div>
            <div><dt>Email</dt><dd>{values.email}</dd></div>
            <div><dt>Office</dt><dd>{isOfficeId(values.office) ? CITY[values.office] : ""}</dd></div>
            <div><dt>Shoot date</dt><dd>{isIsoDate(values.shootDate) ? formatDate(values.shootDate) : values.shootDate}</dd></div>
            <div><dt>Brief</dt><dd className="pre">{values.brief}</dd></div>
          </dl>
        ) : null}
        {notice ? <p role="alert" className="notice">{notice}</p> : null}
        <div className="sticky-bar step-bar">
          {current > 1 ? <Button variant="quiet" onClick={() => go(current - 1)}>Back</Button> : <span />}
          {current < 4
            ? <Button type="submit" pending={pending} pendingLabel="Checking…">Next</Button>
            : <Button type="submit" pending={pending} pendingLabel="Sending your cast request…">Send cast request</Button>}
        </div>
      </form>
      {leave ? (
        <AlertDialog title="Leave the cast request?" onClose={() => setLeave(null)} initialFocus={stay}
          returnFocus={() => leave.source} describedBy="leave-copy" actions={
            <>
              <Button ref={stay} variant="quiet" onClick={() => setLeave(null)}>Stay on the form</Button>
              <Button onClick={() => {
                const target = leave.href;
                setLeave(null);
                navigate(target, { force: true });
              }}>Leave</Button>
            </>
          }>
          <p id="leave-copy">Your cast request has not been sent. Your draft stays saved on this device.</p>
        </AlertDialog>
      ) : null}
    </>
  );
}

definePage({ pattern: "/cast-request", kind: "public", render: () => <CastRequestPage /> });
