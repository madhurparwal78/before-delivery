import type { PoolClient } from 'pg';
import type { Ctx } from '../api/ctx.js';
import { AppError } from '../core/errors.js';
import { JobLogWriter, parseCommand, writeCommandTarget, emitCommandParts, expandScript } from './pipeline-run.js';
import { splitLines } from './repo.js';
import { globMatch } from './push-rules.js';

export interface JobRow {
  id: number;
  pipeline_id: number;
  project_id: number;
  name: string;
  stage: string;
  stage_index: number;
  config_index: number;
  status: string;
  attempt: number;
  retried: boolean;
  failure_reason: string | null;
  needs: string[];
  layer: number;
  row: number;
  x: number;
  y: number;
  started_at: number | null;
  finished_at: number | null;
  start_at: number | null;
  wait_until: number | null;
  wait_started_at?: number | null;
  script: string[];
  config: Record<string, unknown>;
  env_name: string | null;
  when_kind: string;
  allow_failure: boolean;
  interruptible: boolean;
  resource_group: string | null;
  retry_config: { max: number; when: string[] } | null;
  timeout_ms: number | null;
  started_by: number | null;
  deploy_number: number | null;
  environment_id: number | null;
  has_env_action: boolean;
  artifacts: { paths: string[]; expire_in?: string; when?: string };
  cache_config: { key?: string; fallback_keys?: string[]; paths?: string[]; policy?: string };
  dependencies: string[];
  matrix_values: Record<string, string>;
  previous_attempt: number | null;
  next_attempt: number | null;
  script_cursor?: number | null;
}

export interface RoundResult {
  jobs: Array<{ id: number; name: string; status: string }>;
  changed: boolean;
}

interface JobState {
  row: JobRow;
  script: string[];
  cursor: number;
  workspace: Map<string, string>;
  waiting: boolean;
  waitStart: number | null;
  log: JobLogWriter;
  startedThisRound: boolean;
}

export class Scheduler {
  constructor(private ctx: Ctx) {}

  now(): number {
    return this.ctx.now();
  }

  /** One scheduler round: the four published steps, in order. */
  async round(c: PoolClient, projectId: number): Promise<RoundResult> {
    const changedJobs: Array<{ id: number; name: string; status: string }> = [];
    let changed = false;
    const now = this.now();

    const jobRows = (await c.query<JobRow>(`
      SELECT j.* FROM jobs j WHERE j.project_id = $1 AND j.status IN ('created','pending','running','scheduled','manual','waiting')
      ORDER BY j.pipeline_id, j.stage_index, j.config_index, j.id
    `, [projectId])).rows;

    // Load states
    const states = new Map<number, JobState>();
    for (const row of jobRows) {
      const log = new JobLogWriter();
      const prev = (await c.query<{ n: number; stream: string; text: string }>(`SELECT n, stream, text FROM job_log_lines WHERE job_id = $1 ORDER BY n`, [row.id])).rows;
      for (const p of prev) log.add(p.stream as 'out' | 'sys', p.text);
      states.set(row.id, {
        row,
        script: await this.loadScript(row),
        cursor: await this.cursorFromLog(c, row.id),
        workspace: await this.loadWorkspace(c, row),
        waiting: false,
        waitStart: row.wait_started_at !== null && row.wait_started_at !== undefined ? Number(row.wait_started_at) : null,
        log,
        startedThisRound: false,
      });
    }

    // Step 1: scheduled jobs whose start_at passed become pending; running jobs past timeout fail
    for (const st of states.values()) {
      if (st.row.status === 'scheduled' && st.row.start_at !== null && now >= st.row.start_at) {
        await this.setStatus(c, st, 'pending', null);
        changed = true;
        changedJobs.push({ id: st.row.id, name: st.row.name, status: 'pending' });
      }
      if (st.row.status === 'running' && st.row.started_at !== null) {
        const timeout = st.row.timeout_ms ?? this.ctx.settings.jobTimeoutMs;
        if (now - st.row.started_at >= timeout) {
          await this.failJob(c, st, 'job_timeout', 'Job exceeded its time limit.');
          changed = true;
          changedJobs.push({ id: st.row.id, name: st.row.name, status: 'failed' });
        }
      }
    }

    // Step 2: pending jobs start in order
    const pending = [...states.values()].filter((s) => s.row.status === 'pending');
    pending.sort((a, b) => a.row.pipeline_id - b.row.pipeline_id || a.row.stage_index - b.row.stage_index || a.row.config_index - b.row.config_index || a.row.id - b.row.id);
    const running = [...states.values()].filter((s) => s.row.status === 'running' || s.row.status === 'waiting').length;
    let runningCount = running;
    const resourceBusy = new Set<string>();
    for (const st of [...states.values()]) {
      if ((st.row.status === 'running' || st.row.status === 'waiting') && st.row.resource_group) resourceBusy.add(st.row.resource_group);
    }
    for (const st of pending) {
      if (runningCount >= this.ctx.settings.parallelLimit) break;
      if (st.row.resource_group && resourceBusy.has(st.row.resource_group)) continue;
      await this.startJob(c, st);
      resourceBusy.add(st.row.resource_group ?? `__job_${st.row.id}`);
      runningCount++;
      changed = true;
      changedJobs.push({ id: st.row.id, name: st.row.name, status: 'running' });
    }

    // Step 3: each running job takes exactly one turn
    for (const st of [...states.values()]) {
      if (st.row.status !== 'running' && st.row.status !== 'waiting') continue;
      const res = await this.takeTurn(c, st);
      if (res) {
        changed = true;
        changedJobs.push({ id: st.row.id, name: st.row.name, status: st.row.status });
      }
    }

    // Step 4: eligibility rollup
    const allJobs = (await c.query<JobRow>(`SELECT j.* FROM jobs j WHERE j.project_id = $1`, [projectId])).rows;
    await this.rollup(c, projectId, allJobs, changedJobs, () => {
      changed = true;
    });

    // Pipeline and stage statuses
    await this.recomputePipelines(c, projectId);

    return { jobs: changedJobs, changed };
  }

