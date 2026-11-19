import type { Role } from './domain'

// Who may do what, decided once for the server's checks and the browser's controls.

export const BUILDERS: Role[] = ['founder', 'manager', 'member']
export const MANAGERS: Role[] = ['founder', 'manager']
export const RUNNERS: Role[] = ['founder', 'manager', 'operator']
export const EVERYONE: Role[] = ['founder', 'manager', 'member', 'operator']

export const canBuild = (role: Role | null): boolean => role !== null && BUILDERS.includes(role)
export const canManage = (role: Role | null): boolean => role !== null && MANAGERS.includes(role)
export const canRun = (role: Role | null): boolean => role !== null && RUNNERS.includes(role)
