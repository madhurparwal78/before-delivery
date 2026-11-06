import { type FormEvent, useState } from "react";
import type { SessionUser } from "../../shared/api.js";
import { ApiFailure, api } from "../api.js";
import { Field, type FieldErrors, FixFields } from "../components/Forms.js";
import { ConeMark } from "../components/ui.js";
import { useNavigation } from "../router.js";
import { useSession } from "../session.js";

/** The server puts the club's name into the page it serves for a join link. */
function clubName(): string | null {
  const club = JSON.parse(document.getElementById("club")?.textContent ?? "null") as { name: string } | null;
  return club?.name ?? null;
}

export function Join({ slug }: { slug: string }) {
  const { setUser } = useSession();
  const { navigate } = useNavigation();
  const [name] = useState(clubName);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setMessage("Creating account");
    setErrors({});
    try {
      const { user } = await api.post<{ user: SessionUser }>(`/api/clubs/${slug}/signup`, values);
      setUser(user);
      navigate("/events");
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors(error.fields);
        setMessage("");
      } else if (error instanceof ApiFailure && error.code === "email_taken") setMessage("That email already has an account.");
      else setMessage("Could not create the account. Try again.");
    } finally {
      setPending(false);
    }
  };

  if (name === null) {
    return (
      <main className="auth main" id="main">
        <div className="auth-card">
          <h1>That club does not exist</h1>
          <p>Check the join link you were given.</p>
        </div>
      </main>
    );
  }
  const bind = (field: keyof typeof values) => ({
    value: values[field],
    onChange: (e: { target: { value: string } }) => setValues({ ...values, [field]: e.target.value }),
  });
  return (
    <main className="auth main" id="main">
      <div className="auth-card">
        <div className="auth-brand">
          <ConeMark size={32} />
          <span>Conecount Paddock</span>
        </div>
        <h1>Join {name}</h1>
        <form aria-label="Create driver account" onSubmit={(e) => void submit(e)} noValidate>
          <FixFields form="join" errors={errors} />
          <Field form="join" name="name" label="Full name" error={errors["name"]}>
            {(p) => <input type="text" autoComplete="name" {...p} {...bind("name")} />}
          </Field>
          <Field form="join" name="email" label="Email" error={errors["email"]}>
            {(p) => <input type="email" autoComplete="email" {...p} {...bind("email")} />}
          </Field>
          <Field form="join" name="password" label="Password" error={errors["password"]} hint="Use at least 10 characters.">
            {(p) => <input type="password" role="textbox" autoComplete="new-password" {...p} {...bind("password")} />}
          </Field>
          {message ? (
            <div role="alert" className="form-alert">
              {message}
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
            Create driver account
          </button>
        </form>
      </div>
    </main>
  );
}
