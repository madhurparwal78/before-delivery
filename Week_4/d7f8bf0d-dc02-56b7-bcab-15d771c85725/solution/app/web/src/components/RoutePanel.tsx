import { cancelAuthority, selectBlock, selectTrain } from '../actions'
import { setDestination, setLimitMinutes, setSearch, setVia, useRoute } from '../route'
import { canRun, useAppState } from '../state'
import { Button } from '../ui/primitives'

function TrainList() {
  const { session, selection } = useAppState()
  if (session === null) return null
  function onKeyDown(event: React.KeyboardEvent<HTMLLIElement>, number: string): void {
    const options = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const at = options.indexOf(event.currentTarget)
    if (event.key === 'ArrowDown') options[Math.min(at + 1, options.length - 1)].focus()
    else if (event.key === 'ArrowUp') options[Math.max(at - 1, 0)].focus()
    else if (event.key === 'Enter' || event.key === ' ') selectTrain(number)
    else return
    event.preventDefault()
  }
  const tabbable = Math.max(0, session.trains.findIndex(train => train.number === selection.trainNumber))
  return (
    <ul role="listbox" aria-label="Trains" className="train-list">
      {session.trains.map((train, index) => (
        <li
          key={train.id}
          role="option"
          aria-label={`Train ${train.number}`}
          aria-selected={selection.trainNumber === train.number}
          tabIndex={index === tabbable ? 0 : -1}
          className="train-option"
          onClick={() => selectTrain(train.number)}
          onKeyDown={event => onKeyDown(event, train.number)}
        >
          <span className="num">{train.number}</span>
        </li>
      ))}
    </ul>
  )
}

export function RoutePanel() {
  const { session, role, selection } = useAppState()
  const route = useRoute()
  if (session === null) return null
  const blocks = [...session.blocks].sort((a, b) => a.number - b.number)
  const train = session.trains.find(candidate => candidate.number === selection.trainNumber)
  return (
    <section role="region" aria-label="Route" data-testid="route-panel" className="route-panel">
      <TrainList />
      <p className="train-caption">{train?.name ?? (canRun(role) ? 'Select a train' : '')}</p>
      {canRun(role) ? (
        <>
          <label className="field">
            <span className="field-label">Destination block</span>
            <select className="input select" aria-label="Destination block" value={route.destination} onChange={event => setDestination(event.target.value)}>
              <option value="" disabled>Choose block</option>
              {blocks.map(block => <option key={block.id} value={block.id}>{`Block ${block.number} ${block.name}`}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Via block</span>
            <select className="input select" aria-label="Via block" value={route.via} onChange={event => setVia(event.target.value)}>
              <option value="">No block</option>
              {blocks.map(block => <option key={block.id} value={block.id}>{`Block ${block.number} ${block.name}`}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Time limit (minutes)</span>
            <input className="input" type="number" aria-label="Time limit" min={1} max={720} step={1} value={route.limitMinutes} onChange={event => setLimitMinutes(Number(event.target.value))} />
          </label>
          <div className="field field-button">
            <Button className="btn-small" disabled={train?.authority_id == null} onClick={() => void cancelAuthority()}>Cancel authority</Button>
          </div>
        </>
      ) : null}
      <p className="route-preview" data-testid="route-preview">{route.previewLine}</p>
      {route.previewError !== '' ? <p className="route-error">{route.previewError}</p> : null}
      <label className="field search-field">
        <span className="sr-only">Block search</span>
        <input className="input" type="search" role="searchbox" aria-label="Block search" placeholder="Search blocks" value={route.search} onChange={event => setSearch(event.target.value)} />
      </label>
      {route.results.length > 0 ? (
        <ul role="listbox" aria-label="Block results" className="block-results">
          {route.results.map(result => (
            <li
              key={result.id}
              role="option"
              aria-selected={route.destination === result.id}
              aria-label={`Block ${result.number} ${result.name}`}
              tabIndex={0}
              className="train-option"
              onClick={() => { setDestination(result.id); selectBlock(result.number) }}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDestination(result.id); selectBlock(result.number) } }}
            >
              {`Block ${result.number} ${result.name}`}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
