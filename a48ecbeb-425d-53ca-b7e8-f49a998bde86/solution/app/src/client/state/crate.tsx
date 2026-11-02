import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api, ApiFailure } from "../lib/api";
import { prefersReduced } from "../lib/media";
import type { Cart } from "../lib/types";
import { flavourName, shippingPhrase, useShop } from "./shop";

// Crate Drop: a can token lifts off its card, flies to the lowest empty slot, waits there as a
// dashed pending outline and fills once the server confirms the reservation. A refusal flies
// the token back. All copy is the brief's.

type Phase = "flying" | "pending" | "removing";
interface Overlay {
  flavour: string;
  phase: Phase;
}

interface CrateDrop {
  overlays: Map<number, Overlay>;
  add: (flavour: string, source: HTMLElement, fill?: boolean) => void;
  remove: (slot: number) => void;
  registerSlot: (slot: number, el: HTMLElement | null) => void;
  firstAddButton: React.RefObject<HTMLButtonElement | null>;
}

const CrateContext = createContext<CrateDrop | null>(null);

export function useCrateDrop(): CrateDrop {
  const crate = useContext(CrateContext);
  if (!crate) throw new Error("useCrateDrop outside CrateDropProvider");
  return crate;
}

const STORE_OUTAGE = "The shop can't update your crate right now. Try again in a moment.";
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function tokenAt(rect: DOMRect, flavour: string): HTMLElement {
  const token = document.createElement("div");
  token.className = `can-token flavour-${flavour}`;
  token.setAttribute("aria-hidden", "true");
  const size = Math.min(56, Math.max(36, rect.height * 0.5));
  token.style.width = `${size}px`;
  token.style.height = `${size}px`;
  token.style.left = `${rect.left + rect.width / 2 - size / 2}px`;
  token.style.top = `${rect.top + rect.height / 2 - size / 2}px`;
  document.body.append(token);
  return token;
}

/** The translation that moves a token centred on `from` onto the centre of `to`. */
const offset = (from: DOMRect, to: DOMRect) => ({
  x: to.left + to.width / 2 - (from.left + from.width / 2),
  y: to.top + to.height / 2 - (from.top + from.height / 2),
});

async function lift(token: HTMLElement, delay = 0): Promise<void> {
  await token.animate([{ transform: "translate(0, 0) scale(1)" }, { transform: "translate(0, -8px) scale(1.08)" }], {
    duration: 120,
    delay,
    easing: EASE,
    fill: "forwards",
  }).finished;
}

async function fly(token: HTMLElement, dx: number, dy: number): Promise<void> {
  const rise = Math.min(-60, dy * 0.25 - 80);
  await token.animate(
    [
      { transform: "translate(0, -8px) scale(1.08)" },
      { transform: `translate(${dx * 0.5}px, ${rise}px) scale(1.02)`, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.9)` },
    ],
    { duration: 420, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)", fill: "forwards" },
  ).finished;
}

async function flyBack(token: HTMLElement, from: { x: number; y: number }): Promise<void> {
  await token.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px) scale(0.9)` },
      { transform: `translate(${from.x * 0.5}px, ${Math.min(from.y * 0.5, -40)}px) scale(1.02)`, offset: 0.5 },
      { transform: "translate(0, 0) scale(1)" },
    ],
    { duration: 300, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
  ).finished;
}

function fillSlot(el: HTMLElement | undefined): void {
  const can = el?.querySelector<HTMLElement>(".slot-can");
  if (!can) return;
  if (prefersReduced()) {
    can.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 100, easing: "linear" });
  } else {
    can.animate([{ transform: "scale(0.86)" }, { transform: "scale(1.06)", offset: 0.65 }, { transform: "scale(1)" }], {
      duration: 160,
      easing: EASE,
    });
  }
}

