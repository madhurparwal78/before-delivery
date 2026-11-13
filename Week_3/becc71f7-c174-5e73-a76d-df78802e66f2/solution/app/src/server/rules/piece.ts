// A piece's stations, prices and status, all derived from its dates and the server's clock.
import { addDays, brusselsDate, brusselsInstant } from "../../shared/brussels";
import type { Station, StationKey } from "../../shared/api";
import type { PieceStatus } from "../../shared/catalog";
import { markdownPrice } from "./money";

export interface LadderTerms {
  firstMarkdownPercent: number;
  firstMarkdownDay: number;
  secondMarkdownPercent: number;
  secondMarkdownDay: number;
  periodEndDay: number;
}

interface PriceFacts {
  intakeDate: string;
  ladder: LadderTerms;
  /** Asking prices oldest first; the first one holds from intake. */
  askingPrices: { cents: number; fromAt: Date }[];
}

export interface StatusFacts extends PriceFacts {
  archivedAt: Date | null;
  collectedAt: Date | null;
  choice: string | null;
  sold: boolean;
  held: boolean;
}

const SHELF_DAYS = 14;
const CHOICE_DAYS = 14;
const KEYS: readonly StationKey[] = ["full_price", "off_25", "off_50", "period_ends"];

const dayStart = (intakeDate: string, day: number): Date => brusselsInstant(addDays(intakeDate, day));

function stationStarts({ intakeDate, ladder }: PriceFacts): Date[] {
  return [0, ladder.firstMarkdownDay, ladder.secondMarkdownDay, ladder.periodEndDay].map((day) => dayStart(intakeDate, day));
}

export const periodEnd = (facts: PriceFacts): Date => dayStart(facts.intakeDate, facts.ladder.periodEndDay);
export const choiceOpensAt = (facts: PriceFacts): Date => dayStart(facts.intakeDate, facts.ladder.periodEndDay - CHOICE_DAYS);

export const choiceIsOpen = (facts: PriceFacts, now: Date): boolean => now >= choiceOpensAt(facts) && now < periodEnd(facts);

function askingAt({ askingPrices }: PriceFacts, instant: Date): number {
  return askingPrices.reduce((asking, price) => (price.fromAt <= instant ? price.cents : asking), askingPrices[0].cents);
}

function priceOfStation({ ladder }: PriceFacts, asking: number, index: number): number {
  if (index === 0) return asking;
  return markdownPrice(asking, index === 1 ? ladder.firstMarkdownPercent : ladder.secondMarkdownPercent);
}

function stationIndexAt(facts: PriceFacts, instant: Date): number {
  return stationStarts(facts).reduce((current, start, index) => (start <= instant ? index : current), 0);
}

export function priceAt(facts: PriceFacts, instant: Date): number {
  return priceOfStation(facts, askingAt(facts, instant), stationIndexAt(facts, instant));
}

/** The price just before the most recent change of price, or null when it has never changed. */
export function previousPrice(facts: PriceFacts, now: Date): number | null {
  const starts = stationStarts(facts);
  const changes = [...facts.askingPrices.slice(1).map((price) => price.fromAt), starts[1], starts[2]]
    .filter((instant) => instant <= now)
    .sort((a, b) => a.getTime() - b.getTime());
  let price = priceAt(facts, starts[0]);
  let previous: number | null = null;
  for (const change of changes) {
    const next = priceAt(facts, change);
    if (next !== price) {
      previous = price;
      price = next;
    }
  }
  return previous;
}

export function stationsOf(facts: PriceFacts, now: Date, instantOf: (instant: Date) => string): Station[] {
  const current = stationIndexAt(facts, now);
  const asking = askingAt(facts, now);
  const { ladder } = facts;
  const labels = ["Full price", `${ladder.firstMarkdownPercent}% off`, `${ladder.secondMarkdownPercent}% off`, "Period ends"];
  return stationStarts(facts).map((start, index) => ({
    station: KEYS[index],
    label: labels[index],
    at: instantOf(start),
    priceCents: priceOfStation(facts, asking, index),
    state: index < current ? "done" : index === current ? "current" : "next",
  }));
}

export const currentStation = (facts: PriceFacts, now: Date): StationKey => KEYS[stationIndexAt(facts, now)];

export function statusOf(facts: StatusFacts, now: Date): PieceStatus {
  if (facts.archivedAt) return "archived";
  if (facts.sold) return "sold";
  if (now >= periodEnd(facts)) {
    if (facts.collectedAt) return "returned";
    const shelfEnds = dayStart(facts.intakeDate, facts.ladder.periodEndDay + SHELF_DAYS);
    return facts.choice === "return" && now < shelfEnds ? "returns_shelf" : "donation_box";
  }
  return facts.held ? "on_hold" : "on_rail";
}

const REFUND_LAST_DAY = 14;
const SOLD_PAGE_DAYS = 30;

/** 23:59:59 Brussels on the 14th day after the sale's date. */
export function refundableUntil(soldAt: Date): Date {
  return brusselsInstant(addDays(brusselsDate(soldAt), REFUND_LAST_DAY), 23, 59, 59);
}

/** The window closes at 00:00 Brussels on day 15. */
export const refundWindowOpen = (soldAt: Date, now: Date): boolean => now < brusselsInstant(addDays(brusselsDate(soldAt), REFUND_LAST_DAY + 1));

export const soldPageEnds = (soldAt: Date): Date => brusselsInstant(addDays(brusselsDate(soldAt), SOLD_PAGE_DAYS));
