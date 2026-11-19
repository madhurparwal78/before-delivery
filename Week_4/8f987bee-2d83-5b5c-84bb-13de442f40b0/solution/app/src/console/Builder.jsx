import { useState } from "react";
import YAML from "yaml";
import Field from "../components/Field.jsx";
import { Discs } from "../components/Icons.jsx";
import { useTabs } from "../components/Tabs.jsx";
import { api, outageCopy, PERMISSION } from "./api.js";
import { useConsole } from "./context.js";

const STARTING_MANIFEST = {
  base_url: "/mock-api/v1",
  auth: { type: "api_key", header: "X-Api-Key" },
  streams: [{ name: "invoices", path: "/invoices", primary_key: ["id"], record_selector: "data", paginator: { page_size: 3 } }],
};
const UNREADABLE = "This YAML can't be read. Fix it before switching tabs.";
const FIELD_OF = {
  base_url: "baseUrl", "streams.0.name": "streamName", "streams.0.path": "path",
  "streams.0.paginator.page_size": "pageSize", stream: "streamName",
};

export default function Builder() {
  const { editor, report } = useConsole();
  const [manifest, setManifest] = useState(STARTING_MANIFEST);
  const [yamlText, setYamlText] = useState(() => YAML.stringify(STARTING_MANIFEST));
  const [unreadable, setUnreadable] = useState(false);
  const { selected, tabProps, panelProps } = useTabs(["UI", "YAML"], 0, () => !unreadable);
  const [projectId, setProjectId] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const stream = manifest.streams?.[0] ?? {};

  const edit = (next) => {
    setManifest(next);
    setYamlText(YAML.stringify(next));
  };
  const editStream = (patch) => edit({ ...manifest, streams: [{ ...stream, ...patch }, ...manifest.streams.slice(1)] });
  // Readable means valid YAML whose top level is a mapping and whose `streams`, when present, is a list.
  const editYaml = (text) => {
    setYamlText(text);
    let parsed;
    try {
      parsed = YAML.parse(text);
    } catch {
      parsed = undefined;
    }
    const readable = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      && (parsed.streams === undefined || Array.isArray(parsed.streams));
    if (readable) setManifest(parsed);
    setUnreadable(!readable);
  };

  const refused = (response) => {
    if (response.body?.error === "validation") {
      setStatus("");
      setErrors(Object.fromEntries(Object.entries(response.body.fields).map(([key, message]) => [FIELD_OF[key] ?? "yaml", message])));
    } else {
      setStatus(response.outage ? outageCopy(response) : PERMISSION);
      report(response);
    }
  };

  const save = async () => {
    const body = { name: `${stream.name || "untitled"} connector`, manifest };
    const response = projectId
      ? await api(`/api/builder/projects/${projectId}`, { method: "PUT", body })
      : await api("/api/builder/projects", { method: "POST", body });
    if (response.ok) setProjectId(response.body.project.id);
    return response;
  };

  const test = async () => {
    setPending(true);
    setErrors({});
    setStatus("Reading pages…");
    const saved = await save();
    if (!saved.ok) {
      setPending(false);
      refused(saved);
      return;
    }
    const response = await api(`/api/builder/projects/${saved.body.project.id}/test`, {
      method: "POST", body: { stream: stream.name, api_key: apiKey },
    });
    setPending(false);
    if (response.ok) {
      setResult(response.body);
      setStatus(`Test read finished: ${response.body.records.length} records`);
    } else if (response.body?.error === "source_http_error") {
      setResult(null);
      setStatus(`The sandbox refused the request (HTTP ${response.body.http_status}).`);
    } else refused(response);
  };

  const publish = async () => {
    setPending(true);
    setStatus("Publishing…");
    const response = projectId
      ? await api(`/api/builder/projects/${projectId}/publish`, { method: "POST", body: {} })
      : { ok: false, body: { error: "stream_not_tested" } };
    setPending(false);
    if (response.ok) setStatus(`Published version ${response.body.definition.version}`);
    else if (response.body?.error === "stream_not_tested") setStatus("Test every stream before publishing.");
    else refused(response);
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Builder</h1></div>
      <div className="split">
        <section className="panel" aria-label="Manifest">
          <div role="tablist" aria-label="Manifest view" className="tablist">
            <button {...tabProps(0)}>UI</button>
            <button {...tabProps(1)}>YAML</button>
          </div>
          <div {...panelProps(0)}>
            {selected === 0 && (
              <div className="form-grid">
                <Field label="Base URL" error={errors.baseUrl}>
                  {(control) => <input {...control} className="input code" type="text" value={manifest.base_url ?? ""} onChange={(e) => edit({ ...manifest, base_url: e.target.value })} />}
                </Field>
                <Field label="Stream name" error={errors.streamName}>
                  {(control) => <input {...control} className="input code" type="text" value={stream.name ?? ""} onChange={(e) => editStream({ name: e.target.value })} />}
                </Field>
                <Field label="Path" error={errors.path}>
                  {(control) => <input {...control} className="input code" type="text" value={stream.path ?? ""} onChange={(e) => editStream({ path: e.target.value })} />}
                </Field>
                <Field label="Page size" error={errors.pageSize}>
                  {(control) => <input {...control} className="input" type="number" min="1" max="100" value={stream.paginator?.page_size ?? ""}
                    onChange={(e) => editStream({ paginator: { ...stream.paginator, page_size: e.target.value === "" ? "" : Number(e.target.value) } })} />}
                </Field>
              </div>
            )}
          </div>
          <div {...panelProps(1)}>
            {selected === 1 && (
              <Field label="Manifest YAML" error={unreadable ? UNREADABLE : errors.yaml}>
                {(control) => <textarea {...control} className="textarea yaml" rows={16} spellCheck="false" value={yamlText} onChange={(e) => editYaml(e.target.value)} />}
              </Field>
            )}
          </div>
          {editor && (
            <div className="builder-run">
              <Field label="API key" hint="Used for this test read only; never stored.">
                {(control) => <input {...control} className="input" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />}
              </Field>
              <div className="form-actions">
                <button type="button" className="btn btn-primary" disabled={pending || unreadable} onClick={test}>Test</button>
                <button type="button" className="btn btn-outline" disabled={pending || unreadable} onClick={publish}>Publish</button>
              </div>
            </div>
          )}
          <p role="status" aria-label="Builder status" className="status-line builder-status">{status}</p>
        </section>
        <section className="panel results" aria-labelledby="results-title">
          <h2 id="results-title" className="panel-title">Results</h2>
          {!result && <p className="empty empty-stacked"><Discs />Run Test to read every page of the stream from the sandbox.</p>}
          {result && (
            <>
              <p className="figure-line"><strong className="num">{`${result.records.length} records`}</strong><span>{result.pages_read} pages read</span></p>
              <h3 className="label">Records</h3>
              <ul className="id-list code">{result.records.map((record) => <li key={String(record.id)}>{String(record.id)}</li>)}</ul>
              <h3 className="label">Detected fields</h3>
              <ul className="field-list code">
                {Object.entries(result.detected_schema).map(([name, type]) => <li key={name}>{`${name}: ${type}`}</li>)}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
