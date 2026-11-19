import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import type { AdminAsset } from "../../shared/api.ts";
import { ASSET_CLASS_LABELS } from "../../shared/domain.ts";
import { api, get, upload } from "../lib/api.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { useLive } from "../lib/live.ts";
import { Alert, Button, Chip, Dialog, EmptyState, Loading, usePageStatus } from "../ui/index.ts";
import { useAction } from "../admin/useAction.ts";
import "../admin/admin.css";

const STATE_TONE = { draft: "lagoon", released: "meadow", restricted: "ember", retired: "stone" } as const;
const kilobytes = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** `/admin/assets` (owner): release, restrict and retire assets, and manage the derivatives of drafts. */
export function AdminAssets(_props: { params: string[] }): ReactNode {
  const [assets, setAssets] = useState<AdminAsset[] | null>(null);
  const [retiring, setRetiring] = useState<AdminAsset | null>(null);
  const say = usePageStatus();
  const action = useAction();
  useTitle("Assets");
  useHeadingFocus(assets !== null);

  const load = useCallback(async () => setAssets((await get<{ assets: AdminAsset[] }>("/api/admin/assets")).assets), []);
  useEffect(() => void load(), [load]);
  useLive(["library.updated"], () => void load());

  if (!assets) return <Loading />;
  const names = new Map(assets.map((a) => [a.id, a.name]));

  const transition = (asset: AdminAsset, verb: "release" | "restrict", done: string): Promise<boolean> =>
    action.run(`${verb}:${asset.id}`, async () => {
      await api("POST", `/api/assets/${asset.id}/${verb}`);
      await load();
      say(`${asset.name} ${done}.`);
    });

  const addDerivative = async (asset: AdminAsset, event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    await action.run(`upload:${asset.id}`, async () => {
      await upload(`/api/assets/${asset.id}/derivatives`, file);
      await load();
      say(`${file.name} added.`);
    });
    input.value = "";
  };

  const failure = (id: string): ReactNode => (action.error?.key.endsWith(`:${id}`) ? <Alert message={action.error.message} /> : null);

  return (
    <>
      <div className="screen-head" data-frame>
        <h1>Assets</h1>
        <p className="muted">Release, restrict and retire the brand's files. Drafts take derivatives until they are released.</p>
      </div>
      {assets.length === 0 ? (
        <EmptyState glyph="empty">There are no assets.</EmptyState>
      ) : (
        <div className="table-cell" data-frame>
          <div className="table-wrap">
            <table className="table table-stack" aria-label="Assets">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Class</th>
                  <th scope="col">State</th>
                  <th scope="col">Derivatives</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td data-label="Asset">
                      <strong>{asset.name}</strong>
                      {asset.successorId ? <div className="muted">Successor: {names.get(asset.successorId) ?? asset.successorId}</div> : null}
                    </td>
                    <td data-label="Class">{ASSET_CLASS_LABELS[asset.class]}</td>
                    <td data-label="State">
                      <Chip tone={STATE_TONE[asset.state]}>{asset.state}</Chip>
                    </td>
                    <td data-label="Derivatives">
                      <ul className="derivative-list">
                        {asset.derivatives.map((d) => (
                          <li key={d.id}>
                            <span>
                              {d.fileName} · {d.width} x {d.height} · {d.format.toUpperCase()} · {kilobytes(d.byteSize)}
                              {d.variant ? ` · ${d.variant}` : ""}
                            </span>
                            {asset.state === "draft" ? (
                              <Button
                                pending={action.busy === `remove:${asset.id}` && "save"}
                                onClick={() =>
                                  void action.run(`remove:${asset.id}`, async () => {
                                    await api("DELETE", `/api/derivatives/${d.id}`);
                                    await load();
                                    say(`${d.fileName} removed.`);
                                  })
                                }
                              >
                                {`Remove ${d.fileName}`}
                              </Button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      {asset.derivatives.length === 0 ? <span className="muted">None</span> : null}
                      {asset.state === "draft" ? (
                        <div className="field">
                          <label htmlFor={`add-${asset.id}`}>{`Add derivative to ${asset.name}`}</label>
                          <input id={`add-${asset.id}`} type="file" disabled={action.busy === `upload:${asset.id}`} onChange={(event) => void addDerivative(asset, event)} />
                          {action.busy === `upload:${asset.id}` ? <span role="status">Uploading</span> : null}
                        </div>
                      ) : null}
                    </td>
                    <td data-label="Actions">
                      <div className="cell-actions">
                        <Button
                          primary
                          disabled={asset.state !== "draft" && asset.state !== "restricted"}
                          pending={action.busy === `release:${asset.id}` && "save"}
                          onClick={() => void transition(asset, "release", "released")}
                        >
                          {`Release ${asset.name}`}
                        </Button>
                        <Button
                          disabled={asset.state !== "released"}
                          pending={action.busy === `restrict:${asset.id}` && "save"}
                          onClick={() => void transition(asset, "restrict", "restricted")}
                        >
                          {`Restrict ${asset.name}`}
                        </Button>
                        <Button disabled={asset.state !== "released" && asset.state !== "restricted"} onClick={() => setRetiring(asset)}>
                          {`Retire ${asset.name}`}
                        </Button>
                      </div>
                      {failure(asset.id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {retiring ? (
        <RetireDialog
          asset={retiring}
          candidates={assets.filter((a) => a.state === "released" && a.id !== retiring.id)}
          onClose={() => setRetiring(null)}
          onRetired={async () => {
            const name = retiring.name;
            setRetiring(null);
            await load();
            say(`${name} retired.`);
          }}
        />
      ) : null}
    </>
  );
}

function RetireDialog({ asset, candidates, onClose, onRetired }: { asset: AdminAsset; candidates: AdminAsset[]; onClose: () => void; onRetired: () => Promise<void> }): ReactNode {
  const [successor, setSuccessor] = useState("");
  const action = useAction();
  return (
    <Dialog name={`Retire ${asset.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run("retire", async () => {
            await api("POST", `/api/assets/${asset.id}/retire`, { successorAssetId: successor });
            await onRetired();
          });
        }}
      >
        <h2>{`Retire ${asset.name}`}</h2>
        <p className="muted">Open requests on this asset are rejected and its card points to the successor.</p>
        <div className="field">
          <label htmlFor="retire-successor">Successor</label>
          <select id="retire-successor" value={successor} onChange={(event) => setSuccessor(event.target.value)}>
            <option value="">Choose a released asset</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <Alert message={action.error?.message} />
        <div className="dialog-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button primary type="submit" pending={action.busy === "retire" && "save"}>
            Retire asset
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
