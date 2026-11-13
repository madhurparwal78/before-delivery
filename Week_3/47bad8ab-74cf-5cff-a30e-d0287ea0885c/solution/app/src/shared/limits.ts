import { characterCount, hasControlCharacter } from './text.ts'

export const integerOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null)

const NAME_MAX = 24
const TITLE_MAX = 80
const AUTHOR_MAX = 60
export const CLUE_MAX = 300
export const REBUS_MAX = 8
export const MIN_GRID = 3
export const CLIENT_OP_ID_MAX = 64

/** One square entry: 1 to 8 letters or digits, either case. */
export const isEntry = (value: string): boolean => /^[A-Za-z0-9]+$/.test(value) && value.length <= REBUS_MAX

export const isDisplayName = (name: string): boolean => characterCount(name) >= 1 && characterCount(name) <= NAME_MAX && !hasControlCharacter(name)

export const titleProblem = (title: string): string | null => (characterCount(title) >= 1 && characterCount(title) <= TITLE_MAX ? null : `Title must be 1 to ${TITLE_MAX} characters`)

export const authorProblem = (author: string): string | null => (characterCount(author) >= 1 && characterCount(author) <= AUTHOR_MAX ? null : `Author must be 1 to ${AUTHOR_MAX} characters`)

export const clueTooLong = (text: string): boolean => characterCount(text) > CLUE_MAX
