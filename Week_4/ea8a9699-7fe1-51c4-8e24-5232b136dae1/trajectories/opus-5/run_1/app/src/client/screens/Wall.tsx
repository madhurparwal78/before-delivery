import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, apiGet, apiSend, apiUpload } from '../lib/api.js';
import { Link, useQuery, useRouter } from '../lib/router.js';
import { useInlineChrome, useReducedMotion } from '../lib/hooks.js';
import { searchCopy, trayCopy, wallCopy } from '../lib/copy.js';
import { flyTile } from '../lib/flight.js';
import { handOffAnnouncement, recallTrayCluster, rememberTrayCluster } from '../lib/handoff.js';
import { TopBar } from '../components/TopBar.js';
import { LiveRegion } from '../components/Bits.js';
import { Tray, type MoveOutcome, type TrayHandle } from '../components/Tray.js';
import { Strip, type PluckRequest } from '../components/Strip.js';
import { AddToClusterDialog } from '../components/AddToClusterDialog.js';
import { NewClusterDialog } from '../components/NewClusterDialog.js';
import { ClipDetailsDialog, type ClipDetails } from '../components/ClipDetailsDialog.js';
import { NotFound } from './NotFound.js';
import { fieldMessages } from '../../shared/fields.js';
import type {
  Cluster,
  ClusterListResponse,
  ClusterSummary,
  EntryMutationResponse,
  MoveResponse,
  Reference,
  ReferenceListResponse,
  SearchResponse,
  StillResponse,
  WorkspaceView,
} from '../../shared/types.js';

const searchDebounceMs = 250;

interface SearchState {
  phase: 'idle' | 'pending' | 'done' | 'too-long';
  query: string;
  response: SearchResponse | null;
}
const previewRetryMs = 15_000;

function moveOutcomeOf(error: unknown): MoveOutcome {
  if (error instanceof ApiFailure) {
    if (error.code === 'stale_order') {
      return { kind: 'stale', entryIds: error.body.entryIds ?? [] };
    }
    if (error.code === 'cluster_locked') {
      return { kind: 'locked' };
    }
  }
  return { kind: 'failed' };
}

