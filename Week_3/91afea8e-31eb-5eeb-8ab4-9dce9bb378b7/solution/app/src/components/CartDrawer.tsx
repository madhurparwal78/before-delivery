import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useCart } from "../lib/cart";
import type { ListingSnapshot } from "../lib/types";
import { createChipWorld, type ChipWorld } from "../effects/chips";
import { useReducedMotion } from "../lib/hooks";
import "../styles/effects.css";

const SHOW_MS = 4200;
const LINES = 3;

/**
 * The drawer that appears after "Add to cart": a product chip falls into it and stacks under gravity and collision.
 * The real line list is the accessible source of truth; the canvas is decoration and never takes input.
 */
export function CartDrawer(): ReactNode {
  const cart = useCart();
  const reduced = useReducedMotion();
  const location = useLocation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<ChipWorld | null>(null);
  const seen = useRef<number | null>(cart.lastAdded?.at ?? null);
  const [recent, setRecent] = useState<ListingSnapshot[]>([]);

  useEffect(() => {
    const added = cart.lastAdded;
    if (!added || added.at === seen.current) return;
    seen.current = added.at;
    setRecent((lines) => [added.item, ...lines.filter((line) => line.listing_id !== added.item.listing_id)].slice(0, LINES));
  }, [cart.lastAdded]);

  const open = recent.length > 0;

  useEffect(() => {
    if (!open) return undefined;
    const surface = canvas.current as HTMLCanvasElement;
    const fresh = createChipWorld(surface, reduced);
    world.current = fresh;
    return () => {
      fresh.destroy();
      world.current = null;
    };
  }, [open, reduced]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => setRecent([]), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [open, recent]);

  useEffect(() => {
    const added = cart.lastAdded;
    if (!added || !world.current) return;
    const art = new Image();
    const chips = world.current;
    art.onload = () => chips.repaint();
    art.src = added.item.image_url;
    chips.drop(art);
  }, [cart.lastAdded, recent]);

  useEffect(() => {
    setRecent([]);
  }, [location.pathname]);

  const unitsOf = (listingId: string): number =>
    cart.quote ? (cart.quote.lines.find((line) => line.listing_id === listingId)?.quantity ?? 0) : (cart.guest.find((line) => line.listing_id === listingId)?.quantity ?? 0);

  return (
    <section className={`drawer${open ? " drawer--open" : ""}`} aria-label="Cart drawer" hidden={!open}>
      <canvas ref={canvas} className="drawer__canvas" aria-hidden="true" />
      <ul className="drawer__lines" aria-label="Drawer lines">
        {recent.map((line) => (
          <li key={line.listing_id}>
            {line.title}
            <span className="drawer__units"> x {unitsOf(line.listing_id) || 1}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