export function CrateDropProvider({ children }: { children: ReactNode }) {
  const shop = useShop();
  const [overlays, setOverlays] = useState<Map<number, Overlay>>(new Map());
  const overlayRef = useRef(overlays);
  const slots = useRef(new Map<number, HTMLElement>());
  const firstAddButton = useRef<HTMLButtonElement | null>(null);
  const shopRef = useRef(shop);
  shopRef.current = shop;

  const setOverlay = useCallback((update: (map: Map<number, Overlay>) => void) => {
    const next = new Map(overlayRef.current);
    update(next);
    overlayRef.current = next;
    setOverlays(next);
  }, []);

  const registerSlot = useCallback((slot: number, el: HTMLElement | null) => {
    if (el) slots.current.set(slot, el);
    else slots.current.delete(slot);
  }, []);

  const add = useCallback(
    (flavour: string, source: HTMLElement, fill = false) => {
      const { cart, flavours } = shopRef.current;
      const name = flavourName(flavours, flavour);
      const taken = new Set(overlayRef.current.keys());
      const free = (cart?.slots ?? Array.from({ length: 12 }, () => null)).flatMap((s, i) => (s || taken.has(i) ? [] : [i]));
      const quantity = fill ? Math.max(1, free.length) : 1;
      const targets = free.slice(0, quantity);
      const reduced = prefersReduced();
      const origin = source.getBoundingClientRect();

      setOverlay((map) => {
        for (const slot of targets) map.set(slot, { flavour, phase: reduced ? "pending" : "flying" });
      });

      const flights = targets.map(async (slot, i) => {
        if (reduced) return null;
        const token = tokenAt(origin, flavour);
        await lift(token, i * 24);
        const target = slots.current.get(slot)?.getBoundingClientRect();
        const move = target ? offset(origin, target) : { x: 0, y: -40 };
        await fly(token, move.x, move.y);
        setOverlay((map) => {
          if (map.get(slot)?.phase === "flying") map.set(slot, { flavour, phase: "pending" });
        });
        return { token, move };
      });
      const lone = targets.length === 0 && !reduced ? tokenAt(origin, flavour) : null;
      const loneLift = lone ? lift(lone) : Promise.resolve();

      const request = api<{ cart: Cart; added: { slots: number[] }; stock_left: number }>("POST", "/api/cart/items", { flavour, quantity });

      void (async () => {
        try {
          const body = await request;
          const landed = await Promise.all(flights);
          for (const flight of landed) flight?.token.remove();
          await loneLift;
          lone?.remove();
          flushSync(() => {
            shopRef.current.setCart(body.cart);
            shopRef.current.setStock(flavour, body.stock_left);
            setOverlay((map) => {
              for (const slot of targets) map.delete(slot);
            });
          });
          for (const slot of body.added.slots) fillSlot(slots.current.get(slot));
          const quote = await shopRef.current.requote(body.cart);
          const what = fill ? `${body.added.slots.length} ${name}` : name;
          shopRef.current.announceCrate(
            `Added ${what}. ${body.cart.count} of 12 cans in your crate. ${body.stock_left} left.${quote ? ` ${shippingPhrase(quote)}` : ""}`,
          );
        } catch (error) {
          const landed = await Promise.all(flights.map((f) => f.catch(() => null)));
          await Promise.all(
            landed.map(async (flight) => {
              if (!flight) return;
              await flyBack(flight.token, flight.move);
              flight.token.remove();
            }),
          );
          if (lone) {
            await loneLift;
            await flyBack(lone, { x: 0, y: -8 });
            lone.remove();
          }
          setOverlay((map) => {
            for (const slot of targets) map.delete(slot);
          });
          const current = shopRef.current;
          if (!(error instanceof ApiFailure) || error.status === 503 || error.status >= 500) {
            current.announceCrate(STORE_OUTAGE);
            return;
          }
          const stock = error.body.stock_left ?? current.flavours?.find((f) => f.slug === flavour)?.stock_left ?? 0;
          current.setStock(flavour, stock);
          const reason =
            error.code === "sold_out"
              ? "sold out"
              : error.body.limit === "drop"
                ? "you can hold up to 6 cans of a limited drop"
                : "your crate is full";
          if (error.code === "sold_out") current.markSoldOut(flavour, true);
          const phrase = current.quote ? ` ${shippingPhrase(current.quote)}` : "";
          current.announceCrate(`Couldn't add ${name}: ${reason}. ${current.cart?.count ?? 0} of 12 cans in your crate. ${stock} left.${phrase}`);
        }
      })();
    },
    [setOverlay],
  );

  const remove = useCallback(
    (slot: number) => {
      const { cart, flavours } = shopRef.current;
      const flavour = cart?.slots[slot]?.flavour;
      if (!cart || !flavour) return;
      const filled = cart.slots.flatMap((s, i) => (s && i !== slot && !overlayRef.current.has(i) ? [i] : []));
      const next = filled.find((i) => i > slot) ?? [...filled].reverse().find((i) => i < slot);
      flushSync(() =>
        setOverlay((map) => {
          map.set(slot, { flavour, phase: "removing" });
        }),
      );
      const focusTarget =
        next !== undefined ? slots.current.get(next)?.querySelector<HTMLButtonElement>("button") : firstAddButton.current;
      focusTarget?.focus();
      void (async () => {
        try {
          const body = await api<{ cart: Cart; stock_left: number }>("DELETE", `/api/cart/items/${slot}`);
          flushSync(() => {
            shopRef.current.setCart(body.cart);
            shopRef.current.setStock(flavour, body.stock_left);
            shopRef.current.markSoldOut(flavour, false);
            setOverlay((map) => {
              map.delete(slot);
            });
          });
          const quote = await shopRef.current.requote(body.cart);
          shopRef.current.announceCrate(
            `Removed ${flavourName(flavours, flavour)}. ${body.cart.count} of 12 cans in your crate.${quote ? ` ${shippingPhrase(quote)}` : ""}`,
          );
        } catch {
          setOverlay((map) => {
            map.delete(slot);
          });
          shopRef.current.announceCrate(STORE_OUTAGE);
        }
      })();
    },
    [setOverlay],
  );

  const value = useMemo(() => ({ overlays, add, remove, registerSlot, firstAddButton }), [overlays, add, remove, registerSlot]);
  return <CrateContext.Provider value={value}>{children}</CrateContext.Provider>;
}