export function Wall({ slug }: { slug: string }): JSX.Element {
  const { navigate } = useRouter();
  const query = useQuery();
  const inline = useInlineChrome();
  const reducedMotion = useReducedMotion();

  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [missing, setMissing] = useState(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);

  const [trayMessage, setTrayMessage] = useState('');
  const [wallMessage, setWallMessage] = useState('');
  const [searchFieldError, setSearchFieldError] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState>({ phase: 'idle', query: '', response: null });

  const addressQuery = query.get('q') ?? '';
  const [text, setText] = useState(addressQuery);
  const writtenQuery = useRef(addressQuery);
  const searchTicket = useRef(0);
  const searchTimer = useRef<number | null>(null);

  const [pickerFor, setPickerFor] = useState<Reference | null>(null);
  const [newClusterOpen, setNewClusterOpen] = useState(false);
  const [clipFile, setClipFile] = useState<{ file: File; durationMs: number | null } | null>(null);
  const [openClip, setOpenClip] = useState<Reference | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Record<string, number>>({});

  const fileInput = useRef<HTMLInputElement>(null);
  const trayRef = useRef<TrayHandle>(null);
  const openClipButton = useRef<HTMLButtonElement | null>(null);

  const loadClusters = useCallback(async (): Promise<ClusterSummary[]> => {
    const response = await apiGet<ClusterListResponse>(`/api/workspaces/${slug}/clusters`);
    setClusters(response.clusters);
    return response.clusters;
  }, [slug]);

  const loadCluster = useCallback(async (clusterId: string): Promise<void> => {
    const loaded = await apiGet<Cluster>(`/api/clusters/${clusterId}`);
    setCluster(loaded);
  }, []);

  useEffect(() => {
    setMissing(false);
    void apiGet<WorkspaceView>(`/api/workspaces/${slug}`)
      .then(setWorkspace)
      .catch(() => setMissing(true));
    void apiGet<ReferenceListResponse>(`/api/workspaces/${slug}/references`)
      .then((response) => setReferences(response.items))
      .catch(() => undefined);
    void loadClusters()
      .then((loaded) => {
        const remembered = recallTrayCluster(slug);
        const chosen = loaded.find((option) => option.id === remembered) ?? loaded[0];
        if (chosen !== undefined) {
          return loadCluster(chosen.id);
        }
        setCluster(null);
        return undefined;
      })
      .catch(() => undefined);
  }, [slug, loadCluster, loadClusters]);

  const runSearch = useCallback(
    (value: string): void => {
      const ticket = searchTicket.current + 1;
      searchTicket.current = ticket;
      if (value === '') {
        setSearch({ phase: 'idle', query: '', response: null });
        setSearchFieldError(null);
        return;
      }
      if (Array.from(value).length > 100) {
        setSearch({ phase: 'too-long', query: value, response: null });
        setSearchFieldError(fieldMessages.q);
        return;
      }
      setSearchFieldError(null);
      setSearch({ phase: 'pending', query: value, response: null });
      void apiGet<SearchResponse>(`/api/workspaces/${slug}/search?q=${encodeURIComponent(value)}`)
        .then((response) => {
          if (searchTicket.current === ticket) {
            setSearch({ phase: 'done', query: value, response });
          }
        })
        .catch(() => {
          if (searchTicket.current === ticket) {
            setSearch({ phase: 'idle', query: value, response: null });
          }
        });
    },
    [slug],
  );

  useEffect(() => {
    if (addressQuery !== writtenQuery.current) {
      writtenQuery.current = addressQuery;
      setText(addressQuery);
      runSearch(addressQuery);
    }
  }, [addressQuery, runSearch]);

  useEffect(() => {
    if (addressQuery !== '' && search.phase === 'idle' && search.query === '') {
      runSearch(addressQuery);
    }
  }, [addressQuery, search, runSearch]);

  const writeQuery = (value: string, replace: boolean): void => {
    writtenQuery.current = value;
    const target = value === '' ? `/w/${slug}` : `/w/${slug}?q=${encodeURIComponent(value)}`;
    navigate(target, { replace });
  };

  const onSearchChange = (value: string): void => {
    setText(value);
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
    }
    if (value === '') {
      searchTicket.current += 1;
      setSearch({ phase: 'idle', query: '', response: null });
      setSearchFieldError(null);
      writeQuery('', true);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      writeQuery(value, true);
      runSearch(value);
    }, searchDebounceMs);
  };

  const onSearchSubmit = (): void => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
    }
    if (Array.from(text).length > 100) {
      setSearchFieldError(fieldMessages.q);
      setSearch({ phase: 'too-long', query: text, response: null });
      return;
    }
    writeQuery(text, false);
    runSearch(text);
  };

  const selectCluster = (clusterId: string): void => {
    rememberTrayCluster(slug, clusterId);
    setActiveEntryId(null);
    void loadCluster(clusterId).catch(() => undefined);
  };

  const addToCluster = async (reference: Reference, target: ClusterSummary): Promise<void> => {
    setPickerFor(null);
    rememberTrayCluster(slug, target.id);
    try {
      const response = await apiSend<EntryMutationResponse>('POST', `/api/clusters/${target.id}/entries`, {
        referenceId: reference.id,
        isPrivate: false,
      });
      await loadCluster(target.id);
      await loadClusters();
      setActiveEntryId(response.entry.id);
      setTrayMessage(trayCopy.added(reference.title, response.itemCount, target.title));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'already_in_cluster') {
        await loadCluster(target.id).catch(() => undefined);
        setTrayMessage(trayCopy.alreadyAdded(reference.title, target.title));
      } else if (error instanceof ApiFailure && error.code === 'cluster_locked') {
        setTrayMessage(trayCopy.clusterLocked(target.title));
      } else if (error instanceof ApiFailure && error.code === 'seat_required') {
        setWallMessage(wallCopy.seatMissing());
      } else {
        setTrayMessage(trayCopy.moveFailed());
      }
    }
  };

  const uploadImage = async (file: File): Promise<void> => {
    setWallMessage(wallCopy.uploadPending(file.name));
    const form = new FormData();
    form.append('file', file);
    try {
      const created = await apiUpload<Reference>(`/api/workspaces/${slug}/references`, form);
      setReferences((current) => [created, ...current]);
      setWallMessage(wallCopy.uploaded(created.title));
    } catch (error) {
      setWallMessage(uploadFailureCopy(error, file.name));
    }
  };

  const uploadClip = async (file: File, details: ClipDetails): Promise<void> => {
    setClipFile(null);
    setWallMessage(wallCopy.uploadPending(file.name));
    const form = new FormData();
    form.append('file', file);
    form.append('title', details.title);
    form.append('frameRate', String(details.frameRate));
    form.append('durationMs', String(details.durationMs));
    try {
      const created = await apiUpload<Reference>(`/api/workspaces/${slug}/references`, form);
      setReferences((current) => [created, ...current]);
      setWallMessage(wallCopy.uploaded(created.title));
    } catch (error) {
      setWallMessage(uploadFailureCopy(error, file.name));
    }
  };

  const onFilesChosen = (files: FileList | null): void => {
    const file = files?.[0];
    if (file === undefined) {
      return;
    }
    if (file.type.startsWith('video/')) {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = URL.createObjectURL(file);
      probe.addEventListener('loadedmetadata', () => {
        setClipFile({ file, durationMs: Math.round(probe.duration * 1000) });
        URL.revokeObjectURL(probe.src);
      });
      probe.addEventListener('error', () => setClipFile({ file, durationMs: null }));
      return;
    }
    void uploadImage(file);
  };

  const moveEntry = async (entryId: string, toPosition: number): Promise<MoveOutcome> => {
    if (cluster === null) {
      return { kind: 'failed' };
    }
    try {
      const response = await apiSend<MoveResponse>(
        'POST',
        `/api/clusters/${cluster.id}/entries/${entryId}/move`,
        { toPosition, version: cluster.version },
      );
      setCluster((current) =>
        current === null
          ? current
          : {
              ...current,
              version: response.version,
              entries: response.entryIds
                .map((id, index) => {
                  const found = current.entries.find((entry) => entry.id === id);
                  return found === undefined ? null : { ...found, position: index + 1 };
                })
                .filter((entry): entry is Cluster['entries'][number] => entry !== null),
            },
      );
      setActiveEntryId(entryId);
      return { kind: 'saved' };
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'stale_order') {
        await loadCluster(cluster.id).catch(() => undefined);
      }
      return moveOutcomeOf(error);
    }
  };

  const pluck = async (request: PluckRequest): Promise<void> => {
    if (cluster === null) {
      setTrayMessage(trayCopy.noActiveCluster());
      return;
    }
    if (openClip === null) {
      return;
    }
    const landing = trayRef.current?.landingRect() ?? null;
    const flight =
      landing === null
        ? null
        : flyTile(request.tileSrc, request.tileRect, landing, reducedMotion);
    const slot = cluster.entries.length + 1;
    setPendingSlot(slot);
    setTrayMessage(trayCopy.pluckPending(request.timecode));

    const form = new FormData();
    form.append('still', request.blob, 'still.png');
    form.append('frameIndex', String(request.frameIndex));
    form.append('clusterId', cluster.id);
    try {
      const response = await apiUpload<StillResponse>(
        `/api/workspaces/${slug}/clips/${openClip.id}/stills`,
        form,
      );
      flight?.settle();
      setPendingSlot(null);
      await loadCluster(cluster.id);
      setActiveEntryId(response.entry.id);
      setReferences((current) => [response.reference, ...current]);
      setTrayMessage(
        trayCopy.pluckSaved(
          request.timecode,
          openClip.title,
          response.cluster.itemCount,
          cluster.title,
        ),
      );
    } catch (error) {
      setPendingSlot(null);
      await flight?.back();
      if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
        setTrayMessage(trayCopy.pluckStorageDown(request.timecode, cluster.title));
      } else if (error instanceof ApiFailure && error.code === 'cluster_locked') {
        setTrayMessage(trayCopy.clusterLocked(cluster.title));
      } else if (error instanceof ApiFailure && error.code === 'seat_required') {
        setWallMessage(wallCopy.seatMissing());
      } else {
        setTrayMessage(trayCopy.pluckStorageDown(request.timecode, cluster.title));
      }
    }
  };

  useEffect(() => {
    if (Object.keys(brokenPreviews).length === 0) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setBrokenPreviews((current) => {
        const refreshed: Record<string, number> = {};
        for (const id of Object.keys(current)) {
          refreshed[id] = Date.now();
        }
        return refreshed;
      });
    }, previewRetryMs);
    return () => clearTimeout(timer);
  }, [brokenPreviews]);

  if (missing) {
    return <NotFound />;
  }

  const results = search.response;
  const visible = results === null ? references : results.references;
  const searchMessage =
    search.phase === 'pending'
      ? searchCopy.pending()
      : search.phase === 'too-long'
        ? fieldMessages.q
        : search.phase === 'done' && results !== null
          ? results.counts.clusters + results.counts.references === 0
            ? searchCopy.none(workspace?.name ?? slug, search.query)
            : searchCopy.results(results.counts.clusters, results.counts.references, search.query)
          : '';

  return (
    <>
      <TopBar workspaceSlug={slug} />
      <div className="workspace-shell">
          <main className="wall-main">
            <div className="wall-toolbar">
              <div className="search" role="search">
                <label htmlFor="wall-search">Search references and clusters</label>
                <input
                  id="wall-search"
                  type="search"
                  placeholder="Search this brand"
                  value={text}
                  aria-invalid={searchFieldError === null ? undefined : 'true'}
                  aria-describedby={searchFieldError === null ? undefined : 'wall-search-error'}
                  onChange={(event) => onSearchChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSearchSubmit();
                    }
                  }}
                />
                {searchFieldError === null ? null : (
                  <span className="field-error warn" id="wall-search-error">
                    {searchFieldError}
                  </span>
                )}
              </div>
              <button type="button" aria-label="Upload references" onClick={() => fileInput.current?.click()}>
                Upload
              </button>
              <input
                ref={fileInput}
                type="file"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  onFilesChosen(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>

            <LiveRegion name="Search status" message={searchMessage} />
            <LiveRegion name="Wall announcements" message={wallMessage} />

            {results === null ? null : (
              <section aria-label="Search results">
                <h2>{results.counts.clusters} clusters</h2>
                <ul className="order-list">
                  {results.clusters.map((found) => (
                    <li key={found.id} className="order-item">
                      <Link to={`/w/${slug}/clusters/${found.id}`}>{found.title}</Link>
                      <span className="tag">
                        <span className="count">{found.itemCount}</span> items
                      </span>
                    </li>
                  ))}
                </ul>
                <h2>{results.counts.references} references</h2>
              </section>
            )}

            <section aria-label="Reference wall">
              <ul className="masonry" aria-label="References">
                {visible.map((reference) => (
                  <li key={reference.id}>
                    <div className="card">
                      {brokenPreviews[reference.id] !== undefined && brokenPreviews[reference.id] === 0 ? (
                        <div className="preview-missing">Preview unavailable</div>
                      ) : reference.kind === 'clip' ? (
                        <video
                          src={reference.mediaUrl}
                          muted
                          playsInline
                          preload="metadata"
                          onError={() => setBrokenPreviews((current) => ({ ...current, [reference.id]: 0 }))}
                        />
                      ) : (
                        <img
                          src={
                            brokenPreviews[reference.id] === undefined
                              ? reference.mediaUrl
                              : `${reference.mediaUrl}?retry=${brokenPreviews[reference.id]}`
                          }
                          alt=""
                          onError={() => setBrokenPreviews((current) => ({ ...current, [reference.id]: 0 }))}
                        />
                      )}
                      <div className="card-body">
                        <h3 className="card-title">{reference.title}</h3>
                        {reference.kind === 'still' ? (
                          <p className="timecode">
                            {reference.sourceClipTitle} · {reference.timecode}
                          </p>
                        ) : null}
                        <div className="card-actions">
                          <button
                            type="button"
                            aria-label={`Add ${reference.title} to cluster`}
                            onClick={() => setPickerFor(reference)}
                          >
                            Add
                          </button>
                          {reference.kind === 'clip' ? (
                            <button
                              type="button"
                              aria-label={`Open clip ${reference.title}`}
                              onClick={(event) => {
                                openClipButton.current = event.currentTarget;
                                setOpenClip(reference);
                              }}
                            >
                              Open clip
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </main>

        {openClip === null ? null : (
          <Strip
            clip={openClip}
            onClose={() => {
              setOpenClip(null);
              openClipButton.current?.focus();
            }}
            onPluck={pluck}
          />
        )}

        <Tray
            ref={trayRef}
            inline={inline}
            cluster={cluster}
            clusters={clusters}
            activeEntryId={activeEntryId}
            message={trayMessage}
            announce={setTrayMessage}
            onSelect={selectCluster}
            onNewCluster={() => setNewClusterOpen(true)}
            onMove={moveEntry}
            pendingSlot={pendingSlot}
          />
      </div>

      {pickerFor === null ? null : (
        <AddToClusterDialog
          workspaceSlug={slug}
          onClose={() => setPickerFor(null)}
          onPick={(target) => {
            void addToCluster(pickerFor, target);
          }}
        />
      )}

      {newClusterOpen && workspace !== null ? (
        <NewClusterDialog
          workspaceSlug={slug}
          workspaceName={workspace.name}
          onClose={() => setNewClusterOpen(false)}
          onCreated={(created) => {
            setNewClusterOpen(false);
            rememberTrayCluster(slug, created.id);
            handOffAnnouncement(created.id, `Created ${created.title} as a draft.`);
            navigate(`/w/${slug}/clusters/${created.id}`);
          }}
          onSeatMissing={() => setWallMessage(wallCopy.seatMissing())}
        />
      ) : null}

      {clipFile === null ? null : (
        <ClipDetailsDialog
          file={clipFile.file}
          durationMs={clipFile.durationMs}
          onCancel={() => setClipFile(null)}
          onConfirm={(details) => void uploadClip(clipFile.file, details)}
        />
      )}
    </>
  );
}

function uploadFailureCopy(error: unknown, fileName: string): string {
  if (error instanceof ApiFailure) {
    if (error.code === 'too_large') {
      return wallCopy.tooLarge(fileName);
    }
    if (error.code === 'unsupported_media_type') {
      return wallCopy.unsupported(fileName);
    }
    if (error.code === 'storage_unavailable') {
      return wallCopy.uploadStorageDown(fileName);
    }
    if (error.code === 'seat_required') {
      return wallCopy.seatMissing();
    }
  }
  return wallCopy.uploadStorageDown(fileName);
}
