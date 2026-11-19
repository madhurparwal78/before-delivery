import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Field, LiveStatus } from "../components/ui";
import { api, RequestError } from "../lib/api";

import { useSession } from "../lib/session";
import { useRefusalAlert } from "./Shell";

interface Definition {
  id: string;
  name: string;
  type: string;
  runnable: boolean;
  custom: boolean;
}

interface Source {
  id: string;
  name: string;
  definition_id: string;
  config: Record<string, unknown>;
}

export function Sources(): JSX.Element {
  const session = useSession();
  const mayWrite = session.user?.role === "admin" || session.user?.role === "editor";
  const [sources, setSources] = useState<Source[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [name, setName] = useState("");
  const [definitionId, setDefinitionId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [startDate, setStartDate] = useState("2026-01-01");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const alertFor = useRefusalAlert();

  const load = () => {
    void api<{ sources: Source[] }>("GET", "/api/sources")
      .then((answer) => setSources(answer.sources))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    void api<{ definitions: Definition[] }>("GET", "/api/connector-definitions?type=source")
      .then((answer) => {
        const usable = answer.definitions.filter((definition) => definition.runnable || definition.custom);
        setDefinitions(usable);
        setDefinitionId((held) => held || usable[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage("Creating source…");
    setFields({});
    try {
      await api("POST", "/api/sources", {
        body: {
          name,
          definition_id: definitionId,
          config: definitions.find((entry) => entry.id === definitionId)?.custom
            ? { api_key: apiKey }
            : { api_key: apiKey, start_date: startDate },
        },
      });
      setMessage("Source created");
      setName("");
      setApiKey("");
      load();
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "validation") {
        setFields(refusal.fields);
        setMessage("");
      } else if (refusal.code === "connector_not_installed") {
        setMessage("This connector is not installed.");
      } else {
        setMessage(alertFor(refusal) ?? "This source could not be created.");
      }
    } finally {
      setPending(false);
    }
  };

  const check = async (source: Source) => {
    setMessage("Checking…");
    try {
      const answer = await api<{ status: string; message?: string }>(
        "POST",
        `/api/sources/${source.id}/check`,
        { body: {} },
      );
      setMessage(answer.status === "succeeded" ? "Check succeeded" : `Check failed: ${answer.message}`);
    } catch (error) {
      setMessage(alertFor(error as RequestError) ?? "Check failed");
    }
  };

  return (
    <>
      <h1>Sources</h1>
      {mayWrite ? (
        <form className="panel" onSubmit={create}>
          <h2>New source</h2>
          <Field label="Name" error={fields.name}>
            {(attributes) => (
              <input {...attributes} type="text" value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Connector" error={fields.definition_id}>
            {(attributes) => (
              <select {...attributes} value={definitionId} onChange={(event) => setDefinitionId(event.target.value)}>
                {definitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="API key" error={fields["config.api_key"]}>
            {(attributes) => (
              <input
                {...attributes}
                type="password"
                value={apiKey}
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
              />
            )}
          </Field>
          <Field label="Start date" error={fields["config.start_date"]} hint="YYYY-MM-DD">
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                inputMode="numeric"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="button" disabled={pending}>
            Create source
          </button>
          <LiveStatus name="Source form status" message={message} />
        </form>
      ) : (
        <LiveStatus name="Source form status" message={message} />
      )}
      <div className="panel">
        <h2>Connected sources</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Connector</th>
              <th scope="col">Start date</th>
              {mayWrite ? <th scope="col">Check</th> : null}
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <th scope="row">{source.name}</th>
                <td>{source.definition_id}</td>
                <td>{String(source.config.start_date ?? "—")}</td>
                {mayWrite ? (
                  <td>
                    <button type="button" className="button outline" onClick={() => void check(source)}>
                      Check
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <Link to="/app/destinations">Destinations and their tables</Link>
      </p>
    </>
  );
}
