import { formatBusinessTime } from '../shared/time.ts'
import { boot } from './boot.ts'

export const businessTime = (iso: string): string => formatBusinessTime(iso, boot.timeZone)
