import { config } from './config.js'

// Tiny id generator: prefixed, opaque, safe for a clustered environment.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function id(prefix: string, size = 12): string {
  let body = ''
  for (let i = 0; i < size; i++) {
    body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return `${prefix}_${body}`
}

export function randomToken(): string {
  let token = ''
  for (let i = 0; i < 24; i++) {
    token += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return token
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function classCode(): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

export function instanceName(): string {
  return config.instanceName
}