  private async cursorFromLog(c: PoolClient, jobId: number): Promise<number> {
    const r = await c.query<{ config: Record<string, unknown> }>(`SELECT config FROM jobs WHERE id = $1`, [jobId]);
    const cur = (r.rows[0]?.config as { script_cursor?: number } | undefined)?.script_cursor;
    if (typeof cur === 'number') return cur;
    return 0;
  }

  private async loadScript(row: JobRow): Promise<string[]> {
    if (Array.isArray(row.script)) return row.script as string[];
    return [];
  }

  private async loadWorkspace(c: PoolClient, row: JobRow): Promise<Map<string, string>> {
    // workspace = commit files + downloaded artifacts + restored caches + writes
    const map = new Map<string, string>();
    const sha = (await c.query<{ sha: string }>(`SELECT sha FROM pipelines WHERE id = $1`, [row.pipeline_id])).rows[0]?.sha;
    if (!sha) return map;
    const commit = await (await import('./repo.js')).getCommit(c, sha);
    if (!commit) return map;
    const files = await (await import('./repo.js')).readTreeFull(c, commit.tree, async (k) => this.ctx.storage.tryGet(k));
    for (const [k, v] of files) map.set(k, v);
    // restored caches: read back from logs is complex; caches recorded at start
    return map;
  }

  private async setStatus(c: PoolClient, st: JobState, status: string, reason: string | null): Promise<void> {
    await c.query(`UPDATE jobs SET status = $2, failure_reason = $3 WHERE id = $1`, [st.row.id, status, reason]);
    st.row.status = status;
    st.row.failure_reason = reason;
  }

