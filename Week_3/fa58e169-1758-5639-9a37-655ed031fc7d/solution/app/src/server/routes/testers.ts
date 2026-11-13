import type { FollowPattern, NoteEntry } from '../../shared/api.ts'
import { config } from '../config.ts'
import { serial } from '../concurrency.ts'
import { checkName, checkPasswordLength, mailUnavailable, object, text, checkEmail } from './accounts.ts'
import { checkPassword, hashPassword, newToken, openSession, sessionCookie } from '../auth.ts'
import { one, pool, rows, transaction } from '../db.ts'
import { HttpError, conflict, invalid, notFound, route } from '../http.ts'
import { emit } from '../live.ts'
import { MailUnavailable, sendMail } from '../mail.ts'
import { accessOf, cellsOf, derive, designerAccess, latestVersion, loadSnapshot, noteCounts, testerAccess } from '../store.ts'
import { counterSet, counterStep } from '../valkey.ts'
import { person, testerEntries } from './patterns.ts'

interface TesterState { version: number; row: number }

async function testerState(patternId: string, userId: string): Promise<TesterState> {
  return (await one<TesterState>(pool, 'SELECT version, row FROM testers WHERE pattern_id = $1 AND user_id = $2', [patternId, userId]))!
}

async function versionHeight(patternId: string, version: number): Promise<number> {
  return (await one<{ height: number }>(pool, 'SELECT height FROM versions WHERE pattern_id = $1 AND version = $2', [patternId, version]))!.height
}

route('POST', '/api/patterns/:id/testers', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const email = checkEmail(object(ctx.body()).email)
  const already = await one(pool,
    'SELECT 1 FROM testers t JOIN users u ON u.id = t.user_id WHERE t.pattern_id = $1 AND u.email = $2', [pattern.id, email])
  if (already) throw conflict('already_testing', 'That person is already testing this pattern.')
  if ((await latestVersion(pool, pattern.id)) === 0) throw conflict('no_version', 'Save a version before inviting testers.')
  const token = newToken()
  const id = (await pool.query('INSERT INTO invites (token, pattern_id, email, status) VALUES ($1, $2, $3, $4) RETURNING id',
    [token, pattern.id, email, 'sent'])).rows[0].id as string
  try {
    await sendMail(email, `Test ${pattern.name} on Twinrow`,
      `${ctx.user.name} invited you to test ${pattern.name} on Twinrow.\n\nJoin from this link:\n${config.publicUrl}/invite/${token}\n`)
  } catch (error) {
    await pool.query('DELETE FROM invites WHERE token = $1', [token])
    if (error instanceof MailUnavailable) throw mailUnavailable()
    throw error
  }
  ctx.reply(201, { id, email, status: 'sent' })
})

interface InviteRow { pattern_id: string; email: string; status: string; expired: boolean; pattern_name: string }

async function inviteOf(token: string): Promise<InviteRow> {
  const found = await one<InviteRow>(pool,
    `SELECT i.pattern_id, i.email, i.status, p.name AS pattern_name,
            i.sent_at < now() - ($2 || ' hours')::interval AS expired
     FROM invites i JOIN patterns p ON p.id = i.pattern_id WHERE i.token = $1`, [token, String(config.limits.inviteTtlHours)])
  if (!found) throw notFound()
  return found
}

const stateOf = (invite: InviteRow) => (invite.status === 'accepted' ? 'accepted' : invite.expired ? 'expired' : 'sent')

route('GET', '/api/invites/:token', 'public', async (ctx) => {
  const invite = await inviteOf(ctx.params.token)
  const account = await one(pool, 'SELECT 1 FROM users WHERE email = $1', [invite.email])
  ctx.reply(200, { patternName: invite.pattern_name, hasAccount: !!account, status: stateOf(invite) })
})

