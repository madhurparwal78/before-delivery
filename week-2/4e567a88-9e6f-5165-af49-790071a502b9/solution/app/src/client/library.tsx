// The Library screen: media search, the asset dialog with its lineage, "Use as input" and deletion.

import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, get, query, refreshAll, request, type Asset, type Lineage, type LineageNode } from "./api";
import { Dialog } from "./dialog";
import { day, usePoll, when } from "./hooks";
import { Icon, mediaIcon } from "./icons";
import { LineageGraph, stableLink } from "./lineage";
import { modelNameOf, teamNameOf, useSession } from "./session";
import { Alert, ScreenHead } from "./ui";

type Loaded = { asset: Asset; lineage: Lineage | null } | { gone: { removed_at: string; reason: string } };

function AssetDialog({ assetId, onClose, onSwitch, onUseAsInput, onDelete, returnFocusTo }: {
  assetId: string | null;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onUseAsInput: (id: string) => void;
  onDelete: () => void;
  returnFocusTo: () => HTMLElement | null;
}) {
  const session = useSession();
  const { me } = session;
  const [loaded, setLoaded] = useState<{ id: string; data: Loaded } | null>(null);

  useEffect(() => {
    if (!assetId) return;
    let live = true;
    (async () => {
      try {
        const { asset } = await get<{ asset: Asset }>(`/api/assets/${assetId}`);
        const lineage = await get<Lineage>(`/api/assets/${assetId}/lineage`).catch(() => null);
        if (live) setLoaded({ id: assetId, data: { asset, lineage } });
      } catch (error) {
        const gone = error instanceof ApiError ? error.body : null;
        if (live && gone?.code === "asset_gone" && gone.removed_at && gone.reason) {
          setLoaded({ id: assetId, data: { gone: { removed_at: gone.removed_at, reason: gone.reason } } });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [assetId]);

  const data = loaded && loaded.id === assetId ? loaded.data : null;
  const canDelete = me.role === "compliance" || me.role === "admin";
  return (
    <Dialog open={assetId !== null} title={`Asset ${assetId ?? ""}`} onClose={onClose} returnFocusTo={returnFocusTo} wide>
      {!data ? <p class="muted">Loading…</p> : "gone" in data ? (
        <p class="tombstone-note">Removed {day(data.gone.removed_at)} ({data.gone.reason})</p>
      ) : (
        <>
          <div class="asset-view">
            <div class="asset-view__media"
              style={data.asset.width && data.asset.height ? { aspectRatio: `${data.asset.width} / ${data.asset.height}` } : undefined}>
              {data.asset.media_type.startsWith("image/") && data.asset.url
                ? <img src={stableLink(data.asset.id, data.asset.url)} alt={`${data.asset.kind === "output" ? "Output" : "Upload"} ${data.asset.id}`} />
                : <span class="asset-view__glyph"><Icon name={mediaIcon(data.asset.media_type)} size={40} /></span>}
            </div>
            <dl class="facts">
              <div class="facts__row"><dt>Kind</dt><dd>{data.asset.kind === "output" ? "Output" : "Upload"}</dd></div>
              <div class="facts__row"><dt>Model</dt><dd>{modelNameOf(session, data.asset.model)}</dd></div>
              <div class="facts__row"><dt>Team</dt><dd>{teamNameOf(session, data.asset.team_id)}</dd></div>
              <div class="facts__row"><dt>Media</dt><dd class="num">{data.asset.media_type}
                {data.asset.width ? ` · ${data.asset.width}×${data.asset.height}` : ""}
                {data.asset.duration_seconds ? ` · ${data.asset.duration_seconds} s` : ""}</dd></div>
              {data.asset.job_id && <div class="facts__row"><dt>Job</dt><dd class="num">{data.asset.job_id}</dd></div>}
              <div class="facts__row"><dt>Created</dt><dd class="num">{when(data.asset.created_at)}</dd></div>
              <div class="facts__row"><dt>Expires</dt><dd class="num">{when(data.asset.expires_at)}</dd></div>
              {data.asset.prompt !== undefined && <div class="facts__row"><dt>Prompt</dt><dd class="prose">{data.asset.prompt}</dd></div>}
            </dl>
          </div>
          <h3 class="subhead">Lineage</h3>
          {data.lineage ? (
            <LineageGraph nodes={data.lineage.nodes} edges={data.lineage.edges} selected={data.asset.id}
              modelName={(slug) => modelNameOf(session, slug)}
              onSelect={(node: LineageNode) => {
                if (node.state === "live" && node.id !== data.asset.id) onSwitch(node.id);
              }} />
          ) : <p class="muted">Lineage is unavailable.</p>}
          <div class="dialog__actions">
            {me.role === "member" && (
              <button type="button" class="btn btn--primary" onClick={() => onUseAsInput(data.asset.id)}>Use as input</button>
            )}
            {canDelete && <button type="button" class="btn btn--secondary" onClick={onDelete}>Delete</button>}
          </div>
        </>
      )}
    </Dialog>
  );
}

export function LibraryScreen({ onUseAsInput }: { onUseAsInput: (assetId: string) => void }) {
  const session = useSession();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const deleted = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(text.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [text]);

  usePoll(async () => {
    const { assets: found } = await get<{ assets: Asset[] }>(`/api/assets${query({ q })}`);
    setAssets(found);
  }, 2000, [q]);

  const toSearch = () => (deleted.current ? search.current : null);

  const remove = async () => {
    if (!open) return;
    const id = open;
    session.notify("Deleting…");
    try {
      await request("DELETE", `/api/assets/${id}`);
      session.notify(`Asset ${id} deleted from storage, search and lineage.`);
      setAlert(null);
      deleted.current = true;
      setConfirming(false);
      setOpen(null);
      setAssets((list) => list?.filter((a) => a.id !== id) ?? null);
      refreshAll();
    } catch (error) {
      session.notify("");
      setConfirming(false);
      setAlert(error instanceof ApiError && error.status === 410 ? "That asset is already gone."
        : error instanceof ApiError && error.status === 503 ? "Storage is unreachable, so nothing was deleted. Try again when it returns."
          : error instanceof ApiError ? error.message : "The delete did not reach Dispatch. Try again.");
    }
  };

  return (
    <div class="screen">
      <ScreenHead title="Library" />
      <div class="search">
        <label for="library-search">Search media</label>
        <div class="search__box">
          <Icon name="search" size={18} />
          <input ref={search} id="library-search" type="search" class="input" value={text}
            placeholder="Model name, prompt words or asset id" onInput={(e) => setText(e.currentTarget.value)} />
        </div>
      </div>
      <Alert text={alert} />
      {assets !== null && assets.length === 0 ? (
        <p class="empty"><Icon name="empty" size={28} /><span>No media matches.</span></p>
      ) : (
        <ul class="cards" aria-label="Results">
          {assets === null && <li class="muted">Loading…</li>}
          {assets?.map((asset) => {
            const thumb = asset.media_type.startsWith("image/") ? stableLink(asset.id, asset.url) : undefined;
            return (
              <li key={asset.id}>
                <button type="button" class="card" aria-label={`Asset ${asset.id}`} onClick={() => {
                  setAlert(null);
                  deleted.current = false;
                  setOpen(asset.id);
                }}>
                  <span class="card__media">
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name={asset.kind === "upload" && !asset.url ? "upload" : mediaIcon(asset.media_type)} size={32} />}
                  </span>
                  <span class="card__body">
                    <span class="card__title">{modelNameOf(session, asset.model)}</span>
                    <span class="card__id num">{asset.id}</span>
                    <span class="card__dates">
                      <span>Created <span class="num nowrap">{when(asset.created_at)}</span></span>
                      <span>Expires <span class="num nowrap">{when(asset.expires_at)}</span></span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <AssetDialog assetId={open} onClose={() => setOpen(null)} onSwitch={setOpen} returnFocusTo={toSearch}
        onUseAsInput={(id) => {
          setOpen(null);
          onUseAsInput(id);
        }}
        onDelete={() => setConfirming(true)} />
      <Dialog open={confirming} title="Delete asset" role="alertdialog" closable={false} initialFocus="[data-keep]"
        onClose={() => setConfirming(false)} returnFocusTo={toSearch}>
        <p>The object leaves storage now. Search stops finding it, its link answers gone, and lineage keeps only a tombstone.</p>
        <div class="dialog__actions">
          <button type="button" class="btn" onClick={remove}>Delete permanently</button>
          <button type="button" class="btn btn--secondary" data-keep onClick={() => setConfirming(false)}>Keep</button>
        </div>
      </Dialog>
    </div>
  );
}
