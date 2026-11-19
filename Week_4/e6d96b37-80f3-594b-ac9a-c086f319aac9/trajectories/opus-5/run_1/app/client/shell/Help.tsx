/** The three help pages the footer links to. */

const KEY_PATHS: { area: string; paths: [string, string][] }[] = [
  {
    area: 'Moving something to a destination',
    paths: [
      ['Tab', 'Move to the source, then to the destination'],
      ['Space', 'Pick the source up; it shows its pressed state'],
      ['Enter', 'Stage the move on the destination'],
      ['Escape', 'Cancel the pickup and leave the draft alone'],
    ],
  },
  {
    area: 'Reordering the keeper list and the packing manifest',
    paths: [
      ['Space', 'Pick the focused item up'],
      ['Arrow Up / Arrow Down', 'Move it one place; focus follows it'],
      ['Enter', 'Drop it'],
      ['Escape', 'Return it to where it was before pickup'],
    ],
  },
  {
    area: 'Zoom sliders',
    paths: [
      ['Arrow Right / Arrow Up', 'Zoom in one step'],
      ['Arrow Left / Arrow Down', 'Zoom out one step'],
      ['Home', 'Smallest zoom'],
      ['End', 'Largest zoom'],
      ['Two-finger pinch', 'Zoom around the pinch point'],
    ],
  },
  {
    area: 'Slate rule wipe sliders',
    paths: [
      ['Arrow keys', 'Move the divider by one percent'],
      ['Page Up / Page Down', 'Move the divider by ten percent'],
      ['Home', 'Nought percent'],
      ['End', 'One hundred percent'],
    ],
  },
  {
    area: 'Markers',
    paths: [
      ['Arrow keys', 'Move one original-image unit'],
      ['Shift with an arrow', 'Move ten original-image units'],
      ['Image x and Image y', 'Set the coordinates numerically'],
    ],
  },
  {
    area: 'Audit cells',
    paths: [
      ['Arrow Right / Arrow Left', 'Next and previous cell'],
      ['Arrow Down / Arrow Up', 'One row down and up'],
      ['Swipe left / right', 'Next and previous cell'],
      ['Previous cell / Next cell', 'The same as left and right'],
    ],
  },
  {
    area: 'Review dialogs',
    paths: [
      ['Tab and Shift+Tab', 'Wrap inside the dialog'],
      ['Escape', 'The same as Cancel; focus returns to the opener'],
      ['Enter on Confirm', 'Commit the summarised action'],
    ],
  },
  {
    area: 'Desk tools',
    paths: [
      ['Open desk tools', 'Opens the phone navigation and moves focus into it'],
      ['Escape', 'Closes it and returns focus to the opener'],
    ],
  },
];

export function Help({ page }: { page: 'index' | 'evidence' | 'keyboard' }): JSX.Element {
  return (
    <div className="desk">
      <header className="masthead">
        <div className="slate-rule" />
        <div className="masthead-row">
          <a className="wordmark target" href="/">
            Flan
          </a>
        </div>
      </header>
      <main id="desk-main" className="sheet" aria-label="Specimen desk" tabIndex={-1}>
        {page === 'keyboard' ? <KeyboardGuide /> : null}
        {page === 'evidence' ? <EvidencePolicy /> : null}
        {page === 'index' ? <DeskHelp /> : null}
      </main>
      <div className="slate-rule footer-rule" />
      <nav className="desk-footer" aria-label="Desk footer">
        <p className="legal">Flan — Hollowmint Desk Co. Invented stock, invented register.</p>
        <span className="footer-gap" />
        <span className="footer-links">
          <a className="teal-action" href="/help/evidence">
            Evidence policy
          </a>
          <a className="teal-action" href="/help/keyboard">
            Keyboard guide
          </a>
          <a className="teal-action" href="/help">
            Desk help
          </a>
        </span>
      </nav>
    </div>
  );
}

function KeyboardGuide(): JSX.Element {
  return (
    <>
      <h1 className="workspace-heading">Keyboard guide</h1>
      <p>Every journey on this desk can be finished by keyboard alone.</p>
      {KEY_PATHS.map((group) => (
        <section key={group.area} className="fact-box">
          <h2 className="fact-heading">{group.area}:</h2>
          <ul>
            {group.paths.map(([key, what]) => (
              <li key={key}>
                <strong>{key}</strong> — {what}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function EvidencePolicy(): JSX.Element {
  return (
    <>
      <h1 className="workspace-heading">Evidence policy</h1>
      <section className="fact-box">
        <h2 className="fact-heading">Frozen dispatch evidence:</h2>
        <ul>
          <li>Freezing a packing manifest copies each coin's latest obverse into a new, immutable object.</li>
          <li>Nothing later, including a resolution, ever changes frozen dispatch evidence.</li>
        </ul>
      </section>
      <section className="fact-box">
        <h2 className="fact-heading">Private evidence links:</h2>
        <ul>
          <li>A link is scoped to its dispute and works only for that dispute's two parties.</li>
          <li>It expires on its own, and revoking it ends access immediately.</li>
        </ul>
      </section>
      <section className="fact-box">
        <h2 className="fact-heading">Photographs:</h2>
        <ul>
          <li>Every photograph is held privately and is never made public.</li>
          <li>Stored bytes always equal the bytes submitted, and each is hashed.</li>
        </ul>
      </section>
    </>
  );
}

function DeskHelp(): JSX.Element {
  return (
    <>
      <h1 className="workspace-heading">Desk help</h1>
      <section className="fact-box">
        <h2 className="fact-heading">Stock:</h2>
        <ul>
          <li>Take a coin in with both faces, attribute it against the register, then shelve it.</li>
          <li>Quarantine anything doubtful: it is then kept out of albums and offers.</li>
        </ul>
      </section>
      <section className="fact-box">
        <h2 className="fact-heading">Exchange:</h2>
        <ul>
          <li>Fill both baskets, verify your identity and send; both baskets are reserved together.</li>
          <li>Freeze the packing manifest before dispatch, then record receipt against it.</li>
        </ul>
      </section>
    </>
  );
}
