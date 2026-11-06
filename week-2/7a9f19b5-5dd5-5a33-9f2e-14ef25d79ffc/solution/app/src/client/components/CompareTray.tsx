import { GitCompareArrows, X } from "lucide-react";
import { useState } from "react";
import { usePresence } from "../lib/presence";
import { Dock } from "./Dock";
import { Link } from "../lib/router";
import { removeFromTray, useTray } from "../lib/tray";

/** A bar along the bottom: closed, only the toggle and its status show; open, the chosen fittings and the link. */
export function CompareTray() {
  const { items, message } = useTray();
  const [open, setOpen] = useState(false);
  const { ref, mounted, closing } = usePresence<HTMLElement>(open);
  return (
    <Dock>
    <div className="tray-dock">
      {mounted && (
        <section
          ref={ref}
          id="compare-tray"
          aria-label="Compare tray"
          className="tray"
          inert={closing}
          aria-hidden={closing || undefined}
        >
          {items.length ? (
            <ul className="tray__items">
              {items.map((item) => (
                <li key={item.code} className="tray__item">
                  <span className="tray__name">{item.product_name}</span>
                  <span className="tray__code mono">{item.code}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${item.product_name} from comparison`}
                    onClick={() => removeFromTray(item.code)}
                  >
                    <X aria-hidden="true" size={18} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tray__empty">Choose Compare on up to four fittings to see them side by side.</p>
          )}
          <Link href="/compare" className="button button--primary tray__open">
            Open comparison
          </Link>
        </section>
      )}
      <div className="tray-bar">
        <p className="tray-bar__status" role="status">
          {message}
        </p>
        <button
          type="button"
          className="tray-bar__toggle"
          aria-expanded={open}
          aria-controls="compare-tray"
          onClick={() => setOpen((value) => !value)}
        >
          <GitCompareArrows aria-hidden="true" size={18} strokeWidth={1.5} />
          {`Compare (${items.length})`}
        </button>
      </div>
    </div>
    </Dock>
  );
}