  private async startJob(c: PoolClient, st: JobState): Promise<void> {
    const now = this.now();
    await c.query(`UPDATE jobs SET status = 'running', started_at = $2 WHERE id = $1`, [st.row.id, now]);
    st.row.status = 'running';
    st.row.started_at = now;
    st.startedThisRound = true;

    const log = new JobLogWriter();
    // restore existing lines first
    const prev = (await c.query<{ n: number; stream: string; text: string }>(`SELECT n, stream, text FROM job_log_lines WHERE job_id = $1 ORDER BY n`, [st.row.id])).rows;
    for (const p of prev) log.add(p.stream as 'out' | 'sys', p.text);
    st.log = log;

    // cache restore
    const cache = st.row.cache_config ?? {};
    const policy = cache.policy ?? 'pull-push';
    if ((policy === 'pull' || policy === 'pull-push') && (cache.key ?? null) !== null) {
      log.add('sys', 'section_start cache');
      const keys = [cache.key!, ...(cache.fallback_keys ?? [])];
      let hit: string | null = null;
      let lastTried = cache.key!;
      let logged = false;
      for (const key of keys) {
        const content = await this.ctx.storage.tryGet(`caches/${st.row.project_id}/${key}`);
        lastTried = key;
        if (content === null) continue;
        const parsed = JSON.parse(content) as Record<string, string>;
        const cacheTime = await this.cacheTime(c, st.row.project_id, key);
        if (cacheTime !== null && now - cacheTime > this.ctx.settings.cacheTtlMs) {
          log.add('sys', `Cache stale: ${key}`);
          logged = true;
          continue;
        }
        for (const [path, v] of Object.entries(parsed)) {
          if ((cache.paths ?? []).some((g) => globMatch(g, path))) st.workspace.set(path, v);
        }
        hit = key;
        break;
      }
      if (hit !== null && !logged) {
        log.add('sys', hit === cache.key ? `Cache hit: ${hit}` : `Cache hit from fallback: ${hit}`);
      } else if (!logged) {
        log.add('sys', `Cache miss: ${lastTried}`);
      }
      log.add('sys', 'section_end cache');
    }

    // artifact downloads
    for (const dep of st.row.dependencies ?? st.row.needs) {
      const depJob = (await c.query<{ id: number }>(`SELECT id FROM jobs WHERE pipeline_id = $1 AND name = $2 AND attempt = (SELECT max(attempt) FROM jobs WHERE pipeline_id = $1 AND name = $2) ORDER BY id DESC LIMIT 1`, [st.row.pipeline_id, dep])).rows[0];
      if (!depJob) continue;
      const arts = (await c.query<{ path: string; object_key: string | null; expires_at: number | null }>(`SELECT path, object_key, expires_at FROM artifacts WHERE job_id = $1`, [depJob.id])).rows;
      let expired = false;
      for (const a of arts) {
        if (a.expires_at !== null && a.expires_at < now) {
          expired = true;
          continue;
        }
      }
      if (expired) {
        log.add('sys', `Artifacts of ${dep} have expired.`);
        await this.failJob(c, st, 'system_failure', `Artifacts of ${dep} have expired.`);
        return;
      }
      for (const a of arts) {
        const content = a.object_key ? await this.ctx.storage.tryGet(a.object_key) : null;
        if (content !== null) {
          st.workspace.set(a.path, content);
          log.add('sys', `Downloaded artifacts of ${dep}`);
        }
      }
      break;
    }
    log.add('sys', 'section_start script');
    await this.persistLog(c, st);
  }

  private async cacheTime(c: PoolClient, projectId: number, key: string): Promise<number | null> {
    const r = await c.query<{ created_at: number }>(`SELECT created_at FROM artifacts_cache WHERE project_id = $1 AND key = $2`, [projectId, key]);
    return r.rows[0]?.created_at ?? null;
  }

