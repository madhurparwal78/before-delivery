import { formatError, parseMortise } from '../shared/mortise.ts'
import { config } from './config.ts'
import { FIELD, invalid, textTooLarge } from './errors.ts'
import { jsonBody, route, type Route } from './http.ts'
import { byteLength } from './projects.ts'

export const routes: Route[] = [
  route('POST', '/api/check', async (context) => {
    const text = jsonBody(context).text
    if (typeof text !== 'string') throw invalid({ text: FIELD.text })
    if (byteLength(text) > config.limits.textLimitBytes) throw textTooLarge()
    const { errors } = parseMortise(text, config.limits)
    return { status: 200, body: { valid: errors.length === 0, errorCount: errors.length, errors: errors.map(formatError) } }
  }),
]
