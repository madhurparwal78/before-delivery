// The brand wall (brief: Screens > Wall, Search results; Interactions > Search, Search in the address, Add to
// cluster, New cluster, Opening a clip, Plucking; Feedback states for the wall, tray and search regions).
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Upload } from "lucide-react";
import type { Cluster, ClusterSummary, EntryResult, PluckResult, Reference, ReferencePage, SearchResult, WorkspaceRef } from "../../shared/api.js";
import { Q_MAX, Q_MESSAGE, queryLength } from "../../shared/search.js";
import { api, isAbort, multipart, type Result } from "../lib/api.js";
import { SEAT_COPY } from "../lib/copy.js";
import { LiveRegion, useLive } from "../lib/live.js";
import { fadeIn, fly, reducedMotion } from "../lib/motion.js";
import { linkClick, navigate, useLocation } from "../lib/router.js";
import { Empty, StatusTag } from "../components/bits.js";
import { ErrorSummary, FieldError, fieldAttrs, useFieldErrors, type FieldErrors } from "../components/ErrorSummary.js";
import { Masonry, useMedia, WALL_COLUMNS, type MasonryItem } from "../components/Masonry.js";
import { AddToCluster, ClipDetails, NewCluster, type ClipFields } from "./dialogs.js";
import { ReferenceCard } from "./ReferenceCard.js";
import { Strip, type PluckRequest, type StripHandle } from "./Strip.js";
import { Tray, type Arriving } from "./Tray.js";

const DEBOUNCE_MS = 250;

const isClipBytes = (head: Uint8Array): boolean =>
  (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) || (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3);

function clipDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (value: number | null): void => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.muted = true;
    video.addEventListener("error", () => done(null), { once: true });
    video.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(video.duration)) return done(Math.round(video.duration * 1000));
      // Recorded WebM files often omit their duration until the end has been read.
      video.addEventListener("durationchange", () => Number.isFinite(video.duration) && done(Math.round(video.duration * 1000)));
      video.currentTime = Number.MAX_SAFE_INTEGER;
    }, { once: true });
    video.src = url;
  });
}

let arrivals = 0;

const searchPath = (slug: string, q: string): string => (q ? `/w/${slug}?q=${encodeURIComponent(q)}` : `/w/${slug}`);