  private async persistLog(c: PoolClient, st: JobState): Promise<void> {
    await c.query(`UPDATE jobs SET config = config || $2 WHERE id = $1`, [st.row.id, JSON.stringify({ script_cursor: st.cursor })]);
    await c.query(`DELETE FROM job_log_lines WHERE job_id = $1`, [st.row.id]);
    const lines = st.log.all();
    if (lines.length > 0) {
      const values: unknown[] = [];
      const params: string[] = [];
      lines.forEach((l, i) => {
        params.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`);
        values.push(st.row.id, l.n, l.stream, l.text);
      });
      // fix: 4 values per row
      await c.query(`INSERT INTO job_log_lines (job_id, n, stream, text) VALUES ${lines.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ')}`, lines.flatMap((l) => [st.row.id, l.n, l.stream, l.text]));
      void values; void params;
    }
    await this.ctx.live(c, st.row.project_id, 'job_log', { job_id: st.row.id, lines: st.log.formatted() });
  }

  private async takeTurn(c: PoolClient, st: JobState): Promise<boolean> {
    const now = this.now();
    if (st.row.status === 'waiting') {
      if (st.waitStart === null) st.waitStart = st.row.started_at !== null && st.row.started_at !== undefined ? Number(st.row.started_at) : now;
      if (now >= st.waitStart + Number(st.row.wait_until ?? 0)) {
        st.row.status = 'running';
        await c.query(`UPDATE jobs SET status = 'running', wait_until = NULL WHERE id = $1`, [st.row.id]);
        return true;
      }
      return false;
    }
    if (st.row.status !== 'running') return false;
    if (st.cursor >= st.script.length) {
      return await this.finishScript(c, st);
    }
    const cmd = st.script[st.cursor];
    const parsed = parseCommand(cmd);
    if (parsed.kind === 'print') {
      st.log.add('out', parsed.text);
      st.cursor++;
    } else if (parsed.kind === 'write') {
      const t = writeCommandTarget(cmd);
      if (t) {
        st.workspace.set(t.path, `${t.text}\n`);
        st.log.add('sys', `Wrote ${t.path}`);
      }
      st.cursor++;
    } else if (parsed.kind === 'wait') {
      const ms = parseInt(parsed.text, 10);
      st.log.add('sys', `Waiting ${ms} ms`);
      st.waitStart = now;
      st.cursor++;
      await c.query(`UPDATE jobs SET status = 'waiting', wait_until = $2, wait_started_at = $3 WHERE id = $1`, [st.row.id, ms, now]);
      st.row.status = 'waiting';
      await this.persistLog(c, st);
      return true;
    } else if (parsed.kind === 'exit') {
      st.log.add('sys', `Exit code ${parsed.text}`);
      st.cursor++;
      const code = parseInt(parsed.text, 10);
      if (code === 0) {
        return await this.finishScript(c, st);
      }
      await this.failJob(c, st, 'script_failure', null);
      return true;
    } else if (parsed.kind === 'emit') {
      const t = emitCommandParts(cmd);
      if (t) {
        const content = st.workspace.get(t.path) ?? '';
        let ok = true;
        try {
          const data = JSON.parse(content);
          if (t.kind === 'tests') {
            if (!Array.isArray((data as Record<string, unknown>).cases)) ok = false;
          } else if (t.kind === 'coverage') {
            if (typeof (data as Record<string, unknown>).percent !== 'number') ok = false;
          } else if (t.kind === 'quality' || t.kind === 'security') {
            if (!Array.isArray(data)) ok = false;
          }
          if (!ok) throw new Error('bad');
        } catch {
          await this.failJob(c, st, 'script_failure', `Report ${t.path} is not valid ${t.kind} JSON.`);
          return true;
        }
        await c.query(`INSERT INTO reports (job_id, pipeline_id, kind, data, created_at) VALUES ($1, $2, $3, $4, $5)`, [st.row.id, st.row.pipeline_id, t.kind, content, now]);
      }
      st.log.add('sys', `Stored ${t?.kind ?? ''} report from ${t?.path ?? ''}`);
      st.cursor++;
    } else {
      st.log.add('sys', `Unknown command: ${parsed.text}`);
      st.cursor++;
      await this.failJob(c, st, 'script_failure', `Unknown command: ${parsed.text}`);
      return true;
    }
    if (st.cursor >= st.script.length) {
      await this.persistLog(c, st);
      return await this.finishScript(c, st);
    }
    await this.persistLog(c, st);
    return true;
  }

  private async finishScript(c: PoolClient, st: JobState): Promise<boolean> {
    const now = this.now();
    st.log.add('sys', 'section_end script');
    // artifact upload
    const artPaths = st.row.artifacts?.paths ?? [];
    const artWhen = st.row.artifacts?.when ?? 'on_success';
    const success = true;
    if (artPaths.length > 0 && (artWhen === 'always' || (artWhen === 'on_success' && success))) {
      st.log.add('sys', 'section_start artifacts');
      const uploaded: string[] = [];
      const expireMs = st.row.artifacts?.expire_in ? this.parseExpiry(st.row.artifacts.expire_in) : this.ctx.settings.artifactTtlMs;
      const expiresAt = expireMs === -1 ? null : now + expireMs;
      for (const [path, content] of st.workspace) {
        if (artPaths.some((g) => globMatch(g, path))) {
          const key = `artifacts/${st.row.id}/${path}`;
          try {
            await this.ctx.storage.put(key, content);
            uploaded.push(path);
            await c.query(`INSERT INTO artifacts (job_id, path, size, expires_at, object_key, created_at) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (job_id, path) DO UPDATE SET object_key = EXCLUDED.object_key, expires_at = EXCLUDED.expires_at`,
              [st.row.id, path, Buffer.byteLength(content, 'utf8'), expiresAt, key, now]);
            await c.query(`INSERT INTO deploy_artifacts (deployment_id, path, object_key, size) SELECT d.id, $2, $3, $4 FROM deployments d WHERE d.job_id = $1 ON CONFLICT DO NOTHING`, [st.row.id, path, key, Buffer.byteLength(content, 'utf8')]);
          } catch {
            st.log.add('sys', 'Artifact upload failed: file storage is unavailable.');
            await this.failJob(c, st, 'system_failure', 'Artifact upload failed: file storage is unavailable.');
            return true;
          }
        }
      }
      st.log.add('sys', `Uploaded ${uploaded.length} artifact files`);
      st.log.add('sys', 'section_end artifacts');
    }
    // cache save
    const cache = st.row.cache_config ?? {};
    const policy = cache.policy ?? 'pull-push';
    if ((policy === 'push' || policy === 'pull-push') && cache.key) {
      const map: Record<string, string> = {};
      for (const [path, v] of st.workspace) {
        if ((cache.paths ?? []).some((g) => globMatch(g, path))) map[path] = v;
      }
      try {
        await this.ctx.storage.put(`caches/${st.row.project_id}/${cache.key}`, JSON.stringify(map));
        await c.query(`INSERT INTO artifacts_cache (project_id, key, created_at) VALUES ($1, $2, $3)
          ON CONFLICT (project_id, key) DO UPDATE SET created_at = EXCLUDED.created_at`, [st.row.project_id, cache.key, now]);
        st.log.add('sys', `Cache saved: ${cache.key}`);
      } catch {
        st.log.add('sys', 'Cache skipped: file storage is unavailable.');
      }
    }
    const status = 'success';
    st.log.add('sys', `Job finished: ${status}`);
    await this.setStatus(c, st, status, null);
    st.row.finished_at = now;
    await c.query(`UPDATE jobs SET finished_at = $2 WHERE id = $1`, [st.row.id, now]);
    await this.persistLog(c, st);
    await this.sealLog(c, st);
    await this.ctx.live(c, st.row.project_id, 'job', { job_id: st.row.id, status });
    return true;
  }

  private async sealLog(c: PoolClient, st: JobState): Promise<void> {
    try {
      const text = st.log.all().map((l) => `${l.n} ${l.stream} ${l.text}\n`).join('');
      await this.ctx.storage.put(`logs/${st.row.id}.log`, text);
      await c.query(`UPDATE jobs SET config = config || $2 WHERE id = $1`, [st.row.id, JSON.stringify({ log_sealed: true })]);
    } catch {
      // retried later
    }
  }

  private parseExpiry(v: string): number {
    if (v === 'never') return -1;
    const m = v.trim().match(/^(\d+)(ms|s|m|h)$/);
    if (!m) return this.ctx.settings.artifactTtlMs;
    const n = parseInt(m[1], 10);
    if (m[2] === 'ms') return n;
    if (m[2] === 's') return n * 1000;
    if (m[2] === 'm') return n * 60_000;
    return n * 3_600_000;
  }

  async failJob(c: PoolClient, st: JobState, reason: string, logText: string | null): Promise<void> {
    const now = this.now();
    if (logText) st.log.add('sys', logText);
    const allowFailure = st.row.allow_failure;
    const status = allowFailure ? 'warning' : 'failed';
    st.log.add('sys', `Job finished: ${status}`);
    await this.setStatus(c, st, status, reason);
    st.row.finished_at = now;
    await c.query(`UPDATE jobs SET finished_at = $2 WHERE id = $1`, [st.row.id, now]);
    await this.persistLog(c, st);
    await this.sealLog(c, st);
    await this.ctx.live(c, st.row.project_id, 'job', { job_id: st.row.id, status });
    void reason;
  }

  /** Step 4: statuses update, eligibility, retries. */
  private async rollup(c: PoolClient, projectId: number, allJobs: JobRow[], changedJobs: Array<{ id: number; name: string; status: string }>, mark: () => void): Promise<void> {
    const now = this.now();
    const byPipeline = new Map<number, JobRow[]>();
    for (const j of allJobs) {
      if (!byPipeline.has(j.pipeline_id)) byPipeline.set(j.pipeline_id, []);
      byPipeline.get(j.pipeline_id)!.push(j);
    }
    for (const [pipelineId, jobs] of byPipeline) {
      const latest = latestAttempts(jobs);
      const changed: JobRow[] = [];
      for (const j of latest) {
        if (j.status === 'created') {
          const eligible = await this.eligibility(c, pipelineId, j, latest, now);
          if (eligible !== null) {
            await c.query(`UPDATE jobs SET status = $2 WHERE id = $1`, [j.id, eligible]);
            j.status = eligible;
            changed.push(j);
            changedJobs.push({ id: j.id, name: j.name, status: eligible });
            mark();
          }
        }
      }
      // automatic retries
      for (const j of latest) {
        if (j.status === 'failed' || j.status === 'warning') {
          if (j.status === 'warning') continue;
          const cfg = j.retry_config ?? { max: 0, when: [] };
          const attemptCount = (await c.query<{ n: string }>(`SELECT count(*) AS n FROM jobs WHERE pipeline_id = $1 AND name = $2`, [pipelineId, j.name])).rows[0];
          const retries = Number(attemptCount?.n ?? 1) - 1;
          if (retries < cfg.max && cfg.when.includes(j.failure_reason ?? '')) {
            await this.retryJob(c, j, false);
            mark();
          }
        }
      }
    }
  }

  async retryJob(c: PoolClient, job: JobRow, manual: boolean): Promise<number> {
    const newId = (await c.query<{ id: number }>(`
      INSERT INTO jobs (pipeline_id, project_id, name, stage, stage_index, config_index, status, attempt, script, config, env_name, when_kind, allow_failure, interruptible, resource_group, retry_config, timeout_ms, started_by, deploy_number, environment_id, has_env_action, artifacts, cache_config, dependencies, matrix_values, needs, layer, row, x, y, previous_attempt)
      SELECT pipeline_id, project_id, name, stage, stage_index, config_index, 'pending', attempt + 1, script, config, env_name, when_kind, allow_failure, interruptible, resource_group, retry_config, timeout_ms, started_by, deploy_number, environment_id, has_env_action, artifacts, cache_config, dependencies, matrix_values, needs, layer, row, x, y, $2
      FROM jobs WHERE id = $1 RETURNING id
    `, [job.id, job.id])).rows[0].id;
    await c.query(`UPDATE jobs SET retried = $2 WHERE id = $1`, [job.id, !manual]);
    if (manual) {
      await c.query(`UPDATE jobs SET retried = false, next_attempt = $2 WHERE id = $1`, [job.id, newId]);
    } else {
      await c.query(`UPDATE jobs SET retried = true, next_attempt = $2 WHERE id = $1`, [job.id, newId]);
    }
    return newId;
  }

  private async eligibility(c: PoolClient, pipelineId: number, job: JobRow, all: JobRow[], now: number): Promise<string | null> {
    const latest = latestAttempts(all);
    const needsMet = await this.needsMet(job, latest);
    if (!needsMet) return null;
    const when = job.when_kind;
    if (when === 'manual') return 'manual';
    if (when === 'delayed') {
      const startIn = this.parseStartIn((job.config as { start_in?: string }).start_in);
      await c.query(`UPDATE jobs SET status = 'scheduled', start_at = $2 WHERE id = $1`, [job.id, now + startIn]);
      return 'scheduled';
    }
    const failed = latest.some((j) => j.status === 'failed');
    const warning = latest.some((j) => j.status === 'warning');
    if (when === 'on_success') {
      if (failed || warning) return 'skipped';
      return 'pending';
    }
    if (when === 'on_failure') {
      if (failed || warning) return 'pending';
      return 'skipped';
    }
    if (when === 'always') return 'pending';
    return null;
  }

  private parseStartIn(v: string | undefined): number {
    if (!v) return 0;
    const m = v.trim().match(/^(\d+)(ms|s|m|h)$/);
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    if (m[2] === 'ms') return n;
    if (m[2] === 's') return n * 1000;
    if (m[2] === 'm') return n * 60_000;
    return n * 3_600_000;
  }

  private async needsMet(job: JobRow, all: JobRow[]): Promise<boolean> {
    const latest = latestAttempts(all);
    if (job.needs.length > 0) {
      for (const need of job.needs) {
        const target = latest.filter((j) => j.name === need);
        if (target.length === 0) return false;
        for (const t of target) {
          if (t.status === 'created' || t.status === 'pending' || t.status === 'running' || t.status === 'scheduled' || t.status === 'manual') return false;
        }
      }
      return true;
    }
    for (const j of latest) {
      if (j.stage_index < job.stage_index) {
        if (j.status === 'created' || j.status === 'pending' || j.status === 'running' || j.status === 'scheduled' || j.status === 'manual') return false;
      }
    }
    return true;
  }

  private async recomputePipelines(c: PoolClient, projectId: number): Promise<void> {
    const pipelines = (await c.query<{ id: number; status: string }>(`SELECT id, status FROM pipelines WHERE project_id = $1`, [projectId])).rows;
    for (const p of pipelines) {
      const jobs = (await c.query<JobRow>(`SELECT * FROM jobs WHERE pipeline_id = $1`, [p.id])).rows;
      const latest = latestAttempts(jobs);
      const status = rollupStatus(latest);
      if (status !== p.status) {
        await c.query(`UPDATE pipelines SET status = $2, finished_at = CASE WHEN $2 IN ('success','failed','canceled','skipped','warning') THEN $3 ELSE finished_at END WHERE id = $1`, [p.id, status, this.now()]);
        await this.ctx.live(c, projectId, 'pipeline', { pipeline_id: p.id, status });
        await this.onPipelineFinished(c, projectId, p.id, status);
      }
    }
  }

  async onPipelineFinished(c: PoolClient, projectId: number, pipelineId: number, status: string): Promise<void> {
    if (!['success', 'failed', 'canceled', 'skipped', 'warning'].includes(status)) return;
    const hooks = (await c.query<{ id: number; url: string; secret: string; events: string[] }>(`SELECT id, url, secret, events FROM webhooks WHERE project_id = $1`, [projectId])).rows;
    const pl = (await c.query<{ id: number; ref: string; sha: string; source: string; status: string }>(`SELECT id, ref, sha, source, status FROM pipelines WHERE id = $1`, [pipelineId])).rows[0];
    if (!pl) return;
    for (const h of hooks) {
      if (!h.events.includes('pipeline')) continue;
      await queueDelivery(c, projectId, h.id, 'pipeline', {
        event: 'pipeline',
        project: { id: projectId },
        pipeline: { id: pl.id, ref: pl.ref, sha: pl.sha, status: pl.status, source: pl.source },
      });
    }
    if (pl.source === 'train') {
      const { onCarPipelineFinished } = await import('./train.js');
      const project = (await c.query<{ path: string; default_branch: string }>(`SELECT path, default_branch FROM projects WHERE id = $1`, [projectId])).rows[0];
      if (project) {
        await onCarPipelineFinished(this.ctx, c, projectId, project.path, pipelineId, status, project.default_branch);
      }
    }
  }
}

export function latestAttempts(jobs: JobRow[]): JobRow[] {
  const best = new Map<string, JobRow>();
  for (const j of jobs) {
    const cur = best.get(j.name);
    if (!cur || j.attempt > cur.attempt) best.set(j.name, j);
  }
  return [...best.values()].sort((a, b) => a.stage_index - b.stage_index || a.config_index - b.config_index || a.id - b.id);
}

/** The single stage/pipeline status rollup, first matching rule wins. */
export function rollupStatus(jobs: JobRow[]): string {
  if (jobs.length === 0) return 'created';
  const statuses = new Set(jobs.map((j) => j.status));
  if (jobs.every((j) => j.status === 'created')) return 'created';
  if (jobs.some((j) => j.status === 'running' || j.status === 'pending' || j.status === 'waiting' || j.status === 'created')) return 'running';
  const blockingManual = jobs.some((j) => j.status === 'manual' && !j.allow_failure);
  if (blockingManual) return 'blocked';
  if (statuses.has('failed')) return 'failed';
  if (statuses.has('canceled')) return 'canceled';
  if (statuses.has('warning')) return 'warning';
  if (jobs.every((j) => j.status === 'skipped')) return 'skipped';
  if (statuses.has('scheduled')) return 'scheduled';
  return 'success';
}

export async function queueDelivery(c: PoolClient, projectId: number, webhookId: number, event: string, payload: Record<string, unknown>): Promise<void> {
  void projectId;
  await c.query(`INSERT INTO deliveries (webhook_id, event, payload, state, attempts, next_at, retry_step, created_at) VALUES ($1, $2, $3, 'pending', 0, $4, 0, $4)`, [webhookId, event, JSON.stringify(payload), 0]);
}

export { expandScript, splitLines, globMatch };
export type { Ctx };
export { AppError };
