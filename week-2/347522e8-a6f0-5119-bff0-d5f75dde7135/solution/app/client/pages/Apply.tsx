import { type FormEvent, useEffect, useRef, useState } from "react";
import type { UserView } from "../../shared/api.js";
import { api } from "../api.js";
import { Field } from "../components/Field.js";
import { type Message, StatusRegion, failure, info } from "../components/Feedback.js";
import { copy } from "../copy.js";
import { navigate } from "../router.js";

const FIELDS = [
  { name: "business_name", label: "Business name", type: "text", autoComplete: "organization" },
  { name: "contact_name", label: "Your name", type: "text", autoComplete: "name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
] as const;

export function Apply({ onApplied }: { onApplied: (user: UserView, landing: { to: string; notice: string }) => void }) {
  const first = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => first.current?.focus(), []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage(info(copy.apply.pending));
    const result = await api<{ user: UserView }>("/api/applications", {
      method: "POST",
      json: Object.fromEntries(FIELDS.map((field) => [field.name, String(data.get(field.name) ?? "")])),
    });
    setPending(false);
    if (result.ok) {
      onApplied(result.data.user, { to: "/kitchen", notice: copy.apply.received });
      return;
    }
    setErrors(result.status === 422 ? (result.error.errors ?? {}) : {});
    setMessage(result.status === 422 ? null : failure(copy.unexpected));
  };

  return (
    <div className="entry">
      <div className="entry__column">
        <p className="entry__brand" aria-hidden="true">
          Railside <span className="entry__by">by Brigade &amp; Bench</span>
        </p>
        <h1 className="entry__heading">Apply for kitchen time</h1>
        <p className="entry__lede">Tell us about your business. Once you're signed in, upload your certificate of insurance, food-handler card and business licence for review.</p>
        <form className="panel form" aria-label="Apply" onSubmit={(event) => void submit(event)} noValidate>
          {FIELDS.map((field, index) => (
            <Field
              key={field.name}
              inputRef={index === 0 ? first : undefined}
              label={field.label}
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              error={errors[field.name] ?? null}
              hint={field.name === "password" ? "At least 10 characters." : undefined}
              required
            />
          ))}
          <StatusRegion name="Application status" message={message} />
          <button className="button button--primary" type="submit" disabled={pending}>
            Submit application
          </button>
        </form>
        <p className="entry__alt">
          Already renting?{" "}
          <a
            className="link"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/");
            }}
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
