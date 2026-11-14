import { Pencil, Plus } from 'lucide-react'
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import type { ProjectJson, ProjectSummary } from '../../shared/domain.ts'
import { TEMPLATES } from '../../shared/templates.ts'
import { api, ApiFailure, fieldErrors } from '../api.ts'
import { useAnnounce, StatusRegion } from '../announce.tsx'
import { businessTime } from '../format.ts'
import { Link } from '../router.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { FieldError, FormErrors } from '../ui/FormErrors.tsx'

interface Listing {
  owned: ProjectSummary[]
  shared: ProjectSummary[]
}

const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' } as const

function entityCount(count: number): string {
  return `${count} ${count === 1 ? 'entity' : 'entities'}`
}

function ProjectCard({ project, onRename }: { project: ProjectSummary; onRename: (project: ProjectSummary) => void }) {
  return (
    <li className="project-card">
      <div className="project-card-head">
        <Link href={`/projects/${project.id}`} className="project-name">
          {project.name}
        </Link>
        <span className="badge">{ROLE_LABEL[project.role]}</span>
      </div>
      <p className="project-meta">
        {entityCount(project.entityCount)} · <time dateTime={project.updatedAt}>{businessTime(project.updatedAt)}</time>
      </p>
      {project.role !== 'viewer' && (
        <button type="button" className="btn btn-quiet project-rename" aria-label={`Rename ${project.name}`} onClick={() => onRename(project)}>
          <Pencil size={16} aria-hidden="true" />
          Rename
        </button>
      )}
    </li>
  )
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (project: ProjectJson) => void }) {
  const base = useId()
  const ids = { name: `${base}-name`, templateId: `${base}-template` }
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const { say } = useAnnounce()

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setErrors({})
    setFailure('')
    say('studio', 'Creating project...')
    try {
      const project = await api<ProjectJson>('POST', '/api/projects', templateId ? { name, templateId } : { name })
      onCreated(project)
    } catch (error) {
      say('studio', '')
      setErrors(fieldErrors(error))
      if (error instanceof ApiFailure && error.status !== 422) setFailure(error.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog name="New project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FormErrors errors={errors} ids={ids} />
        {failure && (
          <div role="alert" className="notice">
            {failure}
          </div>
        )}
        <div className="field">
          <label htmlFor={ids.name}>Project name</label>
          <input
            id={ids.name}
            className="input"
            value={name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${ids.name}-error` : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError id={`${ids.name}-error`} message={errors.name} />
        </div>
        <div className="field">
          <label htmlFor={ids.templateId}>Start from</label>
          <select
            id={ids.templateId}
            className="input"
            value={templateId}
            aria-invalid={errors.templateId ? true : undefined}
            aria-describedby={errors.templateId ? `${ids.templateId}-error` : undefined}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">Empty</option>
            {TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <FieldError id={`${ids.templateId}-error`} message={errors.templateId} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Creating project...' : 'Create project'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function RenameProjectDialog({ project, onClose, onRenamed }: { project: ProjectSummary; onClose: () => void; onRenamed: (project: ProjectJson) => void }) {
  const nameId = useId()
  const [name, setName] = useState(project.name)
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setErrors({})
    setFailure('')
    try {
      onRenamed(await api<ProjectJson>('PATCH', `/api/projects/${project.id}`, { name }))
    } catch (error) {
      setErrors(fieldErrors(error))
      if (error instanceof ApiFailure && error.status !== 422) setFailure(error.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog name="Rename project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FormErrors errors={errors} ids={{ name: nameId }} />
        {failure && (
          <div role="alert" className="notice">
            {failure}
          </div>
        )}
        <div className="field">
          <label htmlFor={nameId}>Project name</label>
          <input
            id={nameId}
            className="input"
            value={name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError id={`${nameId}-error`} message={errors.name} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving name...' : 'Save name'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function Dashboard() {
  const [listing, setListing] = useState<Listing | null>(null)
  const [failure, setFailure] = useState('')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null)
  const { say } = useAnnounce()

  const load = useCallback(async (): Promise<void> => {
    try {
      setListing(await api<Listing>('GET', '/api/projects'))
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message : 'The projects could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (failure) {
    return (
      <div role="alert" className="notice">
        {failure}
      </div>
    )
  }
  if (!listing) return <p className="loading">Loading...</p>

  return (
    <div className="dashboard">
      <section aria-labelledby="owned-heading" className="dash-section">
        <div className="section-head">
          <h1 id="owned-heading">Your projects</h1>
          <button type="button" className="btn btn-primary btn-compact" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            New project
          </button>
        </div>
        <StatusRegion region="studio" className="page-status" />
        {listing.owned.length ? (
          <ul aria-label="Projects" role="list" className="project-grid">
            {listing.owned.map((project) => (
              <ProjectCard key={project.id} project={project} onRename={setRenaming} />
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <span className="empty-badge" aria-hidden="true">
              <svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="8" width="13" height="10" rx="2" />
                <rect x="22" y="22" width="13" height="10" rx="2" />
                <path d="M18 13h6a3 3 0 0 1 3 3v6" />
              </svg>
            </span>
            <h2>No projects yet</h2>
            <p>Start a schema from scratch or from a starter template.</p>
            <p>Projects people share with you show up here too.</p>
            <button type="button" className="btn btn-plus" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" />
              Create your first project
            </button>
          </div>
        )}
      </section>
      <section aria-labelledby="shared-heading" className="dash-section">
        <div className="section-head">
          <h2 id="shared-heading">Shared with you</h2>
        </div>
        {listing.shared.length ? (
          <ul aria-label="Shared projects" role="list" className="project-grid">
            {listing.shared.map((project) => (
              <ProjectCard key={project.id} project={project} onRename={setRenaming} />
            ))}
          </ul>
        ) : (
          <p className="hint">Nothing shared with you yet.</p>
        )}
      </section>
      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            setCreating(false)
            say('studio', `Project ${project.name} created.`)
            void load()
          }}
        />
      )}
      {renaming && (
        <RenameProjectDialog
          project={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(project) => {
            setRenaming(null)
            say('studio', `Project renamed to ${project.name}.`)
            void load()
          }}
        />
      )}
    </div>
  )
}
