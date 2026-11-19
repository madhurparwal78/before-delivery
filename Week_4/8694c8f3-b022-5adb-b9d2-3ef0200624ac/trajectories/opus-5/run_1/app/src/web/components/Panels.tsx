import { useRef, useState } from 'react';
import { api, ApiFailure } from '../api.js';
import { store } from '../store.js';
import { Dialog, useStoreState } from './common.js';
import type { Dependents, Role } from '../../shared/types.js';

interface InUse {
  name: string;
  dependents: Dependents | null;
  showVersions: number[] | null;
}

export function AssetShelf() {
  const state = useStoreState();
  const input = useRef<HTMLInputElement | null>(null);
  const [inUse, setInUse] = useState<InUse | null>(null);

  const upload = async (file: File): Promise<void> => {
    const kind = file.name.toLowerCase().endsWith('.glb') ? 'model' : 'texture';
    store.region('assetUpload', `Uploading ${file.name}`);
    try {
      await api.uploadAsset(store.setId, kind, file);
      store.region('assetUpload', `${file.name} is ready`);
    } catch (error) {
      store.region('assetUpload', `${file.name} upload failed`);
      if (error instanceof ApiFailure && error.status === 503) store.region('serviceStatus', error.body.message);
    }
    await store.refreshAssets();
    await store.refreshActivity();
  };

  return (
    <div className="tree">
      <div style={{ display: 'flex', gap: '4px', paddingBottom: '4px' }}>
        <button type="button" className="row-button" onClick={() => input.current?.click()}>
          Upload asset
        </button>
        <input
          ref={input}
          type="file"
          aria-label="Choose GLB or texture file"
          accept=".glb,image/png,image/jpeg"
          style={{ width: '120px' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void upload(file);
            event.target.value = '';
          }}
        />
      </div>
      <ul className="list-rows" aria-label="Asset shelf">
        {state.assets.length === 0 ? <li className="status-line">No assets yet</li> : null}
        {state.assets.map((asset) => (
          <li key={asset.id} className="list-row">
            <span className="grow">{asset.name}</span>
            <span className="dim">{asset.status}</span>
            <span className="dim">{`${asset.dependents.count} dependents`}</span>
            <button
              type="button"
              className="row-button"
              aria-label={`Delete ${asset.name}`}
              onClick={() => {
                void api
                  .deleteAsset(store.setId, asset.id)
                  .then(() => {
                    void store.refreshAssets();
                    void store.refreshActivity();
                  })
                  .catch((error: unknown) => {
                    if (!(error instanceof ApiFailure)) return;
                    if (error.body.code === 'asset_in_use') {
                      setInUse({ name: asset.name, dependents: error.body.dependents ?? null, showVersions: null });
                    } else if (error.body.code === 'asset_in_shows') {
                      setInUse({ name: asset.name, dependents: null, showVersions: error.body.show_versions ?? [] });
                    } else if (error.status === 503) {
                      store.region('serviceStatus', error.body.message);
                    }
                  });
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {inUse === null ? null : (
        <Dialog title="Asset still in use" alert onClose={() => setInUse(null)}>
          {inUse.dependents === null ? (
            <p className="alert-body">{`${inUse.name} is part of published show versions ${(inUse.showVersions ?? []).join(', ')}.`}</p>
          ) : (
            <div className="alert-body">
              <p>{`${inUse.name} is used by:`}</p>
              <p className="label">Layers</p>
              <ul>
                {inUse.dependents.layers.map((entry) => (
                  <li key={entry.id}>{entry.name}</li>
                ))}
              </ul>
              <p className="label">Materials</p>
              <ul>
                {inUse.dependents.materials.map((entry) => (
                  <li key={entry.layer_id}>{entry.name}</li>
                ))}
              </ul>
              <p className="label">Scripts</p>
              <ul>
                {inUse.dependents.scripts.map((entry) => (
                  <li key={entry.id}>{entry.name}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="row-button" onClick={() => setInUse(null)}>
              OK
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function ShowsPanel() {
  const state = useStoreState();
  const [invite, setInvite] = useState(false);
  const [role, setRole] = useState<Role>('editor');
  const [link, setLink] = useState('');
  const shows = state.shows;
  const owner = state.doc?.set.role === 'owner';

  const publish = async (): Promise<void> => {
    const next = (shows?.versions[0]?.number ?? 0) + 1;
    store.region('showStatus', `Publishing version ${next}`);
    try {
      const result = await api.publishShow(store.setId, '');
      store.region('showStatus', `Version ${result.show_version.number} is live`);
    } catch (error) {
      if (error instanceof ApiFailure) {
        const live = shows?.live_number ?? null;
        store.region(
          'showStatus',
          live === null ? 'Publish failed. Nothing is live yet.' : `Publish failed. Version ${live} is still live.`,
        );
        if (error.status === 503) store.region('serviceStatus', error.body.message);
      }
    }
    await store.refreshShows();
    await store.refreshActivity();
  };

  return (
    <div className="tree">
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', paddingBottom: '4px' }}>
        {owner ? (
          <button type="button" className="row-button" onClick={() => void publish()}>
            Publish show
          </button>
        ) : null}
        {owner ? (
          <button
            type="button"
            className="row-button"
            onClick={() => {
              void api
                .rollbackShow(store.setId)
                .then((result) => {
                  store.region('showStatus', `Rolled back. Version ${result.live_number} is live`);
                  void store.refreshShows();
                  void store.refreshActivity();
                })
                .catch(() => undefined);
            }}
          >
            Roll back
          </button>
        ) : null}
        {shows === null ? null : (
          <>
            <a className="link-button" href={shows.show_url} target="_blank" rel="noreferrer">
              Show link
            </a>
            <button
              type="button"
              className="row-button"
              onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}${shows.show_url}`)}
            >
              Copy show link
            </button>
          </>
        )}
      </div>
      <ul className="list-rows" aria-label="Show versions">
        {shows === null || shows.versions.length === 0 ? (
          <li className="status-line">No show versions yet</li>
        ) : null}
        {(shows?.versions ?? []).map((version) => (
          <li key={version.number} className={version.live ? 'list-row selected' : 'list-row'}>
            <span className="grow">{`Version ${version.number}`}</span>
            <span className="dim">{version.status}</span>
            {version.live ? <span className="dim">live</span> : null}
            <span className="dim">{version.sha256?.slice(0, 12) ?? ''}</span>
            {owner && !version.live && version.status === 'published' ? (
              <button
                type="button"
                className="row-button"
                onClick={() => {
                  void api.activateShow(store.setId, version.number).then((result) => {
                    store.region('showStatus', `Version ${result.live_number} is live`);
                    void store.refreshShows();
                    void store.refreshActivity();
                  });
                }}
              >
                {`Make version ${version.number} live`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 style={{ paddingTop: '8px' }}>Members</h3>
      {owner ? (
        <button type="button" className="row-button" onClick={() => setInvite(true)}>
          Invite guest VJ
        </button>
      ) : null}
      <ul className="list-rows">
        {state.members.map((member) => (
          <li key={member.user_id} className="list-row">
            <span className="grow">{member.display_name}</span>
            <span className="dim">{member.role}</span>
          </li>
        ))}
      </ul>
      {invite ? (
        <Dialog title="Invite to this set" onClose={() => setInvite(false)}>
          <label className="checkrow">
            <input
              type="radio"
              name="invite-role"
              checked={role === 'editor'}
              onChange={() => setRole('editor')}
              aria-label="Editor"
            />
            Editor
          </label>
          <label className="checkrow">
            <input
              type="radio"
              name="invite-role"
              checked={role === 'viewer'}
              onChange={() => setRole('viewer')}
              aria-label="Viewer"
            />
            Viewer
          </label>
          <button
            type="button"
            className="row-button"
            onClick={() => {
              void api.createInvite(store.setId, role).then((result) => {
                setLink(`${window.location.origin}${result.url}`);
              });
            }}
          >
            Create link
          </button>
          <div className="form-row">
            <span className="label">Invite link</span>
            <input type="text" aria-label="Invite link" readOnly value={link} />
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="row-button"
              onClick={() => void navigator.clipboard?.writeText(link)}
            >
              Copy link
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

export function ActivityPanel() {
  const state = useStoreState();
  return (
    <div className="tree">
      <ul className="list-rows" aria-label="Activity">
        {state.activity.length === 0 ? <li className="status-line">No activity yet</li> : null}
        {state.activity.map((entry) => (
          <li key={entry.id} className="list-row">
            <span className="grow">{entry.summary}</span>
            <span className="dim">{entry.actor.display_name}</span>
            <span className="dim">{new Date(entry.at).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
