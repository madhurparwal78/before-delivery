interface Shortcut {
  keys: string
  effect: string
  area: 'Text editor' | 'Diagram' | 'Linking'
}

export const SHORTCUTS: readonly Shortcut[] = [
  { area: 'Text editor', keys: 'Tab', effect: 'Insert two spaces at the caret' },
  { area: 'Text editor', keys: 'Shift+Tab', effect: 'Remove up to two leading spaces from each selected line' },
  { area: 'Text editor', keys: 'Escape', effect: 'Release the editor: the next Tab moves to the diagram, Shift+Tab to the toolbar' },
  { area: 'Text editor', keys: 'Ctrl+S or Cmd+S', effect: 'Open Save version from anywhere on the editor screen' },
  { area: 'Diagram', keys: 'Tab / Shift+Tab', effect: 'Next or previous entity in text order' },
  { area: 'Diagram', keys: 'Arrow keys on an entity', effect: 'Move it one grid step (Shift: five steps)' },
  { area: 'Diagram', keys: 'Arrow keys on the diagram', effect: 'Pan by two grid steps' },
  { area: 'Diagram', keys: 'Space', effect: 'Select or deselect the focused entity' },
  { area: 'Diagram', keys: 'Enter', effect: "Enter the entity's columns" },
  { area: 'Diagram', keys: 'Up / Down', effect: 'Previous or next column' },
  { area: 'Diagram', keys: 'Escape', effect: 'Leave the columns; again to clear the selection' },
  { area: 'Diagram', keys: 'I', effect: 'Open the entity details' },
  { area: 'Diagram', keys: 'R', effect: 'Rename the entity' },
  { area: 'Diagram', keys: 'G', effect: 'Group the selected entities' },
  { area: 'Diagram', keys: '+ / - / 0', effect: 'Zoom in, zoom out, reset to 100 percent' },
  { area: 'Linking', keys: 'L', effect: 'Start a link from the focused column' },
  { area: 'Linking', keys: 'Up / Down', effect: 'Choose a target column in the same entity' },
  { area: 'Linking', keys: 'Tab / Shift+Tab', effect: 'Jump to the first column of the next or previous entity' },
  { area: 'Linking', keys: 'Enter', effect: 'Write the link into the text' },
  { area: 'Linking', keys: 'Escape', effect: 'Cancel and write nothing' },
]
