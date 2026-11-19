import { useState, type FormEvent } from "react";
import { UserMinus } from "lucide-react";
import type { ClassroomEducator } from "../../shared/types";
import { Field } from "../forms/Field";
import { ApiError } from "../lib/api";
import { useStatus } from "../lib/status";
import { ASSISTANT_EMAIL_KEY, controlProps } from "./controls";
import { failureMessage } from "./failure";

interface InstructorsProps {
  educators: readonly ClassroomEducator[];
  /** Only the owner adds and removes Assistants. */
  isOwner: boolean;
  /** Adds the Assistant; throws the API error when the email is refused. */
  onAdd: (email: string) => Promise<void>;
  onRemove: (educator: ClassroomEducator) => void;
}

const FIELD_CODES = new Set(["already_added", "no_such_educator", "validation"]);

export function Instructors({ educators, isOwner, onAdd, onRemove }: InstructorsProps) {
  const { announce } = useStatus();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await onAdd(email);
      setEmail("");
      setError(undefined);
    } catch (failure) {
      if (failure instanceof ApiError && FIELD_CODES.has(failure.code)) {
        const message = failure.fields.email ?? failure.message;
        setError(message);
        announce(message);
      } else {
        announce(failureMessage(failure));
      }
    }
  };

  return (
    <section className="roster-section" aria-labelledby="instructors-heading">
      <h2 id="instructors-heading">Instructors</h2>
      <ul className="instructor-list" aria-label="Instructors">
        {educators.map((educator) => (
          <li key={educator.id} className="instructor">
            <div>
              <p className="instructor-name">{educator.displayName}</p>
              <p className="hint">{educator.role === "owner" ? "Owner" : "Assistant"} · {educator.email}</p>
            </div>
            {isOwner && educator.role === "assistant" ? (
              <button type="button" className="pill pill--danger-quiet pill--small" aria-label={`Remove ${educator.displayName}`} onClick={() => onRemove(educator)}>
                <UserMinus size={16} aria-hidden="true" />Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {isOwner ? (
        <form className="assistant-form" onSubmit={(event) => void submit(event)} noValidate>
          <Field label="Assistant's email" error={error}>
            {(control) => (
              <input
                {...control}
                {...controlProps(ASSISTANT_EMAIL_KEY)}
                type="email"
                value={email}
                autoComplete="off"
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            )}
          </Field>
          <button type="submit" className="pill">Add assistant</button>
        </form>
      ) : null}
    </section>
  );
}
