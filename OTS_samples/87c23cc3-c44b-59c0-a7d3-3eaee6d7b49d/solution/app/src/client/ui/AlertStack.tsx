import { useAlerts } from '../alerts.tsx'

/** Conflict, outage and access notices, each an `alert` that can be dismissed. */
export function AlertStack() {
  const { items, dismiss } = useAlerts()
  if (!items.length) return null
  return (
    <div className="alert-stack">
      {items.map((item) => (
        <div role="alert" className="alert-item" key={item.id}>
          <span>{item.text}</span>
          <button type="button" className="alert-dismiss" aria-label={`Dismiss: ${item.text}`} onClick={() => dismiss(item.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}
