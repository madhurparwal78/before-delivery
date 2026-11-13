const HOUR_SECONDS = 3600

/** The one time format: whole seconds, `m:ss` under an hour, `h:mm:ss` from an hour. */
export function formatTime(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000)
  const two = (value: number): string => String(value).padStart(2, '0')
  if (seconds < HOUR_SECONDS) return `${Math.floor(seconds / 60)}:${two(seconds % 60)}`
  return `${Math.floor(seconds / HOUR_SECONDS)}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`
}

export function revealedPhrase(count: number): string {
  return count === 1 ? 'Revealed 1 square' : `Revealed ${count} squares`
}

export function squaresPhrase(count: number): string {
  return count === 1 ? '1 square' : `${count} squares`
}