route('POST', '/api/invites/:token/accept', 'public', async (ctx) => {
  const invite = await inviteOf(ctx.params.token)
  const body = object(ctx.body())
  const account = await one<{ id: string; name: string; password_hash: string }>(pool,
    'SELECT id, name, password_hash FROM users WHERE email = $1', [invite.email])
  const password = account ? text(body.password) : checkPasswordLength('password', body.password)
  if (!password) throw invalid('password', 'A password needs at least 10 characters.')
  const name = account ? account.name : checkName(body.name)
  const state = stateOf(invite)
  if (state === 'accepted') throw conflict('invite_used', 'This invitation has already been used.')
  if (state === 'expired') throw conflict('invite_expired', 'This invitation has expired. Ask the designer for a new one.')
  if (account && !(await checkPassword(password, account.password_hash))) {
    throw new HttpError(401, { error: 'invalid_credentials', message: 'Email or password is incorrect.' })
  }
  const hash = account ? '' : await hashPassword(password)
  const joined = await transaction(async (db) => {
    const claimed = await db.query('UPDATE invites SET status = $2 WHERE token = $1 AND status = $3', [ctx.params.token, 'accepted', 'sent'])
    if (!claimed.rowCount) throw conflict('invite_used', 'This invitation has already been used.')
    const userId = account?.id ?? (await db.query(
      'INSERT INTO users (email, name, password_hash, verified) VALUES ($1, $2, $3, true) RETURNING id', [invite.email, name, hash])).rows[0].id as string
    const version = await latestVersion(db, invite.pattern_id)
    await db.query('INSERT INTO testers (pattern_id, user_id, version, row) VALUES ($1, $2, $3, 1) ON CONFLICT DO NOTHING', [invite.pattern_id, userId, version])
    return { userId, version }
  })
  await counterSet(invite.pattern_id, joined.userId, 1)
  const entry = (await testerEntries(invite.pattern_id)).find((t) => t.id === joined.userId)!
  void emit(invite.pattern_id, ['designers'], { type: 'tester', tester: entry })
  ctx.reply(200, { patternId: invite.pattern_id }, { 'Set-Cookie': sessionCookie(await openSession(joined.userId)) })
})

route('GET', '/api/patterns/:id/follow', 'user', async (ctx) => {
  const pattern = await testerAccess(pool, ctx.user.id, ctx.params.id)
  const state = await testerState(pattern.id, ctx.user.id)
  const chart = (await loadSnapshot(pool, pattern, state.version))!
  const derived = derive(chart, await noteCounts(pool, pattern.id, { userId: ctx.user.id, version: state.version }))
  const payload: FollowPattern = {
    id: pattern.id, name: pattern.name, craft: chart.craft, mode: chart.mode, terms: chart.terms, castOn: chart.castOn,
    width: chart.width, height: chart.height, colours: chart.colours, repeats: chart.repeats,
    cells: cellsOf(chart, chart.stitch.map((r) => r.map(() => 0))), rows: derived.rows, version: state.version,
    latestVersion: await latestVersion(pool, pattern.id), row: state.row,
  }
  ctx.reply(200, payload)
})

route('POST', '/api/patterns/:id/follow', 'user', async (ctx) => {
  const pattern = await testerAccess(pool, ctx.user.id, ctx.params.id)
  const body = object(ctx.body())
  const latest = await latestVersion(pool, pattern.id)
  if (body.version !== latest) throw invalid('version', 'Only the latest version can be followed.')
  const result = await serial(`counter:${pattern.id}:${ctx.user.id}`, async () => {
    const state = await testerState(pattern.id, ctx.user.id)
    const height = await versionHeight(pattern.id, latest)
    const row = Math.min(state.row, height)
    const movedFrom = state.row > height ? state.row : null
    await pool.query('UPDATE testers SET version = $3, row = $4 WHERE pattern_id = $1 AND user_id = $2', [pattern.id, ctx.user.id, latest, row])
    await counterSet(pattern.id, ctx.user.id, row)
    return { version: latest, row, movedFrom }
  })
  void emit(pattern.id, ['designers', `user:${ctx.user.id}`], { type: 'followed', user: person(ctx.user), ...result })
  ctx.reply(200, result)
})

route('GET', '/api/patterns/:id/counter', 'user', async (ctx) => {
  const pattern = await testerAccess(pool, ctx.user.id, ctx.params.id)
  const state = await testerState(pattern.id, ctx.user.id)
  ctx.reply(200, { row: state.row, version: state.version, total: await versionHeight(pattern.id, state.version) })
})

