import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAlerts } from '../alerts.tsx'
import { useAnnounce } from '../announce.tsx'
import { boot } from '../boot.ts'
import { ProjectStore } from '../project/store.ts'
import { Workspace } from '../project/Workspace.tsx'
import { useSession } from '../session.tsx'
import { NotFound } from './NotFound.tsx'

type StudioProps = { projectId: string } | { linkToken: string }

/** The editor screen of a project, or the read-only screen of a view link. */
export function Studio(props: StudioProps) {
  const { user } = useSession()
  const { say } = useAnnounce()
  const { raise } = useAlerts()
  const key = 'projectId' in props ? `project:${props.projectId}` : `link:${props.linkToken}`
  const hooks = { say, raise, parseDelayMs: boot.parseDelayMs, self: user }
  const store = useMemo(
    () => new ProjectStore('projectId' in props ? { kind: 'project', id: props.projectId } : { kind: 'link', token: props.linkToken }, hooks),
    // A new store only when the address changes; the hooks are refreshed on every render below.
    [key],
  )
  store.hooks = hooks
  useEffect(() => {
    void store.start()
    return () => store.dispose()
  }, [store])
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (snap.phase === 'missing') return <NotFound />
  return <Workspace store={store} source={'projectId' in props ? { projectId: props.projectId } : { linkToken: props.linkToken }} selfId={user?.id} />
}
