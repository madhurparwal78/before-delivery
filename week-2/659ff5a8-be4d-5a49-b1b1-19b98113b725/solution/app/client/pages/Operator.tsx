import { type FormEvent, useState } from "react";
import type { OperatorClub } from "../../shared/api.js";
import { localStamp } from "../../shared/time.js";
import { ApiFailure, api } from "../api.js";
import { Field, type FieldErrors, FixFields } from "../components/Forms.js";
import {
  LoadFailed,
  Skeleton,
  StatusRegion,
  ScrollBox,
} from "../components/ui.js";
import { useRefresh } from "../hooks.js";

const SERVICE_LABEL = {
  renderer: "Renderer",
  storage: "Storage",
  mail: "Mail",
} as const;

const EMPTY = {
  slug: "",
  name: "",
  timeZone: "",
  chairName: "",
  chairEmail: "",
  chairPassword: "",
};

const REQUIRED: Record<keyof typeof EMPTY, string> = {
  slug: "Enter a club slug.",
  name: "Enter a club name.",
  timeZone: "Enter a time zone such as America/Denver.",
  chairName: "Enter the chair's name.",
  chairEmail: "Enter the chair's email.",
  chairPassword: "Enter a password of at least 10 characters.",
};

/** The server names the chair's fields `chair.name`, `chair.email` and `chair.password`. */
const SERVER_FIELD: Record<string, keyof typeof EMPTY> = {
  slug: "slug",
  name: "name",
  timeZone: "timeZone",
  chair: "chairName",
  "chair.name": "chairName",
  "chair.email": "chairEmail",
  "chair.password": "chairPassword",
};

export function Operator() {
  const [clubs, setClubs] = useState<OperatorClub[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const reload = useRefresh(
    async () => {
      try {
        setClubs(
          (await api.get<{ clubs: OperatorClub[] }>("/api/operator/clubs"))
            .clubs,
        );
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    10,
    [],
  );
  return (
    <>
      <div className="page-head">
        <h1>Club workspaces</h1>
      </div>
      <StatusRegion name="Operator updates">{message}</StatusRegion>
      <div className="operator-layout">
        {clubs === null ? (
          failed ? (
            <LoadFailed retry={reload} />
          ) : (
            <Skeleton />
          )
        ) : (
          <ScrollBox label="Club workspaces scroll area">
            <table aria-label="Club workspaces" className="club-table">
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col">Time zone</th>
                  <th scope="col" className="num">
                    Events
                  </th>
                  <th scope="col" className="num">
                    Drivers
                  </th>
                  <th scope="col" className="num">
                    Published
                  </th>
                  <th scope="col">Last delivery failure</th>
                </tr>
              </thead>
              <tbody>
                {clubs.map((club) => (
                  <tr key={club.slug}>
                    <td>{club.name}</td>
                    <td>{club.timeZone}</td>
                    <td className="num">{club.eventCount}</td>
                    <td className="num">{club.driverCount}</td>
                    <td className="num">{club.publishedCount}</td>
                    <td>
                      {club.lastDeliveryFailure
                        ? `${SERVICE_LABEL[club.lastDeliveryFailure.service]} at ${localStamp(new Date(club.lastDeliveryFailure.at), "UTC")} UTC`
                        : "None"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollBox>
        )}
        <Onboard onMessage={setMessage} onCreated={reload} />
      </div>
    </>
  );
}

function Onboard({
  onMessage,
  onCreated,
}: {
  onMessage: (text: string) => void;
  onCreated: () => void;
}) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const missing = Object.fromEntries(
      (Object.keys(EMPTY) as (keyof typeof EMPTY)[])
        .filter((field) => values[field].trim() === "")
        .map((field) => [field, REQUIRED[field]]),
    );
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    setPending(true);
    onMessage("Creating workspace");
    try {
      await api.post("/api/operator/clubs", {
        slug: values.slug.trim(),
        name: values.name.trim(),
        timeZone: values.timeZone.trim(),
        chair: {
          name: values.chairName.trim(),
          email: values.chairEmail.trim(),
          password: values.chairPassword,
        },
      });
      onMessage(
        `Club ${values.name.trim()} is ready. ${values.chairName.trim()} can sign in now.`,
      );
      setValues(EMPTY);
      onCreated();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors(
          Object.fromEntries(
            Object.entries(error.fields).map(([field, text]) => [
              SERVER_FIELD[field] ?? "slug",
              text,
            ]),
          ),
        );
        onMessage("");
      } else if (error instanceof ApiFailure && error.code === "slug_taken")
        onMessage("That club slug is taken.");
      else if (error instanceof ApiFailure && error.code === "email_taken")
        onMessage("That email already has an account.");
      else onMessage("Could not create the workspace. Try again.");
    } finally {
      setPending(false);
    }
  };
  const bind = (field: keyof typeof EMPTY) => ({
    value: values[field],
    onChange: (e: { target: { value: string } }) =>
      setValues({ ...values, [field]: e.target.value }),
  });
  return (
    <form
      aria-label="Onboard club"
      className="panel stack"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <h2>Onboard a club</h2>
      <FixFields form="onboard" errors={errors} />
      <Field
        form="onboard"
        name="slug"
        label="Club slug"
        error={errors["slug"]}
      >
        {(p) => (
          <input type="text" autoCapitalize="none" {...p} {...bind("slug")} />
        )}
      </Field>
      <Field
        form="onboard"
        name="name"
        label="Club name"
        error={errors["name"]}
      >
        {(p) => <input type="text" {...p} {...bind("name")} />}
      </Field>
      <Field
        form="onboard"
        name="timeZone"
        label="Time zone"
        error={errors["timeZone"]}
      >
        {(p) => <input type="text" {...p} {...bind("timeZone")} />}
      </Field>
      <Field
        form="onboard"
        name="chairName"
        label="Chair name"
        error={errors["chairName"]}
      >
        {(p) => <input type="text" {...p} {...bind("chairName")} />}
      </Field>
      <Field
        form="onboard"
        name="chairEmail"
        label="Chair email"
        error={errors["chairEmail"]}
      >
        {(p) => <input type="email" {...p} {...bind("chairEmail")} />}
      </Field>
      <Field
        form="onboard"
        name="chairPassword"
        label="Chair password"
        error={errors["chairPassword"]}
      >
        {(p) => (
          <input
            type="password"
            role="textbox"
            autoComplete="new-password"
            {...p}
            {...bind("chairPassword")}
          />
        )}
      </Field>
      <div className="actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending}
          aria-busy={pending}
        >
          Onboard club
        </button>
      </div>
    </form>
  );
}
