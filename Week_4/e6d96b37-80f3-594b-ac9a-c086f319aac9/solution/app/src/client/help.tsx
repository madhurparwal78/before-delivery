// Help pages: desk help, the evidence policy and the keyboard guide (every key path in the brief).

const KEY_PATHS: [string, string][] = [
  ["Move a photo, holder or specimen", "Tab to the source, Space to pick it up, Tab to the destination, Enter to stage it; Escape cancels the pickup."],
  ["Reorder keepers or the packing manifest", "Space picks up the focused item, Arrow Up and Arrow Down move it one place, Enter drops it, Escape returns it."],
  ["Zoom the mintmark or an arrival photograph", "Arrow Right or Arrow Up zooms in a quarter step, Arrow Left or Arrow Down zooms out, Home is the lowest zoom, End the highest."],
  ["Move a Slate rule wipe divider", "Arrows move it 1 percent, Page Up and Page Down 10 percent, Home to 0 and End to 100."],
  ["Move a condition or damage marker", "Arrows move it one original-image unit, Shift with an arrow moves it 10; Image x and Image y set it exactly."],
  ["Walk the audit tray", "Arrow Right and Arrow Left go to the next and previous cell, Arrow Down and Arrow Up one row; Previous cell and Next cell do the same."],
  ["Review dialogs", "Opening one focuses Cancel, Tab and Shift+Tab stay inside, Escape cancels and focus returns to the control that opened it."],
  ["Desk tools on a phone", "Open desk tools moves focus into the workspace list; Close desk tools or Escape returns focus."],
  ["Pages of the Stock grid", "Next page and Previous page move through the stock twelve specimens at a time."],
];

export function Help({ page }: { page: "help" | "evidence" | "keyboard" }) {
  if (page === "keyboard") {
    return (
      <article className="help">
        <h1 className="workspace-heading">Keyboard guide</h1>
        <p>Every journey on the desk can be finished with the keyboard alone. A teal focus ring marks the focused control.</p>
        <dl className="key-paths">
          {KEY_PATHS.map(([name, keys]) => (
            <div key={name} className="key-path">
              <dt>{name}:</dt>
              <dd>{keys}</dd>
            </div>
          ))}
        </dl>
      </article>
    );
  }
  if (page === "evidence") {
    return (
      <article className="help">
        <h1 className="workspace-heading">Evidence policy</h1>
        <ul>
          <li>Every photograph and evidence object is stored privately; nothing is published.</li>
          <li>Freezing a packing manifest stores an immutable copy of each item's latest obverse photograph. Later changes never alter it.</li>
          <li>Opening a dispute stores a snapshot of the damage markers with the frozen dispatch and arrival photographs.</li>
          <li>A private evidence link works only for the two parties of its dispute, and only until it expires or is revoked.</li>
          <li>When a counterpart's access ends, their screen loses every private photograph at once.</li>
        </ul>
      </article>
    );
  }
  return (
    <article className="help">
      <h1 className="workspace-heading">Desk help</h1>
      <p>Flan is the working desk of a one-person rare-coin dealership and its circle of counterpart dealers.</p>
      <ul>
        <li>Stock: take a coin in with both face photographs, attribute and reconcile its mintmark variety, shelve its holder, fill album holes, compare condition and rank keepers.</li>
        <li>Exchange: send reciprocal offers, counter and accept versions with a one-time code, freeze dispatch evidence, record receipt and resolve disputes.</li>
        <li>Every change is confirmed through a review. Drafts stay in this browser until you confirm them.</li>
      </ul>
    </article>
  );
}