route('POST', '/api/patterns/:id/counter', 'user', async (ctx) => {
  const pattern = await testerAccess(pool, ctx.user.id, ctx.params.id)
  const body = object(ctx.body())
  const { from, step, stepId } = body
  const row = await serial(`counter:${pattern.id}:${ctx.user.id}`, async () => {
    // A replayed step answers with the current row, whatever else it carries. It is looked up inside the queue, so a replay
    // that arrives while its first step is still moving the row waits for the move instead of reading the old row.
    const known = typeof stepId === 'string' && stepId
      ? await one(pool, 'SELECT 1 FROM counter_steps WHERE pattern_id = $1 AND user_id = $2 AND step_id = $3', [pattern.id, ctx.user.id, stepId])
      : undefined
    if (known) return (await testerState(pattern.id, ctx.user.id)).row
    if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) throw invalid('from', 'from must be a row number.')
    if (step !== 1 && step !== -1) throw invalid('step', 'step must be 1 or -1.')
    if (typeof stepId !== 'string' || !stepId || stepId.length > 200) throw invalid('stepId', 'stepId must be a non-empty string.')
    const fresh = await pool.query('INSERT INTO counter_steps (pattern_id, user_id, step_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [pattern.id, ctx.user.id, stepId])
    const state = await testerState(pattern.id, ctx.user.id)
    if (!fresh.rowCount) return state.row
    const total = await versionHeight(pattern.id, state.version)
    let next = await counterStep(pattern.id, ctx.user.id, from, step, total, state.row)
    if (next === null) next = from === state.row && state.row + step >= 1 && state.row + step <= total ? state.row + step : state.row
    if (next !== state.row) {
      await pool.query('UPDATE testers SET row = $3 WHERE pattern_id = $1 AND user_id = $2 AND row = $4', [pattern.id, ctx.user.id, next, state.row])
      void emit(pattern.id, ['designers', `user:${ctx.user.id}`], { type: 'counter', user: person(ctx.user), version: state.version, row: next })
    }
    return next
  })
  ctx.reply(200, { row })
})

route('POST', '/api/patterns/:id/notes', 'user', async (ctx) => {
  const pattern = await testerAccess(pool, ctx.user.id, ctx.params.id)
  const body = object(ctx.body())
  const state = await testerState(pattern.id, ctx.user.id)
  const height = await versionHeight(pattern.id, state.version)
  if (typeof body.row !== 'number' || !Number.isInteger(body.row) || body.row < 1 || body.row > height) throw invalid('row', 'That row is not in this version.')
  const note = text(body.text)
  if (!note.trim()) throw invalid('text', 'Write a note first.')
  if ([...note].length > config.limits.noteMaxChars) throw invalid('text', `A note can be ${config.limits.noteMaxChars} characters at most.`)
  const id = (await pool.query('INSERT INTO notes (pattern_id, user_id, version, row, text) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [pattern.id, ctx.user.id, state.version, body.row, note])).rows[0].id as number
  const count = async (where: string, ...params: unknown[]) =>
    (await one<{ n: number }>(pool, `SELECT count(*)::int AS n FROM notes WHERE pattern_id = $1 ${where}`, [pattern.id, ...params]))!.n
  void emit(pattern.id, ['designers', `user:${ctx.user.id}`], {
    type: 'note', user: person(ctx.user), row: body.row, text: note, version: state.version,
    rowNotes: await count('AND row = $2', body.row), testerNotes: await count('AND user_id = $2', ctx.user.id),
    ownRowNotes: await count('AND user_id = $2 AND version = $3 AND row = $4', ctx.user.id, state.version, body.row),
  })
  const owner = (await one<{ email: string }>(pool, 'SELECT email FROM users WHERE id = $1', [pattern.owner_id]))!
  await sendMail(owner.email, `Note on row ${body.row} of ${pattern.name}`, note).catch(() => undefined)
  ctx.reply(201, { id, row: body.row, text: note, version: state.version })
})

route('GET', '/api/patterns/:id/notes', 'user', async (ctx) => {
  const access = await accessOf(pool, ctx.user.id, ctx.params.id)
  if (!access) throw notFound()
  const found = access.role === 'tester'
    ? await rows<NoteEntry>(pool,
      `SELECT n.row, n.text, u.name AS tester, n.version FROM notes n JOIN users u ON u.id = n.user_id
       JOIN testers t ON t.pattern_id = n.pattern_id AND t.user_id = n.user_id AND t.version = n.version
       WHERE n.pattern_id = $1 AND n.user_id = $2 ORDER BY n.row, n.id`, [access.pattern.id, ctx.user.id])
    : await rows<NoteEntry>(pool,
      `SELECT n.row, n.text, u.name AS tester, n.version FROM notes n JOIN users u ON u.id = n.user_id
       WHERE n.pattern_id = $1 ORDER BY n.row, n.id`, [access.pattern.id])
  ctx.reply(200, { notes: found })
})
