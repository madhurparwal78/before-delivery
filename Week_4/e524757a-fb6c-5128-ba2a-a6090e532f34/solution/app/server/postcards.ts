/** Postcards: a stored photo, a line, and one message to someone with no account. It is posted only after Mailpit accepted it. */
import { randomUUID } from 'node:crypto'
import { config } from './config'
import { one, pool, transaction } from './db'
import { ApiError } from './errors'
import { route } from './http'
import { MailError, sendMail } from './mail'
import { ownPhoto, readStoredImage, toPhoto } from './photos'
import type { PlayerRow } from './players'
import { assertUnused, lookUp, remember } from './request-keys'
import { inTurn } from './turns'
import { EMAIL, isBlank, isText, lengthOf } from './validate'
import { creatureById, islandById } from '../shared/island'
import type { PostcardPublic } from '../shared/types'

const LINE_LIMIT = 140

async function assertWithinLimit(me: PlayerRow): Promise<void> {
  const window = await one<{ sent: number; retry: number }>(
    pool,
    `SELECT COUNT(*)::int AS sent, COALESCE(CEIL(EXTRACT(EPOCH FROM MIN(posted_at) + make_interval(secs => $2) - now())), 0)::int AS retry
     FROM postcards WHERE player_id = $1 AND posted_at > now() - make_interval(secs => $2)`,
    [me.id, config.postcardWindowSeconds],
  )
  if (window && window.sent >= config.postcardLimit) throw new ApiError('postcard_limit', String(config.postcardLimit), { 'Retry-After': String(Math.max(1, window.retry)) })
}

route('POST', '/api/postcards', 'required', async (c) => {
  const me = c.player as PlayerRow
  const body = await c.json()
  return inTurn(`postcard:${me.id}`, async () => {
    const state = await lookUp(me.id, 'postcard', c, body)
    if (state.replay) return state.replay
    const photo = await ownPhoto(pool, body.photo, me.id)
    if (!me.confirmed) throw new ApiError('unconfirmed')
    assertUnused(state)
    const recipient = isText(body.recipient) ? body.recipient.trim() : ''
    const line = isText(body.line) ? body.line : ''
    if (!EMAIL.test(recipient)) throw new ApiError('bad_email')
    if (isBlank(line)) throw new ApiError('line_empty')
    if (lengthOf(line) > LINE_LIMIT) throw new ApiError('line_too_long')
    await assertWithinLimit(me)
    const image = await readStoredImage(photo, 'postcard')
    const id = randomUUID()
    const url = `${config.publicUrl}/postcards/${id}`
    const { creature_name, score, island } = toPhoto(photo)
    await sendMail({
      to: recipient,
      subject: `A postcard from ${me.name} on ${(islandById(island) as NonNullable<ReturnType<typeof islandById>>).name}`,
      text: `${line}\n\n${creature_name}, ${score.total} points\n${url}\n`,
      attachment: { filename: `postcard.${photo.image_key.split('.').pop()}`, content: image },
    }).catch((error: unknown) => {
      if (error instanceof MailError) throw new ApiError('mail_unavailable', 'postcard')
      throw error
    })
    // Posted only once Mailpit accepted the message: the postcard row and its request key commit together, after the send.
    const answer = { status: 201, body: { postcard: { id, url, status: 'posted' } } }
    await transaction(async (client) => {
      await client.query('INSERT INTO postcards (id, player_id, photo_id, recipient, line) VALUES ($1, $2, $3, $4, $5)', [id, me.id, photo.id, recipient, line])
      await remember(client, me.id, 'postcard', state, answer)
    })
    return answer
  })
})

route('GET', '/api/postcards/:id', 'none', async (c) => {
  const card = await one<{ id: string; photo_id: string; line: string; sender_name: string; creature_id: string; island: number; total: number }>(
    pool,
    `SELECT c.id, c.photo_id, c.line, s.name AS sender_name, p.creature_id, p.island, p.total
     FROM postcards c JOIN players s ON s.id = c.player_id JOIN photos p ON p.id = c.photo_id WHERE c.id = $1`,
    [c.params[0]],
  )
  if (!card) throw new ApiError('not_found')
  const postcard: PostcardPublic = {
    id: card.id, image_url: `/api/photos/${card.photo_id}/image`, creature_name: (creatureById(card.creature_id) as NonNullable<ReturnType<typeof creatureById>>).name, total: card.total,
    island_name: (islandById(card.island) as NonNullable<ReturnType<typeof islandById>>).name, line: card.line, sender_name: card.sender_name,
  }
  return { status: 200, body: { postcard } }
})
