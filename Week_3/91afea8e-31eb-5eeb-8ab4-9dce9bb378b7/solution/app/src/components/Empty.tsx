import { MapPinOff, PackageOpen, SearchX, ShoppingBasket, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const SIGNS: Record<string, LucideIcon> = { basket: ShoppingBasket, search: SearchX, lost: MapPinOff, box: PackageOpen };

interface EmptyProps {
  /** `pink` or `black`: the two panels that carry empty and error states. */
  tone: "pink" | "black";
  sign: keyof typeof SIGNS;
  /** The single shouted sentence, rendered once as the heading element. */
  children: ReactNode;
  as?: "h1" | "h2" | "p";
  actions?: ReactNode;
}

export function Empty({ tone, sign, children, as: Tag = "p", actions }: EmptyProps): ReactNode {
  const Sign = SIGNS[sign] as LucideIcon;
  return (
    <section className={`empty panel--${tone}${tone === "pink" ? " on-light" : ""}`}>
      <Sign size={160} strokeWidth={2.5} aria-hidden="true" />
      <div>
        <Tag className="shout" tabIndex={Tag === "p" ? undefined : -1}>
          {children}
        </Tag>
        {actions && <div className="row" style={{ marginTop: 24 }}>{actions}</div>}
      </div>
    </section>
  );
}
