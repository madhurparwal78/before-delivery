import { Download, Link as LinkIcon, Trash2, Upload, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ApiFailure } from "../api.ts";
import { api } from "../api.ts";
import type { ActivityEntry, AssetDoc, MemberDoc, SetListing } from "../../shared/types.ts";
import type { EditorStore } from "../store/editor.ts";
import { Modal } from "./Modal.tsx";

function EmptyPane({ text }: { text: string }) {
  return (
    <div className="empty-pane">
      <div className="embossed" aria-hidden="true" data-text={text} />
      <p className="empty-copy">{text}</p>
    </div>
  );
}

export function AssetsPane({ store, filter }: { store: EditorStore; filter: string }) {
  const [blocked, setBlocked] = useState<{ asset: AssetDoc; failure: ApiFailure } | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const query = filter.trim().toLowerCase();
  const assets = store.assets.filter((asset) => asset.name.toLowerCase().includes(query));
  return (
    <div className="pane">
      <div className="pane-bar">
        <button type="button" className="btn" disabled={!store.canEdit || store.mode !== "live"} onClick={() => pick.current?.click()}>
          <Upload size={12} aria-hidden="true" />
          Upload asset
        </button>
        <input
          ref={pick}
          type="file"
          className="visually-hidden"
          aria-label="Choose GLB or texture file"
          accept=".glb,image/png,image/jpeg"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void store.uploadAsset(file);
          }}
        />
      </div>
      {store.assets.length === 0 ? <EmptyPane text="No assets yet" /> : null}
      <ul aria-label="Asset shelf" className="rows">
        {assets.map((asset) => (
          <li key={asset.id} className="row-item asset">
            <span className="bullet" aria-hidden="true" />
            <span className="asset-name" title={asset.name}>{asset.name}</span>
            <span className={asset.status === "ready" ? "asset-status" : "asset-status bad"}>{asset.status}</span>
            <span className="muted">{asset.dependents.count} dependents</span>
            {store.role === "owner" ? (
              <button
                type="button"
                className="mini"
                aria-label={`Delete ${asset.name}`}
                onClick={() => void store.deleteAsset(asset).then((failure) => {
                  if (failure && (failure.code === "asset_in_use" || failure.code === "asset_in_shows")) setBlocked({ asset, failure });
                })}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {blocked ? <InUse blocked={blocked} onClose={() => setBlocked(null)} /> : null}
    </div>
  );
}

function InUse({ blocked, onClose }: { blocked: { asset: AssetDoc; failure: ApiFailure }; onClose: () => void }) {
  const { asset, failure } = blocked;
  const dependents = failure.detail.dependents;
  return (
    <Modal title="Asset still in use" role="alertdialog" onClose={onClose}>
      {(titleId) => (
        <>
          <h2 id={titleId} className="modal-title small">Asset still in use</h2>
          {failure.code === "asset_in_use" && dependents ? (
            <div className="modal-body">
              <p>{asset.name} is used by:</p>
              {dependents.layers.length > 0 ? <><h3>Layers</h3><ul>{dependents.layers.map((layer) => <li key={layer.id}>{layer.name}</li>)}</ul></> : null}
              {dependents.materials.length > 0 ? <><h3>Materials</h3><ul>{dependents.materials.map((layer) => <li key={layer.layer_id}>{layer.name}</li>)}</ul></> : null}
              {dependents.scripts.length > 0 ? <><h3>Scripts</h3><ul>{dependents.scripts.map((script) => <li key={script.id}>{script.name}</li>)}</ul></> : null}
            </div>
          ) : (
            <p className="modal-body">{asset.name} is part of published show versions {(failure.detail.show_versions ?? []).join(", ")}.</p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" data-autofocus onClick={onClose}>OK</button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function ShowsPane({ store }: { store: EditorStore }) {
  const [inviting, setInviting] = useState(false);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [download, setDownload] = useState<{ download_url: string; sha256: string } | null>(null);
  const owner = store.role === "owner";
  useEffect(() => {
    void store.refreshShows();
    void api.members(store.setId).then((found) => setMembers(found.members), () => undefined);
  }, [store.setId]);
  const shows = store.shows;
  const live = shows?.live_number ?? null;
  const url = shows ? `${location.origin}${shows.show_url}` : "";
  return (
    <div className="pane">
      <div className="pane-bar wrap">
        <button type="button" className="btn" disabled={!owner} onClick={() => void store.publish()}>Publish show</button>
        <button type="button" className="btn" disabled={!owner || live === null} onClick={() => void store.rollback()}>Roll back</button>
        {shows ? (
          <a className="btn link-btn" href={shows.show_url} target="_blank" rel="noreferrer">
            <LinkIcon size={12} aria-hidden="true" />
            Show link
          </a>
        ) : null}
        <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(url).then(() => store.announce("Show link copied"), () => undefined)}>Copy show link</button>
      </div>
      {shows && shows.versions.length === 0 ? <EmptyPane text="No show versions yet" /> : null}
      <ul aria-label="Show versions" className="rows">
        {(shows?.versions ?? []).map((version) => (
          <li key={version.number} className={version.live ? "row-item show selected" : "row-item show"}>
            <span className="bullet" aria-hidden="true" />
            <span className="asset-name">Version {version.number}</span>
            {version.live ? <span className="live-tag">live</span> : <span className={version.status === "published" ? "muted" : "asset-status bad"}>{version.status}</span>}
            <span className="muted" title={version.sha256}>{version.sha256.slice(0, 8)}</span>
            {owner && version.status === "published" && !version.live ? (
              <button type="button" className="btn mini-text" onClick={() => void store.activate(version.number)}>Make version {version.number} live</button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="pane-bar wrap">
        <button type="button" className="btn" disabled={!store.canEdit} onClick={async () => setDownload(await store.exportSet())}>
          <Download size={12} aria-hidden="true" />
          Export set
        </button>
        {download ? <a className="btn link-btn" href={download.download_url} download>Download export</a> : null}
      </div>
      {download ? <p className="muted pad mono wrap-anywhere">SHA-256 {download.sha256}</p> : null}
      <h3 className="section-head">Members</h3>
      <ul aria-label="Members" className="rows">
        {members.map((member) => (
          <li key={member.user_id} className="row-item">
            <span className="bullet" aria-hidden="true" />
            <span className="asset-name">{member.display_name}</span>
            <span className="muted">{member.role}</span>
          </li>
        ))}
      </ul>
      <div className="pane-bar">
        <button type="button" className="btn" disabled={!owner} onClick={() => setInviting(true)}>
          <UserPlus size={12} aria-hidden="true" />
          Invite guest VJ
        </button>
      </div>
      {inviting ? <Invite store={store} onClose={() => setInviting(false)} /> : null}
    </div>
  );
}

function Invite({ store, onClose }: { store: EditorStore; onClose: () => void }) {
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [link, setLink] = useState("");
  const make = (): void => {
    void api.invite(store.setId, role).then((made) => setLink(`${location.origin}${made.url}`), () => store.announce("The invite link could not be created"));
  };
  return (
    <Modal title="Invite to this set" onClose={onClose}>
      {(titleId) => (
        <>
          <h2 id={titleId} className="modal-title small">Invite to this set</h2>
          <div role="radiogroup" aria-label="Role" className="radios">
            {(["editor", "viewer"] as const).map((choice) => (
              <label key={choice} className="check">
                <input type="radio" name="invite-role" aria-label={choice === "editor" ? "Editor" : "Viewer"} checked={role === choice} onChange={() => setRole(choice)} />
                <span aria-hidden="true">{choice === "editor" ? "Editor" : "Viewer"}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn" onClick={make}>Create link</button>
          <input className="text-input" aria-label="Invite link" readOnly value={link} placeholder="The link appears here" />
          <button type="button" className="btn" disabled={link === ""} onClick={() => void navigator.clipboard?.writeText(link).then(() => store.announce("Invite link copied"), () => undefined)}>Copy link</button>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function ActivityPane({ store, filter }: { store: EditorStore; filter: string }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let alive = true;
    void api.activity(store.setId).then((found) => {
      if (!alive) return;
      setEntries(found.entries);
      setMore(found.entries.length === 50);
    }, () => undefined);
    return () => {
      alive = false;
    };
  }, [store.setId, store.doc.set.head, store.queued, store.shows?.live_number, store.assets.length]);
  const query = filter.trim().toLowerCase();
  const shown = (entries ?? []).filter((entry) => entry.summary.toLowerCase().includes(query) || entry.actor.display_name.toLowerCase().includes(query));
  return (
    <div className="pane">
      {entries !== null && entries.length === 0 ? <EmptyPane text="No activity yet" /> : null}
      <ul aria-label="Activity" className="rows">
        {shown.map((entry) => (
          <li key={entry.id} className="row-item activity">
            <span className="bullet" aria-hidden="true" />
            <span className="activity-text">
              <span className="activity-summary">{entry.summary}</span>
              <span className="muted">{entry.actor.display_name} · {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </span>
          </li>
        ))}
      </ul>
      {more ? (
        <button type="button" className="btn" onClick={() => {
          const last = entries?.[entries.length - 1];
          if (last) void api.activity(store.setId, last.id).then((found) => {
            setEntries((previous) => [...(previous ?? []), ...found.entries]);
            setMore(found.entries.length === 50);
          });
        }}>Show older</button>
      ) : null}
    </div>
  );
}

export function SetList({ sets, onOpen, filter }: { sets: SetListing[]; onOpen: (id: string) => void; filter: string }) {
  const query = filter.trim().toLowerCase();
  return (
    <div className="pane">
      <ul aria-label="Your sets" className="rows">
        {sets.filter((set) => set.name.toLowerCase().includes(query)).map((set) => (
          <li key={set.id} className="row-item">
            <button type="button" className="row-pick" onClick={() => onOpen(set.id)}>
              <span className="bullet" aria-hidden="true" />
              <span className="asset-name">{set.name}</span>
              <span className="muted">{set.role}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
