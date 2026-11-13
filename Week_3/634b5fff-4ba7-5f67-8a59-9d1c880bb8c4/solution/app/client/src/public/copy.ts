import type { BoxState, Chapter } from "../../../shared/domain.js";
import { CHAPTER_TITLES } from "../../../shared/copy.js";

/** The words of the public pages that are not in shared/copy.ts: names of controls, labels and short lines. */

export const LABELS = {
  nav: { name: "Main", story: "Story", shelf: "Shelf", lookup: "Find your order" },
  sound: { dialog: "Sound", on: "Sound on", off: "Sound off", skip: "Continue without sound", toggle: "Sound" },
  search: { field: "Search the tale and the shelf", results: "Search results", status: "Search status" },
  story: { captions: "Captions", status: "Story status" },
  shelf: { grid: "Box shelf" },
  hold: { bar: "Hold bar", status: "Hold status", count: "Boxes held", timer: "Time left", checkout: "Go to checkout", putBack: "Put it back", none: "No box held." },
  banner: "Sales banner",
  checkout: {
    form: "Checkout", errors: "Checkout errors", name: "Your name", email: "Your email", street: "Street", postcode: "Postcode",
    city: "City", gift: "This is a gift", recipientName: "Recipient name", recipientEmail: "Recipient email", message: "Gift message",
    payment: "Payment", card: "Card", bank: "Bank transfer", cardNumber: "Card number", expiry: "Expiry", cvc: "Security code",
    reserve: "Reserve for bank transfer", authorise: "Authorise",
  },
  sheet: { close: "Close", toShelf: "Back to the shelf" },
  bankCheck: { dialog: "Bank check", code: "One-time code", approve: "Approve", cancel: "Cancel" },
  order: { payment: "Payment status", certificate: "Certificate status", download: "Download certificate", next: "Your certificate will be ready once the box is packed." },
  lookup: { form: "Find your order", reference: "Order reference", email: "Email", submit: "Find my order", message: "Lookup message" },
} as const;

export const BOX_HINT = "Choose this number on the shelf to hold it.";

export const searchCount = (count: number): string => (count === 0 ? "No results" : count === 1 ? "1 result" : `${count} results`);

export const chapterLine = (index: number, total: number, chapter: Chapter): string =>
  `Chapter ${index + 1} of ${total}: ${CHAPTER_TITLES[chapter]}.`;

export const BOX_WORDS = {
  available: "Available on the shelf",
  held: "Held by someone for now",
  taken: "Taken: it has found a home",
} as const;

export const ORDER_BOX_WORDS: Record<BoxState | "held", string> = {
  held: "Not yet claimed",
  available: "Back on the shelf",
  awaiting_transfer: "Kept for your transfer",
  claimed: "Claimed for you",
  packed: "Packed",
  shipped: "Shipped",
  returned: "Returned to the press",
};

export const METHOD_WORDS = { card: "Card", bank: "Bank transfer" } as const;
