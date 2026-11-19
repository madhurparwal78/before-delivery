import { useRef } from 'react'
import { selectBlock, selectOpenEnd, selectPiece, selectTrain } from '../actions'
import { useAppState } from '../state'

interface Item { key: string; name: string; selected: boolean; choose: () => void }

// The roving list that makes the whole stage keyboard-complete: pieces, open ends, blocks and trains.
export function StageItems() {
  const state = useAppState()
  const list = useRef<HTMLUListElement>(null)
  const items: Item[] = []
  if (state.mode === 'build' && state.layout !== null) {
    for (const module of state.layout.content.modules) {
      for (const piece of module.pieces) {
        items.push({ key: `piece-${piece.id}`, name: `Piece ${piece.id}`, selected: state.selection.pieceId === piece.id, choose: () => selectPiece(piece.id) })
      }
      for (const end of module.open_ends) {
        items.push({ key: `end-${end.id}`, name: `Open end ${end.label}`, selected: state.selection.endId === end.id, choose: () => selectOpenEnd(end.id) })
      }
    }
  }
  if (state.mode === 'operate' && state.session !== null) {
    for (const block of state.session.blocks) {
      items.push({ key: `block-${block.id}`, name: `Block ${block.number} ${block.name}`, selected: state.selection.blockNumber === block.number, choose: () => selectBlock(block.number) })
    }
    for (const train of state.session.trains) {
      items.push({ key: `train-${train.id}`, name: `Train ${train.number}`, selected: state.selection.trainNumber === train.number, choose: () => selectTrain(train.number) })
    }
  }
  const tabbable = Math.max(0, items.findIndex(item => item.selected))

  function onKeyDown(event: React.KeyboardEvent<HTMLLIElement>, index: number): void {
    const options = list.current?.querySelectorAll<HTMLElement>('[role="option"]')
    if (options === undefined) return
    const move = (to: number): void => {
      event.preventDefault()
      options[Math.min(Math.max(to, 0), options.length - 1)]?.focus()
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') move(index + 1)
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(options.length - 1)
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      items[index].choose()
    }
  }

  return (
    <ul ref={list} role="listbox" aria-label="Stage items" data-testid="stage-items" className="stage-items">
      {items.length === 0 ? <li role="option" aria-selected="false" tabIndex={0} className="stage-item">Stage is empty</li> : null}
      {items.map((item, index) => (
        <li
          key={item.key}
          role="option"
          aria-selected={item.selected}
          tabIndex={index === tabbable ? 0 : -1}
          className="stage-item"
          onKeyDown={event => onKeyDown(event, index)}
          onClick={item.choose}
        >
          {item.name}
        </li>
      ))}
    </ul>
  )
}
