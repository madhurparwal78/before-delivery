import { useEffect, useState } from 'react'
import type { ProjectJson } from '../../shared/domain.ts'
import { api, ApiFailure } from '../api.ts'
import { useNavigation } from '../router.tsx'
import { useSession } from '../session.tsx'
import { NotFound } from './NotFound.tsx'
import { SignInForm } from './SignIn.tsx'
import { Studio } from './Studio.tsx'

type Share = { kind: 'view' } | { kind: 'edit'; projectName: string } | { kind: 'missing' } | null

/** `/s/<token>`: a view link opens the read-only editor; an edit link asks you to sign in, then joins you. */
export function SharedPage({ token }: { token: string }) {
  const { user } = useSession()
  const { navigate } = useNavigation()
  const [share, setShare] = useState<Share>(null)

  useEffect(() => {
    api<ProjectJson | { access: 'edit'; projectName: string }>('GET', `/api/shared/${token}`).then(
      (answer) => setShare('access' in answer ? { kind: 'edit', projectName: answer.projectName } : { kind: 'view' }),
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setShare({ kind: 'missing' })
      },
    )
  }, [token])

  const joining = share?.kind === 'edit' && Boolean(user)
  useEffect(() => {
    if (!joining) return
    api<{ projectId: string }>('POST', `/api/shared/${token}/join`).then(
      (joined) => navigate(`/projects/${joined.projectId}`),
      () => setShare({ kind: 'missing' }),
    )
  }, [joining, token, navigate])

  if (!share) return <p className="loading">Loading...</p>
  if (share.kind === 'missing') return <NotFound />
  if (share.kind === 'view') return <Studio linkToken={token} />
  if (user === undefined || user) return <p className="loading">Loading...</p>
  return (
    <div className="signin-wrap">
      <SignInForm heading={`Sign in to edit ${share.projectName}`} />
    </div>
  )
}
