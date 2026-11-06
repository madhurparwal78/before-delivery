import { type FormEvent, useEffect, useRef, useState } from "react";
import type { UserView } from "../../shared/api.js";
import { api } from "../api.js";
import { Field } from "../components/Field.js";
import { type Message, StatusRegion, failure } from "../components/Feedback.js";
import { copy } from "../copy.js";
import { navigate } from "../router.js";

export function SignIn({ onSignedIn }: { onSignedIn: (user: UserView) => void }) {
  const email = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => email.current?.focus(), []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage(null);
    const result = await api<{ user: UserView }>("/api/session", {
      method: "POST",
      json: { email: data.get("email"), password: data.get("password") },
    });
    setPending(false);
    if (result.ok) onSignedIn(result.data.user);
    else setMessage(failure(result.status === 401 || result.status === 422 ? copy.signIn.mismatch : copy.unexpected));
  };

  return (
    <div className="entry">
      <div className="entry__column">
        <h1 className="entry__brand">
          Railside <span className="entry__by">by Brigade &amp; Bench</span>
        </h1>
        <p className="entry__lede">Booking and billing for the shared kitchen at 1187 West Larkin Avenue.</p>
        <form className="panel form" aria-label="Sign in" onSubmit={(event) => void submit(event)} noValidate>
          <h2 className="panel__title">Sign in</h2>
          <Field label="Email" name="email" type="email" autoComplete="username" required inputRef={email} />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          <StatusRegion name="Sign-in status" message={message} />
          <button className="button button--primary" type="submit" disabled={pending}>
            {pending ? copy.signIn.pending : "Sign in"}
          </button>
        </form>
        <p className="entry__alt">
          New renter?{" "}
          <a
            className="link"
            href="/apply"
            onClick={(event) => {
              event.preventDefault();
              navigate("/apply");
            }}
          >
            Apply for kitchen time
          </a>
        </p>
      </div>
    </div>
  );
}
