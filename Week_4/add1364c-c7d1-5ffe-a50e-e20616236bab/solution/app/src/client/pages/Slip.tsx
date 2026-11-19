import { turnStamp } from "../lib/office";
import type { Credential, Health } from "../lib/types";
import { Glyph } from "../ui/art";

const HEALTH_WORDS: Record<Health, string> = {
  sound: "Sound", out_of_policy: "Out of policy", exposed: "Exposed", vendor_breached: "Vendor breached", not_checked: "Not checked",
};

export function HealthTag({ health }: { health: Health }) {
  const kind = health === "sound" ? "ok" : health === "not_checked" ? "dash" : "warn";
  return <span className={`health health-${health}`}><Glyph kind={kind} /><span>{HEALTH_WORDS[health]}</span></span>;
}

export function vendorText(vendor: { name: string; formerly: string | null }): string {
  return vendor.formerly ? `${vendor.name} (formerly ${vendor.formerly})` : vendor.name;
}

interface Props {
  credential: Credential;
  secret: string | null;
  revealing: boolean;
  canTurn: boolean;
  canRename: boolean;
  onReveal: () => void;
  onHide: () => void;
  onCopy: () => void;
  onTurn: () => void;
  onRenameVendor: () => void;
}

export function Slip({ credential: c, secret, revealing, canTurn, canRename, onReveal, onHide, onCopy, onTurn, onRenameVendor }: Props) {
  const shown = secret !== null;
  return (
    <li className="slip" data-credential={c.id}>
      <div className="slip-grid">
        <div className="c-name">
          <strong className="slip-label">{c.label}</strong>
          <span className="slip-vendor">{vendorText(c.vendor)} <span className="slip-user">· {c.username}</span></span>
        </div>
        <div className="c-held">
          <span className="cap">Held by</span>
          <span>{c.held_by.length === 0 ? "Nobody on record" : c.held_by.map((h) => (h.left ? `${h.name} (left)` : h.name)).join(", ")}</span>
        </div>
        <div className="c-next">
          <span className="cap">Next turn</span>
          <span className="fig">{c.next_turn ? turnStamp(c.next_turn) : "None scheduled"}</span>
        </div>
        <div className="c-health"><HealthTag health={c.health} /></div>
      </div>
      <div className="slip-actions">
        {shown ? (
          <button type="button" className="btn btn-solid" aria-label={`Hide ${c.label}`} data-hide={c.id} onClick={onHide}>Hide</button>
        ) : revealing ? (
          <button type="button" className="btn btn-solid" aria-disabled="true">Revealing</button>
        ) : (
          <button type="button" className="btn btn-solid" aria-label={`Reveal ${c.label}`} data-reveal={c.id} onClick={onReveal}>Reveal</button>
        )}
        <button type="button" className="btn btn-quiet" aria-label={`Copy ${c.label}`} onClick={onCopy}>Copy</button>
        {canTurn ? <button type="button" className="btn btn-quiet" aria-label={`Turn ${c.label}`} data-turn={c.id} onClick={onTurn}>Turn</button> : null}
        {canRename ? <button type="button" className="btn btn-quiet" aria-label={`Rename vendor ${c.vendor.name}`} onClick={onRenameVendor}>Rename vendor</button> : null}
      </div>
      <div className="unfold" data-open={shown ? "true" : "false"}>
        <div className="unfold-in">{shown ? <span className="secret fig">{secret}</span> : null}</div>
      </div>
    </li>
  );
}
