// Recognition sessions: starting replays, lists, search, the event stream, spectrum, audio and transcripts.
import { createHash, randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { ENDED_STATES, type SessionState } from "../../shared/types";
import { authenticate, isUuid, permit, visibleProject, visibleSessionProject, type Caller } from "../access";
import { ApiError, invalid, notFound, sendJson, type Part, type Request, type Router } from "../http";
import { holdStreamConnection, one, pool, rows } from "../db";
import { idempotent } from "../idempotency";
import { projectQuota } from "../quota";
import { readWav, TONE_FIXTURE, wavFile } from "../audio";
import { parseSidecar, type Cue } from "../sidecar";
import { deleteObject, getObject, putObject, sessionPrefix, unavailableAs503 } from "../storage";
import { end, goLive, heldCapture, isLocal, openSession } from "../runtime";
import { machineArtifact, segmentById, SESSION_COLUMNS, sessionObject, sessionObjects, transcriptOf, type SessionRow } from "../transcript";
import { subscribe, type SessionEvent } from "../events";
import { bodyKey } from "./projects";
import { limited } from "../../shared/text";

const AUDIO_MAX = 50_000_000;
const SIDECAR_MAX = 200_000;
// Every event stream ends after its final `state` event; EventSource comes back this soon, so an approval's
// `correction` event still reaches every open view of an ended session well inside 2 seconds.
const RECONNECT_MS = 500;
const AUDIO_ERROR = "Upload a 16 kHz, 16-bit PCM WAV file with one or two channels.";
const SIDECAR_ERROR = "The sidecar must be WebVTT with one confidence per word.";
const sha = (data: Buffer | undefined) => (data ? createHash("sha256").update(data).digest("hex") : null);

async function sessionFor(request: Request): Promise<{ caller: Caller; scope: { project_id: string; org_id: string } }> {
  const caller = await authenticate(request.req);
  return { caller, scope: await visibleSessionProject(caller, request.params.session) };
}

/** The retained original audio as interleaved PCM with its channel count, plus the bytes as stored. */
async function retainedAudio(sessionId: string, scope: { project_id: string; org_id: string }): Promise<{ file: Buffer; pcm: Buffer; channels: number; live: boolean }> {
  const session = (await one<{ source: string; channels: number }>("SELECT source, channels FROM sessions WHERE id = $1", [sessionId]))!;
  const prefix = sessionPrefix(scope.org_id, scope.project_id, sessionId);
  if (session.source === "live") {
    const file = heldCapture(sessionId) ?? (await unavailableAs503(getObject(`${prefix}capture.pcm`)));
    if (!file) throw notFound();
    return { file, pcm: file, channels: session.channels, live: true };
  }
  const file = await unavailableAs503(getObject(`${prefix}upload.wav`));
  const wav = file ? readWav(file) : null;
  if (!file || !wav) throw notFound();
  return { file, pcm: wav.data, channels: wav.channels, live: false };
}

function sendBytes(res: ServerResponse, type: string, data: Buffer): void {
  res.writeHead(200, { "content-type": type, "content-length": data.length, "cache-control": "no-store" });
  res.end(data);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function registerSessions(router: Router): void {
  router.add(
    "POST",
    "/api/projects/:project/sessions",
    async (request) => {
      const caller = await authenticate(request.req);
      const project = await visibleProject(caller, request.params.project);
      const parts: Part[] = request.body.kind === "multipart" ? request.body.parts : [];
      const field = (name: string) => parts.find((p) => p.name === name && p.filename === null)?.data.toString("utf8") ?? "";
      const file = (name: string) => parts.find((p) => p.name === name && p.filename !== null)?.data;
      const key = await bodyKey(project.id, field("key_id"));
      permit(caller, "sessions.operate");
      const source = field("source");
      const label = limited(field("label"), 0, 80);
      const audio = file("audio");
      const sidecar = file("sidecar");
      const fingerprint = { route: "session-start", project: project.id, key_id: field("key_id"), source, label, audio: sha(audio), sidecar: sha(sidecar) };
      const outcome = await idempotent(caller, request, fingerprint, async () => {
        if (key?.revoked_at) throw new ApiError(409, "key_revoked", "This key is revoked.");
        if ((await projectQuota(project.id, project.quota_minutes)).exhausted) throw new ApiError(429, "quota_exhausted", "This project's monthly audio minutes are used up.");
        const fields: Record<string, string> = {};
        if (!key) fields.key_id = "Choose an active API key.";
        if (source !== "tone" && source !== "upload") fields.source = "Choose a source.";
        const wav = source === "upload" && audio && audio.length <= AUDIO_MAX ? readWav(audio) : null;
        if (source === "upload" && audio && audio.length > AUDIO_MAX) fields.audio = "Audio files can be up to 50,000,000 bytes.";
        else if (source === "upload" && !wav) fields.audio = AUDIO_ERROR;
        let cues: Cue[] = [];
        if (sidecar) {
          const parsed = sidecar.length <= SIDECAR_MAX ? parseSidecar(sidecar.toString("utf8")) : null;
          if (parsed) cues = parsed;
          else fields.sidecar = SIDECAR_ERROR;
        }
        if (label === null) fields.label = "Enter a label of up to 80 characters.";
        if (Object.keys(fields).length) throw invalid(fields);
        const id = randomUUID();
        const prefix = sessionPrefix(project.org_id, project.id, id);
        const original = source === "tone" ? TONE_FIXTURE : audio!;
        try {
          await unavailableAs503(putObject(`${prefix}upload.wav`, original, "audio/wav"));
          if (sidecar) await unavailableAs503(putObject(`${prefix}sidecar.vtt`, sidecar, "text/vtt"));
        } catch (error) {
          // Nothing is created: an upload that storage did not confirm leaves no session and no partial object.
          await Promise.all([deleteObject(`${prefix}upload.wav`), deleteObject(`${prefix}sidecar.vtt`)]).catch(() => undefined);
          throw error;
        }
        const pcm = source === "tone" ? readWav(TONE_FIXTURE)! : wav!;
        const filename = parts.find((p) => p.name === "audio")?.filename?.replace(/\.[^.]+$/, "");
        await openSession({
          id,
          projectId: project.id,
          orgId: project.org_id,
          keyId: key!.id,
          kind: "replay",
          source: source === "tone" ? "tone" : "upload",
          label: label! || (source === "tone" ? "Test tone (1 kHz)" : filename || "Uploaded recording"),
          channels: pcm.channels,
          cues,
        });
        await goLive(id, { replay: pcm.data });
        return { status: 201, body: { session: await sessionObject(id) } };
      });
      sendJson(request.res, outcome.status, outcome.body);
    },
    "multipart",
  );

  router.add("GET", "/api/projects/:project/sessions", async (request) => {
    const caller = await authenticate(request.req);
    const project = await visibleProject(caller, request.params.project);
    permit(caller, "sessions.read");
    const state = request.query.get("state");
    const found = await rows<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions s WHERE s.project_id = $1 ${state ? "AND s.state = $2" : ""} ORDER BY s.started_at DESC`,
      state ? [project.id, state] : [project.id],
    );
    sendJson(request.res, 200, { sessions: await sessionObjects(found) });
  });

  router.add("GET", "/api/sessions/search", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "sessions.read");
    const q = limited(request.query.get("q") ?? "", 1, 100);
    if (q === null) throw invalid({ q: "Enter 1 to 100 characters." });
    const found = await rows<SessionRow & { total: number }>(
      `SELECT ${SESSION_COLUMNS}, COUNT(*) OVER ()::int AS total FROM sessions s
        WHERE s.project_id = ANY($1::uuid[])
          AND (s.label ILIKE $2 ESCAPE '\\' OR (SELECT string_agg(g.text, ' ' ORDER BY g.idx) FROM segments g WHERE g.session_id = s.id) ILIKE $2 ESCAPE '\\')
        ORDER BY s.started_at DESC LIMIT 50`,
      [caller.projectIds, `%${escapeLike(q)}%`],
    );
    sendJson(request.res, 200, { total: found[0]?.total ?? 0, sessions: await sessionObjects(found) });
  });

  router.add("GET", "/api/sessions/:session", async (request) => {
    const { caller } = await sessionFor(request);
    permit(caller, "sessions.read");
    sendJson(request.res, 200, { session: await sessionObject(request.params.session) });
  });

  router.add("GET", "/api/sessions/:session/events", async (request) => {
    const { caller, scope } = await sessionFor(request);
    permit(caller, "sessions.read");
    const id = request.params.session;
    const { res } = request;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Events wait behind the initial snapshot, then are handled in order.
    let release!: () => void;
    let chain: Promise<unknown> = new Promise<void>((resolve) => (release = resolve));
    let open = true;
    let wasOpen = true;
    const timers: NodeJS.Timeout[] = [];
    const connection = holdStreamConnection(id);
    const finish = () => {
      if (!open) return;
      open = false;
      connection.release();
      unsubscribe();
      timers.forEach(clearInterval);
      res.end();
    };
    // Segment and correction events carry ids and are resolved here.
    const handle = async (message: SessionEvent) => {
      if (!open) return;
      if (message.event === "state") {
        write("state", message.data);
        if (wasOpen && ENDED_STATES.includes(message.data.state as SessionState)) finish();
      } else if (message.event === "frame") write("frame", message.data);
      else {
        const segment = await segmentById(id, message.data.segment_id);
        if (!segment || !open) return;
        if (message.event === "segment") write("segment", segment);
        else write("correction", { segment, wer: (await transcriptOf(id)).wer });
      }
    };
    const unsubscribe = subscribe(id, (message) => {
      chain = chain.then(() => handle(message)).catch(() => undefined);
    });
    request.req.on("close", finish);
    const session = await sessionObject(id);
    wasOpen = !ENDED_STATES.includes(session.state);
    res.write(`retry: ${RECONNECT_MS}\n`);
    if (!wasOpen) {
      // An ended session's first state is its final one, so the stream ends right after it. The state's id is the
      // number of approvals in the session; a reconnect whose Last-Event-ID is behind (or missing) first gets one
      // `correction` event per corrected segment, so no view misses an approval made between two connections.
      const approvals = await rows<{ segment_id: string }>(
        "SELECT segment_id FROM corrections WHERE session_id = $1 AND state = 'approved'",
        [id],
      );
      const seen = String(approvals.length);
      if (approvals.length > 0 && request.req.headers["last-event-id"] !== seen) {
        const wer = (await transcriptOf(id)).wer;
        for (const segmentId of new Set(approvals.map((row) => row.segment_id))) {
          const segment = await segmentById(id, segmentId);
          if (segment && open) write("correction", { segment, wer });
        }
      }
      if (open) {
        res.write(`id: ${seen}\n`);
        write("state", { state: session.state, close_reason: session.close_reason });
      }
      finish();
      return;
    }
    write("state", { state: session.state, close_reason: session.close_reason });
    release();
    const db = await connection.ready;
    if (!open) return;
    const project = (await one<{ quota_minutes: number }>("SELECT quota_minutes FROM projects WHERE id = $1", [scope.project_id], db))!;
    const sendQuota = async () => {
      if (open && wasOpen) write("quota", await projectQuota(scope.project_id, project.quota_minutes, db));
    };
    await sendQuota();
    timers.push(setInterval(() => void sendQuota().catch(() => undefined), 1000));
    timers.push(setInterval(() => open && res.write(": keep-alive\n\n"), 15_000));
  });

  router.add("GET", "/api/sessions/:session/spectrum", async (request) => {
    const { caller } = await sessionFor(request);
    permit(caller, "sessions.read");
    const id = request.params.session;
    const [recent, session] = await Promise.all([
      rows<{ bins: number[] }>("SELECT bins FROM spectrum_rows WHERE session_id = $1 ORDER BY frame DESC LIMIT 240", [id]),
      one<{ frame: number; peak_bin: number; mean: number[] }>("SELECT frame, peak_bin, mean FROM sessions WHERE id = $1", [id]),
    ]);
    const ordered = recent.reverse().map((row) => row.bins.map((v) => v / 1000));
    sendJson(request.res, 200, { frame: session!.frame, peak_bin: session!.peak_bin, rows: ordered, mean: session!.mean });
  });

  router.add("POST", "/api/sessions/:session/close", async (request) => {
    const { caller } = await sessionFor(request);
    permit(caller, "sessions.operate");
    const id = request.params.session;
    const ended = async () => !!(await one("SELECT 1 AS ended FROM sessions WHERE id = $1 AND ended_at IS NOT NULL", [id]));
    if (await ended()) throw new ApiError(409, "session_ended", "This session has already ended.");
    if (isLocal(id)) await end(id, "closed", "client");
    else {
      // Another instance owns the stream; it ends the session on its next tick.
      const requested = await pool.query("UPDATE sessions SET close_requested = true WHERE id = $1 AND ended_at IS NULL", [id]);
      if (!requested.rowCount) throw new ApiError(409, "session_ended", "This session has already ended.");
      for (let i = 0; i < 40 && !(await ended()); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    sendJson(request.res, 200, { session: await sessionObject(id) });
  });

  router.add("GET", "/api/sessions/:session/audio", async (request) => {
    const { caller, scope } = await sessionFor(request);
    permit(caller, "sessions.read");
    const audio = await retainedAudio(request.params.session, scope);
    sendBytes(request.res, audio.live ? `audio/L16;rate=16000;channels=${audio.channels}` : "audio/wav", audio.file);
  });

  router.add("GET", "/api/sessions/:session/transcript", async (request) => {
    const { caller } = await sessionFor(request);
    permit(caller, "sessions.read");
    sendJson(request.res, 200, await transcriptOf(request.params.session));
  });

  router.add("GET", "/api/sessions/:session/transcript/machine.json", async (request) => {
    const { caller, scope } = await sessionFor(request);
    permit(caller, "sessions.read");
    const id = request.params.session;
    if (!(await one("SELECT 1 AS ended FROM sessions WHERE id = $1 AND ended_at IS NOT NULL", [id]))) {
      throw new ApiError(409, "session_open", "The machine transcript is written when the session ends.");
    }
    const key = `${sessionPrefix(scope.org_id, scope.project_id, id)}machine-transcript.json`;
    let artifact = await unavailableAs503(getObject(key));
    if (!artifact) {
      // The close could not reach storage; the artifact is rebuilt byte for byte from the final segments.
      artifact = await machineArtifact(id);
      await unavailableAs503(putObject(key, artifact, "application/json"));
      await pool.query("UPDATE sessions SET artifact_stored = true WHERE id = $1", [id]);
    }
    sendBytes(request.res, "application/json", artifact);
  });

  router.add("GET", "/api/sessions/:session/segments/:segment/audio", async (request) => {
    const { caller, scope } = await sessionFor(request);
    const segment = isUuid(request.params.segment)
      ? await one<{ start_ms: number; end_ms: number }>("SELECT start_ms, end_ms FROM segments WHERE id = $1 AND session_id = $2", [request.params.segment, request.params.session])
      : undefined;
    if (!segment) throw notFound();
    permit(caller, "sessions.read");
    const audio = await retainedAudio(request.params.session, scope);
    const perMs = 32 * audio.channels;
    const slice = audio.pcm.subarray(segment.start_ms * perMs, Math.min(audio.pcm.length, segment.end_ms * perMs));
    sendBytes(request.res, "audio/wav", wavFile(slice, audio.channels));
  });
}

