import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { appendStarterEntity } from '../../shared/canonical.ts'
import { groupOf } from '../../shared/diagram.ts'
import { findEntity, parseMortise } from '../../shared/mortise.ts'
import type { Template } from '../../shared/templates.ts'
import { ApiFailure } from '../api.ts'
import { StatusRegion, useAnnounce } from '../announce.tsx'
import { Diagram, type DiagramActions } from '../diagram/Diagram.tsx'
import { ExportPanel } from '../dialogs/ExportPanel.tsx'
import { EntitySheet } from '../dialogs/EntitySheet.tsx'
import { GroupDialog } from '../dialogs/GroupDialog.tsx'
import { ImportDialog } from '../dialogs/ImportDialog.tsx'
import { KeyboardHelpDialog } from '../dialogs/KeyboardHelpDialog.tsx'
import { RenameDialog } from '../dialogs/RenameDialog.tsx'
import { SaveVersionDialog } from '../dialogs/SaveVersionDialog.tsx'
import { ShareDialog } from '../dialogs/ShareDialog.tsx'
import { TemplatesPanel } from '../dialogs/TemplatesPanel.tsx'
import { VersionsDialog } from '../dialogs/VersionsDialog.tsx'
import { AlertStack } from '../ui/AlertStack.tsx'
import { CodeEditor } from './CodeEditor.tsx'
import { ColourMenu } from './ColourMenu.tsx'
import { EmptyCanvas, ErrorArea, StaleBanner, offsetOf } from './panes.tsx'
import type { ProjectStore } from './store.ts'
import { Toolbar } from './Toolbar.tsx'

type Dialog =
  | { kind: 'share' | 'versions' | 'save' | 'import' | 'keys' | 'group' }
  | { kind: 'rename' | 'entity'; name: string }

interface WorkspaceProps {
  store: ProjectStore
  /** The project id, or the link token of a read-only visit. */
  source: { projectId: string } | { linkToken: string }
  selfId: string | undefined
}

const SAVE_COPY = { saved: 'All changes saved', saving: 'Saving...', retrying: 'Changes not saved yet. Retrying...' } as const

const focusColourChip = (): void => document.querySelector<HTMLElement>('.chip-anchor > button')?.focus()

function failureMessage(error: unknown): string {
  if (!(error instanceof ApiFailure)) return 'Something went wrong. Try again.'
  const fields = error.body.fields
  return fields ? (Object.values(fields)[0] ?? error.body.message) : error.body.message
}