export function Wall({ workspace }: { workspace: WorkspaceRef }) {
  const slug = workspace.slug;
  const narrow = useMedia("(max-width: 719.98px)");
  const wallLive = useLive();
  const trayLive = useLive();
  const searchLive = useLive();
  const { query } = useLocation();
  const urlQ = query.get("q") ?? "";

  // References: every page, newest first, so the whole wall is reachable.
  const [references, setReferences] = useState<Reference[] | null>(null);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      let cursor: string | null = null;
      const all: Reference[] = [];
      do {
        const result: Result<ReferencePage> = await api<ReferencePage>("GET", `/api/workspaces/${slug}/references?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        if (stopped || !result.ok) return;
        all.push(...result.data.items);
        setReferences([...all]);
        cursor = result.data.nextCursor;
      } while (cursor);
    })();
    return () => {
      stopped = true;
    };
  }, [slug]);

  // Search: latest text wins; the active query lives in the address as q.
  const [text, setText] = useState(urlQ);
  const [result, setResult] = useState<SearchResult | null>(null);
  const current = useRef(urlQ);
  const written = useRef(urlQ);
  const inflight = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchForm = useFieldErrors();
  const tooLong = queryLength(text) > Q_MAX;

  const runSearch = useCallback(
    (q: string) => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      searchLive.say("Searching...");
      api<SearchResult>("GET", `/api/workspaces/${slug}/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((answer) => {
          if (current.current !== q || controller.signal.aborted) return;
          if (!answer.ok) return searchLive.say(answer.error?.errors?.q ?? "The search could not run. Try again.", true);
          setResult(answer.data);
          const { clusters, references: refs } = answer.data.counts;
          searchLive.say(clusters + refs === 0 ? `Nothing in ${workspace.name} matches ${q}.` : `${clusters} clusters and ${refs} references match ${q}.`);
        })
        .catch((error: unknown) => {
          if (!isAbort(error)) throw error;
        });
    },
    [slug, workspace.name, searchLive],
  );

  const write = (q: string, push: boolean): void => {
    written.current = q;
    navigate(searchPath(slug, q), { replace: !push });
  };

  const setQuery = (q: string, mode: "typing" | "enter" | "address"): void => {
    current.current = q;
    if (debounce.current) clearTimeout(debounce.current);
    setText(q);
    if (!q) {
      inflight.current?.abort();
      setResult(null);
      searchLive.say("");
      searchForm.clear();
      if (mode !== "address") write("", false);
      return;
    }
    if (queryLength(q) > Q_MAX) {
      inflight.current?.abort();
      searchLive.say(Q_MESSAGE, true);
      if (mode === "enter") searchForm.show({ q: Q_MESSAGE });
      return;
    }
    searchForm.clear();
    if (mode === "typing") {
      searchLive.say("Searching...");
      debounce.current = setTimeout(() => {
        write(q, false);
        runSearch(q);
      }, DEBOUNCE_MS);
      return;
    }
    if (mode === "enter") write(q, true);
    runSearch(q);
  };

  useEffect(() => {
    if (urlQ === written.current) return;
    written.current = urlQ;
    setQuery(urlQ, "address");
    // Only an address change from outside (load, Back, Forward) refills the field.
  }, [urlQ]);

  useEffect(() => {
    if (urlQ) setQuery(urlQ, "address");
    return () => inflight.current?.abort();
  }, []);

  // Tray: the active cluster, remembered for this browser tab.
  const storageKey = `rushes:tray:${slug}`;
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const activeId = useRef<string | null>(sessionStorage.getItem(storageKey));
  const [activeKey, setActiveKey] = useState(activeId.current);
  const [expanded, setExpanded] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);
  const [arriving, setArriving] = useState<Arriving | null>(null);
  const arrivingThumb = useRef<HTMLImageElement | null>(null);
  const bar = useRef<HTMLButtonElement | null>(null);
  const thumbs = useRef(new Map<string, string>());

  const loadCluster = useCallback(async (id: string): Promise<Cluster | null> => {
    const answer = await api<Cluster>("GET", `/api/clusters/${id}`);
    if (activeId.current !== id) return null;
    if (answer.ok) {
      setCluster(answer.data);
      return answer.data;
    }
    if (answer.status === 404) {
      activeId.current = null;
      setActiveKey(null);
      sessionStorage.removeItem(storageKey);
      setCluster(null);
    }
    return null;
  }, [storageKey]);

  const choose = useCallback((id: string) => {
    activeId.current = id;
    setActiveKey(id);
    sessionStorage.setItem(storageKey, id);
    void loadCluster(id);
  }, [storageKey, loadCluster]);

  const loadClusters = useCallback(async () => {
    const answer = await api<{ clusters: ClusterSummary[] }>("GET", `/api/workspaces/${slug}/clusters`);
    if (!answer.ok) return;
    setClusters(answer.data.clusters);
    const first = answer.data.clusters[0];
    if (!activeId.current && first) choose(first.id);
  }, [slug, choose]);

  useEffect(() => {
    void loadClusters();
    if (activeId.current) void loadCluster(activeId.current);
  }, [loadClusters, loadCluster]);

  // Dialogs and the strip.
  const opener = useRef<HTMLElement | null>(null);
  const [adding, setAdding] = useState<Reference | null>(null);
  const [creating, setCreating] = useState(false);
  const [clip, setClip] = useState<Reference | null>(null);
  const clipOpener = useRef<HTMLElement | null>(null);
  const strip = useRef<StripHandle | null>(null);
  const [clipFile, setClipFile] = useState<{ file: File; done: () => void } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadButton = useRef<HTMLButtonElement | null>(null);
  // The chooser opens on the next task, once the press has been fully dispatched; its user activation is still live.
  const openFileChooser = (): void => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => fileInput.current?.click();
    channel.port2.postMessage(null);
  };

  const addTo = async (reference: Reference, target: ClusterSummary): Promise<void> => {
    setAdding(null);
    const answer = await api<EntryResult>("POST", `/api/clusters/${target.id}/entries`, { body: { referenceId: reference.id, isPrivate: false } });
    if (answer.ok) {
      choose(target.id);
      setEntering(answer.data.entry.id);
      trayLive.say(`Added ${reference.title}. ${answer.data.itemCount} items in ${target.title}.`);
      void loadClusters();
      return;
    }
    const code = answer.error?.error;
    if (code === "already_in_cluster") trayLive.say(`${reference.title} is already in ${target.title}.`);
    else if (code === "cluster_locked") trayLive.say(`${target.title} is locked and cannot take new items.`, true);
    else if (code === "seat_required") wallLive.say(SEAT_COPY, true);
    else trayLive.say(`${reference.title} could not be added. Try again.`, true);
  };

  const createCluster = async (fields: { title: string; publicDescription: string; internalNote: string }): Promise<FieldErrors | null> => {
    const answer = await api<Cluster>("POST", `/api/workspaces/${slug}/clusters`, { body: fields });
    if (answer.ok) {
      sessionStorage.setItem(storageKey, answer.data.id);
      setCreating(false);
      navigate(`/w/${slug}/clusters/${answer.data.id}`, { state: { created: answer.data.title } });
      return null;
    }
    if (answer.error?.errors) return answer.error.errors;
    setCreating(false);
    wallLive.say(answer.error?.error === "seat_required" ? SEAT_COPY : "The cluster could not be created. Try again.", true);
    return null;
  };

  const sendUpload = async (file: File, fields: Record<string, string>): Promise<FieldErrors | null> => {
    wallLive.say(`Uploading ${file.name}...`);
    const form = new FormData();
    form.append("file", file, file.name);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const answer = await api<Reference>("POST", `/api/workspaces/${slug}/references`, { form });
    if (answer.ok) {
      setReferences((list) => [answer.data, ...(list ?? []).filter((r) => r.id !== answer.data.id)]);
      wallLive.say(`Uploaded ${answer.data.title}.`);
      return null;
    }
    const code = answer.error?.error;
    if (answer.error?.errors && Object.keys(fields).length) {
      wallLive.say("");
      return answer.error.errors;
    }
    if (code === "storage_unavailable") wallLive.say(`Storage is unreachable. ${file.name} was not uploaded.`, true);
    else if (code === "too_large") wallLive.say(`${file.name} is larger than the limit for its type.`, true);
    else if (code === "unsupported_media_type") wallLive.say(`${file.name} is not a supported image or clip.`, true);
    else if (code === "seat_required") wallLive.say(SEAT_COPY, true);
    else wallLive.say(answer.error?.errors ? Object.values(answer.error.errors).join(" ") : `${file.name} was not uploaded. Try again.`, true);
    return null;
  };

  const uploadFiles = async (files: File[]): Promise<void> => {
    for (const file of files) {
      const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      if (isClipBytes(head)) {
        await new Promise<void>((done) => setClipFile({ file, done }));
      } else {
        await sendUpload(file, {});
      }
    }
  };

  const uploadClip = async (fields: ClipFields): Promise<FieldErrors | null> => {
    if (!clipFile) return null;
    const durationMs = await clipDuration(clipFile.file);
    const errors = await sendUpload(clipFile.file, { title: fields.title, frameRate: fields.frameRate, ...(durationMs ? { durationMs: String(durationMs) } : {}) });
    if (!errors) {
      clipFile.done();
      setClipFile(null);
    }
    return errors;
  };

  // Pluck: optimistic slot, flight from the strip to the slot, then the server's answer.
  const pluck = (request: PluckRequest): void => {
    const target = cluster;
    if (!target || !clip) {
      trayLive.say("Choose a cluster in the tray before plucking.", true);
      return;
    }
    const thumb = request.preview.toDataURL("image/png");
    const title = `${clip.title} @ ${request.timecode}`;
    const key = `arriving-${(arrivals += 1)}`;
    flushSync(() => setArriving({ key, title, sourceClipTitle: clip.title, timecode: request.timecode, thumb }));
    const clear = (): void => setArriving((a) => (a?.key === key ? null : a));
    arrivingThumb.current?.closest("li")?.scrollIntoView({ block: "nearest" });
    const from = request.tile.getBoundingClientRect();
    const collapsedTray = narrow && !expanded;
    const landing = collapsedTray ? bar.current : arrivingThumb.current;
    // On the collapsed bar the tile lands as a small frame at the bar's end, beside the rolling count.
    const landingRect = (): DOMRect => {
      const box = landing?.getBoundingClientRect() ?? from;
      return collapsedTray ? new DOMRect(box.right - 76, box.top + 8, 64, box.height - 16) : box;
    };
    let tile: HTMLCanvasElement | null = null;
    let flight: Animation | null = null;
    if (reducedMotion() || !landing) {
      if (arrivingThumb.current) fadeIn(arrivingThumb.current, 125);
    } else {
      tile = document.createElement("canvas");
      tile.className = "flying-tile";
      tile.width = request.preview.width;
      tile.height = request.preview.height;
      tile.getContext("2d")?.drawImage(request.preview, 0, 0);
      Object.assign(tile.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
      document.body.append(tile);
      if (arrivingThumb.current) arrivingThumb.current.style.visibility = "hidden";
      flight = fly(tile, from, landingRect());
    }
    const land = async (ok: boolean): Promise<void> => {
      if (!flight || !tile) return;
      await flight.finished.catch(() => undefined);
      if (!ok) await fly(tile, from, landingRect(), true).finished.catch(() => undefined);
      tile.remove();
    };
    // The pending copy is announced once the captured still is on its way; a frame that cannot be captured fails as unsaved.
    const send = async (): Promise<{ blob: Blob; answer: Result<PluckResult> } | null> => {
      const blob = await request.capture().catch(() => null);
      if (!blob) return null;
      const form = await multipart({ frameIndex: String(request.frameIndex), clusterId: target.id }, { name: "still", filename: "frame.png", type: "image/png", blob });
      const answer = api<PluckResult>("POST", `/api/workspaces/${slug}/clips/${clip.id}/stills`, { form });
      trayLive.say(`Saving frame ${request.timecode}...`);
      return { blob, answer: await answer };
    };
    void (async () => {
      const sent = await send();
      if (sent?.answer.ok) {
        const { reference, entry, cluster: counts } = sent.answer.data;
        thumbs.current.set(reference.id, URL.createObjectURL(sent.blob));
        await land(true);
        flushSync(() => {
          setCluster((c) => (c && c.id === target.id ? { ...c, itemCount: counts.itemCount, version: counts.version, entries: [...c.entries, { ...entry, reference }] } : c));
          clear();
          setReferences((list) => [reference, ...(list ?? [])]);
        });
        trayLive.say(`Plucked ${request.timecode} from ${clip.title}. ${counts.itemCount} items in ${target.title}.`);
      } else {
        const code = sent && !sent.answer.ok ? sent.answer.error?.error : undefined;
        // Any other failure (503 or no answer at all) means the still never reached storage.
        trayLive.say(
          code === "cluster_locked"
            ? `${target.title} is locked and cannot take new items.`
            : code === "seat_required"
              ? SEAT_COPY
              : `Storage is unreachable. Frame ${request.timecode} was not saved and ${target.title} is unchanged.`,
          true,
        );
        void land(false).then(clear);
      }
      strip.current?.focusPlayhead();
    })();
  };

  const items: MasonryItem[] = (references ?? []).map((r) => ({
    key: r.id,
    render: (style, ref) => (
      <ReferenceCard
        key={r.id}
        reference={r}
        style={style}
        itemRef={ref}
        onAdd={(ref2, el) => {
          opener.current = el;
          setAdding(ref2);
        }}
        onOpen={(ref2, el) => {
          clipOpener.current = el;
          setClip(ref2);
        }}
      />
    ),
  }));

  const searching = text !== "" && !tooLong;
  const answered = result && result.query === text ? result : null;
  const submitSearch = (event: FormEvent): void => {
    event.preventDefault();
    setQuery(text, "enter");
  };

  return (
    <main className="wall-screen" id="main" data-strip={clip ? "open" : "closed"}>
      <div className="wall-column">
        <div className="wall-tools">
          <form role="search" className="wall-search" onSubmit={submitSearch} noValidate>
            <ErrorSummary errors={searchForm.errors} shown={searchForm.shown} targets={{ q: "wall-search" }} />
            <input
              type="search"
              aria-label="Search references and clusters"
              placeholder="Search this brand"
              {...fieldAttrs("wall-search", tooLong ? Q_MESSAGE : undefined)}
              value={text}
              onChange={(e) => setQuery(e.target.value, "typing")}
            />
            <FieldError id="wall-search" message={tooLong ? Q_MESSAGE : undefined} />
          </form>
          <button ref={uploadButton} type="button" className="btn btn--primary" aria-label="Upload references" onClick={openFileChooser}>
            <Upload size={16} aria-hidden="true" />
            Upload
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void uploadFiles(files);
            }}
          />
          <div className="wall-tools__status">
            <LiveRegion live={wallLive} name="Wall announcements" />
            <LiveRegion live={searchLive} name="Search status" />
          </div>
        </div>
        <section className="wall" aria-label="Reference wall">
          {searching ? (
            answered && (
              <section aria-label="Search results" className="results">
                <h2 className="results__head mono-figures">{answered.counts.clusters} clusters</h2>
                <ul className="results__clusters">
                  {answered.clusters.map((c) => (
                    <li key={c.id}>
                      <a href={`/w/${slug}/clusters/${c.id}`} onClick={(e) => linkClick(e, `/w/${slug}/clusters/${c.id}`)}>
                        <span className="results__title">{c.title}</span>
                        <StatusTag status={c.status} />
                        <span className="mono">{c.itemCount} items</span>
                      </a>
                    </li>
                  ))}
                </ul>
                <h2 className="results__head mono-figures">{answered.counts.references} references</h2>
                <Masonry
                  className="wall__list"
                  label="Matching references"
                  columns={WALL_COLUMNS}
                  items={answered.references.map((r) => ({
                    key: r.id,
                    render: (style, ref) => (
                      <ReferenceCard key={r.id} reference={r} style={style} itemRef={ref} onAdd={(x, el) => { opener.current = el; setAdding(x); }} onOpen={(x, el) => { clipOpener.current = el; setClip(x); }} />
                    ),
                  }))}
                />
              </section>
            )
          ) : references === null ? (
            <div className="skeleton-wall" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} />)}
            </div>
          ) : references.length ? (
            <Masonry className="wall__list" label="References" columns={WALL_COLUMNS} items={items} />
          ) : (
            <Empty>No references yet. Upload images or clips.</Empty>
          )}
        </section>
      </div>
      {clip && (
        <Strip
          key={clip.id}
          ref={strip}
          clip={clip}
          onPluck={pluck}
          onClosed={() => {
            setClip(null);
            clipOpener.current?.focus();
          }}
        />
      )}
      <Tray
        slug={slug}
        cluster={cluster}
        activeId={activeKey}
        clusters={clusters}
        narrow={narrow}
        expanded={expanded}
        setExpanded={setExpanded}
        live={trayLive}
        arriving={arriving}
        arrivingThumb={arrivingThumb}
        bar={bar}
        thumbs={thumbs.current}
        enteringId={entering}
        docked={clip !== null}
        onChoose={choose}
        onNew={(el) => {
          opener.current = el;
          setCreating(true);
        }}
        setCluster={setCluster}
        reload={() => (activeId.current ? loadCluster(activeId.current) : Promise.resolve(null))}
      />
      {adding && <AddToCluster slug={slug} referenceTitle={adding.title} opener={opener} onClose={() => setAdding(null)} onPick={(c) => void addTo(adding, c)} />}
      {creating && <NewCluster workspaceName={workspace.name} opener={opener} onClose={() => setCreating(false)} onCreate={createCluster} />}
      {clipFile && (
        <ClipDetails
          fileName={clipFile.file.name}
          opener={uploadButton}
          onClose={() => {
            clipFile.done();
            setClipFile(null);
          }}
          onUpload={uploadClip}
        />
      )}
    </main>
  );
}
