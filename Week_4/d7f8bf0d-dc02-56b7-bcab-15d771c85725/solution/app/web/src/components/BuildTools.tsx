import { checkLayout, moduleOfSelection, pressTile, saveVersion, TILES, trashSelectedModule, undoLastPiece } from '../actions'
import { canBuild, store, useAppState } from '../state'
import { CurveLeftIcon, CurveRightIcon, FallIcon, RiseIcon, Straight12Icon, Straight6Icon, TurnoutLeftIcon, TurnoutRightIcon, UndoIcon } from '../ui/icons'
import { Button } from '../ui/primitives'

// A tile face less the ring under it.
const TILE_GLYPH = 32

const GLYPHS: Record<string, () => React.JSX.Element> = {
  'Straight 12 in': () => <Straight12Icon size={TILE_GLYPH} />,
  'Straight 6 in': () => <Straight6Icon size={TILE_GLYPH} />,
  'Curve left': () => <CurveLeftIcon size={TILE_GLYPH} />,
  'Curve right': () => <CurveRightIcon size={TILE_GLYPH} />,
  'Turnout left': () => <TurnoutLeftIcon size={TILE_GLYPH} />,
  'Turnout right': () => <TurnoutRightIcon size={TILE_GLYPH} />,
  Rise: () => <RiseIcon size={TILE_GLYPH} />,
  Fall: () => <FallIcon size={TILE_GLYPH} />,
}

// Build mode: the module tools above the track piece tile rail.
export function BuildTools() {
  const state = useAppState()
  if (state.mode !== 'build' || state.boot !== 'ready' || !canBuild(state.role) || state.layout === null) return null
  const hasModule = moduleOfSelection(state.layout, state.selection) !== undefined
  return (
    <div className="build-tools">
      <div className="build-actions">
        <Button className="btn-small" onClick={() => store.set({ dialog: { kind: 'add-module' } })}>Add module</Button>
        <Button className="btn-small" data-testid="trash-module" disabled={!hasModule} onClick={() => void trashSelectedModule()}>Trash module</Button>
        <Button className="btn-small" onClick={() => void checkLayout()}>Check layout</Button>
        <Button className="btn-small" onClick={() => void saveVersion()}>Save version</Button>
      </div>
      <div role="toolbar" aria-label="Track pieces" data-testid="tile-rail" className="tile-rail">
        {TILES.map(tile => (
          <button key={tile.name} type="button" className="tile" aria-label={tile.name} onClick={() => void pressTile(tile)}>
            {GLYPHS[tile.name]()}
            <span className="ring" data-filled={state.lastTile === tile.name} />
          </button>
        ))}
        <button type="button" className="tile" aria-label="Undo last piece" onClick={() => void undoLastPiece()}>
          <UndoIcon size={TILE_GLYPH} />
          <span className="ring" />
        </button>
      </div>
    </div>
  )
}