/** The editor and diagram workspace of a project: toolbar, text pane, diagram, panels and dialogs. */
export function Workspace({ store, source, selfId }: WorkspaceProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { say } = useAnnounce()
  const linkVisit = 'linkToken' in source
  const [tab, setTab] = useState<'text' | 'diagram'>(linkVisit ? 'diagram' : 'text')
  const [selection, setSelection] = useState<string[]>([])
  const [focused, setFocused] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [colourOpen, setColourOpen] = useState(false)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])

  const model = snap.model
  const owner = snap.role === 'owner'
  const canEdit = snap.canEdit
  const hasErrors = snap.errors.length > 0

  useEffect(() => {
    setTab(snap.role === 'viewer' || linkVisit ? 'diagram' : 'text')
  }, [snap.role, linkVisit])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (canEdit && !document.querySelector('dialog[open]')) setDialog({ kind: 'save' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [canEdit])

  useEffect(() => {
    setSelection((current) => current.filter((name) => model && findEntity(model, name)))
  }, [model])

  const grouped = (name: string): boolean => model !== null && groupOf(model, name) !== null
  const canGroup = selection.length > 0 && !selection.some(grouped)
  const colourTargets = selection.length ? selection : focused ? [focused] : []
  const ungroupTarget = (selection.length ? selection : focused ? [focused] : []).find(grouped)

  const closeDialog = (): void => setDialog(null)

  const actions: DiagramActions = {
    move: (name, x, y) => store.moveEntity(name, x, y),
    drawLink: (from, to) => void store.drawLink(from, to),
    openDetails: (name) => setDialog({ kind: 'entity', name }),
    openRename: (name) => setDialog({ kind: 'rename', name }),
    openGroup: () => {
      if (canEdit && canGroup) setDialog({ kind: 'group' })
    },
    say: (text) => say('diagram', text),
  }

  const refuse = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work()
    } catch (error) {
      say('diagram', failureMessage(error))
      throw error
    }
  }

  const ungroup = (): void => {
    const name = ungroupTarget && model ? groupOf(model, ungroupTarget) : null
    if (name) void store.removeGroup(name).catch((error: unknown) => say('diagram', failureMessage(error)))
  }

  const addEntity = (): void => {
    store.typed(appendStarterEntity(snap.text, parseMortise(snap.text).model))
  }

  const apply = (template: Template): void => {
    store.typed(template.text)
    say('studio', `Started from ${template.name}.`)
  }

  const colourCurrent = useMemo(() => {
    const colours = new Set(colourTargets.map((name) => snap.layout.entities[name]?.color))
    return colours.size === 1 ? ([...colours][0] ?? null) : null
  }, [colourTargets, snap.layout])

  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    tabs.current[(index + 1) % 2]?.focus()
  }

  if (snap.phase === 'loading') return <p className="workspace-loading">Loading...</p>

  const people = snap.people
  const dialogBase = linkVisit ? `/api/shared/${(source as { linkToken: string }).linkToken}` : `/api/projects/${(source as { projectId: string }).projectId}`
  const projectId = linkVisit ? '' : (source as { projectId: string }).projectId
  const entityDialog = dialog && (dialog.kind === 'entity' || dialog.kind === 'rename') && model ? findEntity(model, dialog.name) : undefined

  return (
    <div className="workspace" data-variant={linkVisit ? 'link' : 'project'}>
      <Toolbar
        owner={owner}
        canEdit={canEdit}
        exportOpen={exportOpen}
        templatesOpen={templatesOpen}
        colourOpen={colourOpen}
        canGroup={canGroup}
        canUngroup={ungroupTarget !== undefined}
        actions={{
          share: () => setDialog({ kind: 'share' }),
          versions: () => setDialog({ kind: 'versions' }),
          save: () => setDialog({ kind: 'save' }),
          import: () => setDialog({ kind: 'import' }),
          export: () => setExportOpen((open) => !open),
          arrange: () => void store.arrange().catch((error: unknown) => say('diagram', failureMessage(error))),
          group: () => setDialog({ kind: 'group' }),
          ungroup,
          colour: () => setColourOpen((open) => !open),
          help: () => setDialog({ kind: 'keys' }),
          templates: () => setTemplatesOpen((open) => !open),
        }}
        colourMenu={
          colourOpen ? (
            <ColourMenu
              current={colourCurrent}
              onChoose={(color) => {
                store.setColors(colourTargets, color)
                setColourOpen(false)
                focusColourChip()
              }}
              onClose={() => {
                setColourOpen(false)
                focusColourChip()
              }}
            />
          ) : null
        }
        right={
          <>
            <ul aria-label="People here" className="presence">
              {people.map((person) => (
                <li key={person.userId} className="presence-chip">
                  <span className="avatar" aria-hidden="true" data-initial={person.displayName.slice(0, 1).toUpperCase()} />
                  {person.userId === selfId ? `${person.displayName} (you)` : person.displayName}
                </li>
              ))}
              {snap.linkViewers ? <li className="presence-chip">{snap.linkViewers === 1 ? '1 link viewer' : `${snap.linkViewers} link viewers`}</li> : null}
            </ul>
            {canEdit ? (
              <span role="status" aria-label="Save state" className="save-state" data-state={snap.saveState}>
                {SAVE_COPY[snap.saveState]}
              </span>
            ) : null}
          </>
        }
      />
      <div className="project-bar">
        <h1>{snap.name}</h1>
        {canEdit ? null : <span className="badge view-only">View only</span>}
      </div>
      <AlertStack />
      <div role="tablist" aria-label="Workspace" className="workspace-tabs">
        {(['text', 'diagram'] as const).map((which, index) => (
          <button
            key={which}
            ref={(element) => {
              tabs.current[index] = element
            }}
            type="button"
            role="tab"
            id={`tab-${which}`}
            aria-selected={tab === which}
            tabIndex={tab === which ? 0 : -1}
            onClick={() => setTab(which)}
            onKeyDown={(event) => tabKey(event, index)}
          >
            {which === 'text' ? 'Text' : 'Diagram'}
          </button>
        ))}
      </div>
      <div className="panes" data-templates={templatesOpen && canEdit} data-export={exportOpen}>
        <div className="text-pane" data-tab="text" data-active={tab === 'text'}>
          <CodeEditor
            label="Schema text"
            text={snap.text}
            readOnly={!canEdit || snap.typing}
            errors={snap.errors}
            onChange={(text) => store.typed(text)}
            caret={snap.caret}
          />
        </div>
        <div className="diagram-wrap" data-tab="diagram" data-active={tab === 'diagram'}>
          <StaleBanner snap={snap} />
          <Diagram
            label="Diagram"
            model={model}
            layout={snap.layout}
            canEdit={canEdit}
            layoutCause={snap.layoutCause}
            selection={selection}
            onSelection={setSelection}
            onFocusEntity={setFocused}
            actions={actions}
          />
          {!model || model.entities.length === 0 ? <EmptyCanvas canEdit={canEdit} onAdd={addEntity} /> : null}
        </div>
        <ErrorArea
          errors={snap.errors}
          active={tab === 'text'}
          onPick={(error) => {
            const at = offsetOf(snap.text, error.line, error.column)
            store.requestCaret(at, at, true)
          }}
        />
        {exportOpen && canEdit && !linkVisit ? (
          <div className="dock-export">
            <ExportPanel projectId={projectId} model={model} hasErrors={hasErrors} onClose={() => setExportOpen(false)} />
          </div>
        ) : null}
        {templatesOpen && canEdit ? (
          <div className="dock-templates">
            <TemplatesPanel canEdit={canEdit} hasText={snap.text.trim() !== ''} onApply={apply} onClose={() => setTemplatesOpen(false)} />
          </div>
        ) : null}
      </div>
      <div className="status-bar dark">
        <StatusRegion region="editor" />
        <StatusRegion region="diagram" />
        <StatusRegion region="studio" />
      </div>
      {dialog?.kind === 'save' ? <SaveVersionDialog projectId={projectId} onClose={closeDialog} /> : null}
      {dialog?.kind === 'versions' ? (
        <VersionsDialog base={dialogBase} canRestore={canEdit} onClose={closeDialog} onRestored={(project) => store.adopt(project)} />
      ) : null}
      {dialog?.kind === 'share' && owner ? <ShareDialog projectId={projectId} onClose={closeDialog} /> : null}
      {dialog?.kind === 'import' ? (
        <ImportDialog projectId={projectId} getRevision={() => store.revision} onClose={closeDialog} onImported={() => void store.reload()} />
      ) : null}
      {dialog?.kind === 'keys' ? <KeyboardHelpDialog onClose={closeDialog} /> : null}
      {dialog?.kind === 'group' ? (
        <GroupDialog
          names={selection}
          onSubmit={(name, color) => refuse(() => store.createGroup(name, selection, color))}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'rename' && entityDialog ? (
        <RenameDialog
          current={entityDialog.name}
          onSubmit={(name) => refuse(() => store.renameEntity(entityDialog.name, name))}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'entity' && entityDialog && model ? (
        <EntitySheet
          model={model}
          entity={entityDialog}
          canEdit={canEdit}
          onRename={() => setDialog({ kind: 'rename', name: entityDialog.name })}
          onClose={closeDialog}
        />
      ) : null}
    </div>
  )
}
