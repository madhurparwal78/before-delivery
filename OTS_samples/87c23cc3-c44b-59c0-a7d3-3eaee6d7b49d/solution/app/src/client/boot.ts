import type { ServiceStatus, UserJson } from '../shared/domain.ts'

interface Boot {
  parseDelayMs: number
  timeZone: string
  notFound: boolean
  /** The person the page was opened as, or null when signed out. */
  user: UserJson | null
  /** What the three services answered when the page was served; the strip refreshes it. */
  status: ServiceStatus | null
}

export const boot: Boot = JSON.parse(document.getElementById('boot')?.textContent ?? '{"parseDelayMs":150,"timeZone":"UTC","notFound":false,"user":null,"status":null}')
