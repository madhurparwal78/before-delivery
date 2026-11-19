import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MEASURES, type MeasureName, type Rank } from "../../shared/protocol";
import { call } from "../lib/api";
import { showNotice } from "../lib/store";
import { useAction } from "../lib/useAction";
import { Chip, Empty, Loading, Status } from "../ui/Bits";
import { Icon } from "../ui/Icon";

interface Measures {
  triangles: number;
  materials: number;
  textureSize: number;
  fileSize: number;
}

interface UploadResult {
  assetId: string;
  version: number;
  rank: Rank;
  worstMeasure: MeasureName;
  measures: Measures;
  measureRanks: Record<MeasureName, Rank>;
}

interface VersionRow {
  version: number;
  status: "checked" | "published";
  rank: Rank;
}

interface AssetRow {
  id: string;
  kind: string;
  name: string;
  currentVersion: number | null;
}

interface Entry {
  asset: AssetRow;
  version: VersionRow;
}

const MEASURE_KEY: Record<MeasureName, keyof Measures> = {
  triangles: "triangles",
  materials: "materials",
  "texture size": "textureSize",
  "file size": "fileSize",
};

const STARTER_LAYOUT = JSON.stringify(
  {
    width: 10,
    height: 10,
    spawn: [{ x: 1, y: 1 }],
    walls: [{ x: 4, y: 4 }],
    seats: [{ id: "seat-1", x: 6, y: 2 }],
    exits: [{ id: "exit-1", x: 0, y: 5 }],
  },
  null,
  2,
);

export function Studio() {
  const [kind, setKind] = useState("room");
  const [name, setName] = useState("");
  const [layout, setLayout] = useState(STARTER_LAYOUT);
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const upload = useAction("Checking your file...");
  const versions = useAction("Saving...");

  const load = useCallback(async (): Promise<void> => {
    const mine = await call<{ assets: AssetRow[] }>("GET", "/api/assets?mine=true");
    if (!mine.ok) return;
    const details = await Promise.all(mine.data.assets.map((asset) => call<{ versions: VersionRow[] }>("GET", `/api/assets/${asset.id}`)));
    setEntries(mine.data.assets.flatMap((asset, index) => (details[index]?.data.versions ?? []).map((version) => ({ asset, version }))));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setUploaded(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("name", name);
    if (kind === "room") form.set("layout", layout);
    if (file) form.set("file", file, file.name);
    const reply = await upload.run<UploadResult>("POST", "/api/assets", form, (answer) => `Rank: ${answer.data.rank}. Worst measure: ${answer.data.worstMeasure}.`);
    if (reply.ok) {
      setUploaded(reply.data);
      await load();
    } else if (reply.status === 503) showNotice(reply.error);
  };

  const act = async (method: string, path: string, success: (reply: { data: unknown }) => string): Promise<void> => {
    const reply = await versions.run(method, path, undefined, success);
    if (reply.ok) await load();
    else if (reply.status === 503) showNotice(reply.error);
  };

  return (
    <>
      <h1 tabIndex={-1}>Studio</h1>
      <section className="panel">
        <h2>Upload a model</h2>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Kind</span>
            <select aria-label="Kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="room">room</option>
              <option value="avatar">avatar</option>
            </select>
          </label>
          <label className="field">
            <span>Model name</span>
            <input type="text" aria-label="Model name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span>Model file</span>
            <input type="file" accept=".glb,model/gltf-binary" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          {kind === "room" ? (
            <label className="field">
              <span>Room layout</span>
              <textarea aria-label="Room layout" rows={9} spellCheck={false} value={layout} onChange={(event) => setLayout(event.target.value)} />
            </label>
          ) : null}
          <div className="row">
            <button type="submit" className="button primary" disabled={upload.busy} aria-busy={upload.busy}>
              <Icon name="studio" size={18} /> Upload model
            </button>
          </div>
          <Status name="Upload result" result={upload.result} />
        </form>
        {uploaded ? (
          <table aria-label="Measures" className="measures">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Value</th>
                <th scope="col">Rank</th>
              </tr>
            </thead>
            <tbody>
              {MEASURES.map((measure) => (
                <tr key={measure}>
                  <td>{measure}</td>
                  <td className="mono">{uploaded.measures[MEASURE_KEY[measure]]}</td>
                  <td>{uploaded.measureRanks[measure]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
      <section className="panel">
        <h2>Your models and versions</h2>
        <Status name="Version result" result={versions.result} />
        {entries === null ? (
          <Loading />
        ) : entries.length === 0 ? (
          <Empty>Nothing uploaded yet. A checked model appears here with its rank.</Empty>
        ) : (
          <ul aria-label="Versions" className="cards">
            {entries.map(({ asset, version }) => (
              <li key={`${asset.id}-${version.version}`} data-version={version.version} data-version-status={version.status} className="row-card">
                <div>
                  <strong>{asset.name}</strong> <span className="muted">version {version.version}</span>
                  <div className="row tight">
                    <Chip>{asset.kind}</Chip>
                    <Chip tone={version.status === "published" ? "calm" : "accent"}>{version.status}</Chip>
                    <Chip>{version.rank}</Chip>
                  </div>
                </div>
                <div className="row tight">
                  {version.status === "checked" ? (
                    <button
                      type="button"
                      className="button primary"
                      aria-label="Publish version"
                      onClick={() => void act("POST", `/api/assets/${asset.id}/versions/${version.version}/publish`, () => `Version ${version.version} published.`)}
                    >
                      Publish
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button"
                    aria-label={`Restore version ${version.version}`}
                    onClick={() =>
                      void act("POST", `/api/assets/${asset.id}/versions/${version.version}/restore`, (reply) => `Version ${version.version} restored as version ${(reply.data as { version: number }).version}.`)
                    }
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Remove version ${version.version}`}
                    onClick={() => void act("DELETE", `/api/assets/${asset.id}/versions/${version.version}`, () => `Version ${version.version} removed.`)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
