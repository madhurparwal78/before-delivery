import { useEffect, useState } from "react";
import { parse, stringify } from "yaml";
import { Field, LiveStatus, TabPanel, Tabs } from "../components/ui";
import { api, RequestError } from "../lib/api";
import { UNREADABLE_YAML_COPY } from "../lib/copy";
import { useSession } from "../lib/session";
import { useRefusalAlert } from "./Shell";

interface Manifest {
  base_url: string;
  auth: { type: string; header: string };
  streams: {
    name: string;
    path: string;
    primary_key: string[];
    record_selector: string;
    paginator: { page_size: number };
  }[];
}

const STARTING_MANIFEST: Manifest = {
  base_url: "/mock-api/v1",
  auth: { type: "api_key", header: "X-Api-Key" },
  streams: [
    {
      name: "invoices",
      path: "/invoices",
      primary_key: ["id"],
      record_selector: "data",
      paginator: { page_size: 3 },
    },
  ],
};

interface Project {
  id: string;
  name: string;
  manifest: Manifest;
  tested_streams: Record<string, Record<string, string>>;
  definition_id: string | null;
}

function readable(text: string): Manifest | null {
  try {
    const parsed = parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const manifest = parsed as Manifest;
    if (manifest.streams !== undefined && !Array.isArray(manifest.streams)) return null;
    return manifest;
  } catch {
    return null;
  }
}

export function Builder(): JSX.Element {
  const session = useSession();
  const mayWrite = session.user?.role === "admin" || session.user?.role === "editor";
  const [project, setProject] = useState<Project | null>(null);
  const [manifest, setManifest] = useState<Manifest>(STARTING_MANIFEST);
  const [yamlText, setYamlText] = useState(stringify(STARTING_MANIFEST));
  const [tab, setTab] = useState("ui");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{
    records: Record<string, unknown>[];
    detected_schema: Record<string, string>;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const alertFor = useRefusalAlert();
  const yamlBroken = readable(yamlText) === null;

  useEffect(() => {
    if (!mayWrite) return;
    void (async () => {
      const list = await api<{ projects: Project[] }>("GET", "/api/builder/projects");
      const held =
        list.projects[0] ??
        (
          await api<{ project: Project }>("POST", "/api/builder/projects", {
            body: { name: "Invoices API", manifest: STARTING_MANIFEST },
          })
        ).project;
      setProject(held);
      setManifest(held.manifest);
      setYamlText(stringify(held.manifest));
    })().catch(() => undefined);
  }, [mayWrite]);

  const save = async (next: Manifest) => {
    if (!project) return;
    setManifest(next);
    try {
      const answer = await api<{ project: Project }>("PUT", `/api/builder/projects/${project.id}`, {
        body: { name: project.name, manifest: next },
      });
      setProject(answer.project);
      setFields({});
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "validation") setFields(refusal.fields);
    }
  };

  const changeStream = (patch: Partial<Manifest["streams"][number]>) => {
    const next: Manifest = {
      ...manifest,
      streams: [{ ...manifest.streams[0], ...patch }],
    };
    setYamlText(stringify(next));
    void save(next);
  };

  const test = async () => {
    if (!project) return;
    setPending(true);
    setMessage("Reading pages…");
    setFields({});
    try {
      const answer = await api<{
        records: Record<string, unknown>[];
        pages_read: number;
        detected_schema: Record<string, string>;
      }>("POST", `/api/builder/projects/${project.id}/test`, {
        body: { stream: manifest.streams[0].name, api_key: apiKey },
      });
      setResults(answer);
      setMessage(`Test read finished: ${answer.records.length} records`);
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "source_http_error") {
        setMessage(`The sandbox refused the request (HTTP ${refusal.httpStatus}).`);
      } else if (refusal.code === "validation") {
        setFields(refusal.fields);
        setMessage("");
      } else {
        setMessage(alertFor(refusal) ?? "");
      }
    } finally {
      setPending(false);
    }
  };

  const publish = async () => {
    if (!project) return;
    setPending(true);
    setMessage("Publishing…");
    try {
      const answer = await api<{ definition: { version: number } }>(
        "POST",
        `/api/builder/projects/${project.id}/publish`,
        { body: {} },
      );
      setMessage(`Published version ${answer.definition.version}`);
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "stream_not_tested") setMessage("Test every stream before publishing.");
      else setMessage(alertFor(refusal) ?? "");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <h1>Connector Builder</h1>
      <div className="panel">
        <Tabs
          name="Builder manifest"
          tabs={[
            { id: "ui", label: "UI" },
            { id: "yaml", label: "YAML" },
          ]}
          selected={tab}
          onSelect={(next) => {
            if (next === "ui" && yamlBroken) return;
            if (next === "ui") {
              const parsed = readable(yamlText);
              if (parsed) setManifest(parsed);
            } else {
              setYamlText(stringify(manifest));
            }
            setTab(next);
          }}
        />
        <TabPanel id="ui" hidden={tab !== "ui"}>
          <Field label="Base URL" error={fields.base_url}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={manifest.base_url}
                onChange={(event) => {
                  const next = { ...manifest, base_url: event.target.value };
                  setYamlText(stringify(next));
                  void save(next);
                }}
              />
            )}
          </Field>
          <Field label="Stream name" error={fields["streams.0.name"]}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={manifest.streams[0]?.name ?? ""}
                onChange={(event) => changeStream({ name: event.target.value })}
              />
            )}
          </Field>
          <Field label="Path" error={fields["streams.0.path"]}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={manifest.streams[0]?.path ?? ""}
                onChange={(event) => changeStream({ path: event.target.value })}
              />
            )}
          </Field>
          <Field label="Page size" error={fields["streams.0.paginator.page_size"]}>
            {(attributes) => (
              <input
                {...attributes}
                type="number"
                min={1}
                max={100}
                value={manifest.streams[0]?.paginator.page_size ?? 3}
                onChange={(event) => changeStream({ paginator: { page_size: Number(event.target.value) } })}
              />
            )}
          </Field>
        </TabPanel>
        <TabPanel id="yaml" hidden={tab !== "yaml"}>
          <Field label="Manifest YAML" error={yamlBroken ? UNREADABLE_YAML_COPY : null}>
            {(attributes) => (
              <textarea
                {...attributes}
                value={yamlText}
                spellCheck={false}
                onChange={(event) => {
                  setYamlText(event.target.value);
                  const parsed = readable(event.target.value);
                  if (parsed) void save(parsed);
                }}
              />
            )}
          </Field>
        </TabPanel>
        <Field label="API key">
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
        {mayWrite ? (
          <div className="button-row">
            <button
              type="button"
              className="button"
              disabled={yamlBroken || pending}
              onClick={() => void test()}
            >
              Test
            </button>
            <button
              type="button"
              className="button outline"
              disabled={yamlBroken || pending}
              onClick={() => void publish()}
            >
              Publish
            </button>
          </div>
        ) : null}
        <LiveStatus name="Builder status" message={message} />
      </div>
      {results ? (
        <div className="panel builder-results">
          <h2>{results.records.length} records</h2>
          <ul>
            {results.records.map((record) => (
              <li key={String(record.id)}>{String(record.id)}</li>
            ))}
          </ul>
          <h3>Detected fields</h3>
          <ul>
            {Object.entries(results.detected_schema).map(([field, type]) => (
              <li key={field}>
                {field}: {type}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
