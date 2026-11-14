import { SHORTCUTS } from '../shortcuts.ts'

/** The keyboard guide table, shared by the landing page guide and the Keyboard shortcuts dialog. */
export function ShortcutTable({ label }: { label: string }) {
  return (
    <table className="shortcut-table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Where</th>
          <th scope="col">Keys</th>
          <th scope="col">What happens</th>
        </tr>
      </thead>
      <tbody>
        {SHORTCUTS.map((shortcut) => (
          <tr key={`${shortcut.area}-${shortcut.keys}`}>
            <td>{shortcut.area}</td>
            <th scope="row">
              <kbd>{shortcut.keys}</kbd>
            </th>
            <td>{shortcut.effect}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
