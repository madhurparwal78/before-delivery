import { useRef, useState, type ReactNode } from "react";
import { useApp } from "../lib/store";
import { BagDrawer } from "./BagDrawer";
import { ConnectionStatus } from "./ConnectionStatus";
import { Header } from "./Header";
import { Toast } from "./Toast";

/** The storefront frame: header, live regions, toast and the bag drawer. */
export function Storefront({ children }: { children: ReactNode }) {
  const [bagOpen, setBagOpen] = useState(false);
  const bagRef = useRef<HTMLButtonElement>(null);
  const { announcement } = useApp();

  return (
    <div className="storefront">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header bagOpen={bagOpen} onBag={() => setBagOpen(true)} bagRef={bagRef} />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <div role="status" aria-label="Cart updates" aria-live="polite" className="sr-only">
        {announcement && <span key={announcement.id}>{announcement.text}</span>}
      </div>
      <ConnectionStatus />
      <Toast />
      <BagDrawer open={bagOpen} onClose={() => setBagOpen(false)} openerRef={bagRef} />
    </div>
  );
}
