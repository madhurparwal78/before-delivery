import { DrawerLink } from '../router.js';

const FOLDERS = ['Payroll', 'Banking', 'Hosting', 'Vendor portals', 'Office'] as const;
const BANDS = ['paper', 'surface', 'muted'] as const;
const TAB_OFFSETS = ['0%', '18%', '36%', '54%', '70%'] as const;

export function Landing(): React.ReactElement {
  return (
    <div className="hero">
      <div className="hero-top">
        <span className="wordmark">Wardhouse</span>
        <DrawerLink to="/sign-in" className="hero-sign-in">
          Sign in
        </DrawerLink>
      </div>
      <h1>KEYS KEPT HERE</h1>
      <p className="hero-sentence">
        One drawer for every login the office shares, who holds it, and when it turns.
      </p>
      <ul className="hero-folders" aria-label="Drawer folders">
        {FOLDERS.map((name, index) => {
          const band = BANDS[index % BANDS.length] as string;
          const open = index === FOLDERS.length - 1;
          return (
            <li key={name} className="folder hero-folder">
              <span className="folder-tab" style={{ marginLeft: TAB_OFFSETS[index] }} aria-hidden="true">
                {name}
              </span>
              <div className={`folder-band folder-band--${band}`}>
                <span className="folder-title">{name}</span>
                {open ? (
                  <p style={{ marginTop: '1rem', marginBottom: 0 }}>
                    <DrawerLink to="/desk" className="button solid">
                      Open the drawer
                    </DrawerLink>
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
