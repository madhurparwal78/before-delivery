import { compileRoutes, type Route } from '../http/pipeline'
import { authRoutes } from './auth'
import { layoutRoutes } from './layouts'
import { opsRoutes } from './ops'
import { sessionRoutes } from './sessions'
import { versionRoutes } from './versions'
import { workspaceRoutes } from './workspaces'

const all: Route[] = [...authRoutes, ...workspaceRoutes, ...layoutRoutes, ...versionRoutes, ...sessionRoutes, ...opsRoutes]

export const routes = compileRoutes(all)
