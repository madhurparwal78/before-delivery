import { ChevronDown, FileDown, FileUp, Group, History, Keyboard, LayoutGrid, PanelLeft, Palette, Save, Share2, Ungroup } from 'lucide-react'
import type { ReactNode } from 'react'

interface ChipProps {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  expanded?: boolean
  pressed?: boolean
  menu?: boolean
}

function Chip({ label, icon, onClick, disabled, expanded, pressed, menu }: ChipProps) {
  return (
    <button
      type="button"
      className="chip"
      aria-label={label}
      disabled={disabled}
      aria-expanded={expanded}
      aria-pressed={pressed}
      aria-haspopup={menu ? 'menu' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {expanded !== undefined || menu ? <ChevronDown size={12} aria-hidden="true" className="chip-caret" /> : null}
    </button>
  )
}

interface ToolbarActions {
  share: () => void
  versions: () => void
  save: () => void
  import: () => void
  export: () => void
  arrange: () => void
  group: () => void
  ungroup: () => void
  colour: () => void
  help: () => void
  templates: () => void
}

interface ToolbarProps {
  owner: boolean
  canEdit: boolean
  exportOpen: boolean
  templatesOpen: boolean
  colourOpen: boolean
  canGroup: boolean
  canUngroup: boolean
  actions: ToolbarActions
  colourMenu: ReactNode
  right: ReactNode
}

/** The dark editor strip: edit chips for people who can edit, only Versions and Keyboard help for everyone else. */
export function Toolbar({ owner, canEdit, exportOpen, templatesOpen, colourOpen, canGroup, canUngroup, actions, colourMenu, right }: ToolbarProps) {
  const icon = (Icon: typeof Save) => <Icon size={14} aria-hidden="true" />
  return (
    <div className="toolbar-strip dark">
      <div role="toolbar" aria-label="Editor tools" className="toolbar">
        <div className="toolbar-chips">
        {owner && canEdit ? <Chip label="Share" icon={icon(Share2)} onClick={actions.share} /> : null}
        <Chip label="Versions" icon={icon(History)} onClick={actions.versions} />
        {canEdit ? (
          <>
            <Chip label="Save version" icon={icon(Save)} onClick={actions.save} />
            <Chip label="Import" icon={icon(FileUp)} onClick={actions.import} />
            <Chip label="Export" icon={icon(FileDown)} onClick={actions.export} expanded={exportOpen} />
            <Chip label="Arrange" icon={icon(LayoutGrid)} onClick={actions.arrange} />
            <Chip label="Group selected" icon={icon(Group)} onClick={actions.group} disabled={!canGroup} />
            <Chip label="Ungroup" icon={icon(Ungroup)} onClick={actions.ungroup} disabled={!canUngroup} />
            <span className="chip-anchor">
              <Chip label="Colour" icon={icon(Palette)} onClick={actions.colour} expanded={colourOpen} menu />
              {colourMenu}
            </span>
          </>
        ) : null}
        <Chip label="Keyboard help" icon={icon(Keyboard)} onClick={actions.help} />
        </div>
        <div className="toolbar-right">{right}</div>
        {canEdit ? (
          <button type="button" className="pill-templates" aria-pressed={templatesOpen} onClick={actions.templates}>
            <PanelLeft size={14} aria-hidden="true" />
            <span>Templates</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

