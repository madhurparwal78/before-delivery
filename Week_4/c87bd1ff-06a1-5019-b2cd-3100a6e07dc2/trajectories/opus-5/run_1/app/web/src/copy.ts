import { amount, euros, plainEuros, rotterdamTime, timeLeft } from "./format.js";

/** Every published sentence the saleroom shows. Nothing else is written. */
export const copy = {
  openingBidLabel: "Opening bid",
  nextBid: (asking: number) => `Next bid ${euros(asking)}`,
  reserveMet: "Reserve met",
  youLead: "You lead",
  paddleLeads: (paddle: number) => `Paddle ${paddle} leads`,
  noBids: "No bids yet",
  closesIn: (seconds: number) => `Closes in ${timeLeft(seconds)}`,
  closing: "Closing…",
  soldFor: (hammer: number) => `Sold for ${euros(hammer)}`,
  closedUnsold: "Closed unsold",

  tileOpen: (lotNumber: number, price: number, seconds: number) =>
    `Lot ${lotNumber} · ${euros(price)} · Closes in ${timeLeft(seconds)}`,
  tileSold: (lotNumber: number, hammer: number) => `Lot ${lotNumber} · Sold ${euros(hammer)}`,
  tileUnsold: (lotNumber: number) => `Lot ${lotNumber} · Unsold`,
  posterCaption: (lotNumber: number, low: number, high: number) =>
    `Lot ${lotNumber} · Estimate ${euros(low)}–${plainEuros(high)}`,
  homeLine:
    "One sale a week. Closing one minute apart, from Thursday 20:00 Rotterdam time.",

  connecting: "Connecting to the saleroom…",
  confirmMaximum: (max: number, lotNumber: number) =>
    `Bid ${euros(max)} as your maximum on lot ${lotNumber}?`,
  confirmSingle: (max: number, lotNumber: number) => `Bid ${euros(max)} on lot ${lotNumber}?`,
  bidPending: "Placing your bid…",
  bidAcceptedLead: (price: number) => `Bid accepted. You lead at ${euros(price)}.`,
  bidAcceptedOutbid: (lotNumber: number, price: number) =>
    `Bid accepted, but an earlier maximum is higher. Lot ${lotNumber} now ${euros(price)}.`,
  bidClosed: (lotNumber: number) => `Bidding on lot ${lotNumber} has closed.`,
  askingMoved: (asking: number) => `The next bid is now ${euros(asking)}. Check it and confirm again.`,
  limitPending: "Your spending limit is waiting for approval.",
  noResponse: "Your bid did not reach the saleroom. Try again — it will only count once.",
  watchingOn: (lotNumber: number) => `Watching lot ${lotNumber}.`,
  watchingOff: (lotNumber: number) => `No longer watching lot ${lotNumber}.`,

  announcePrice: (lotNumber: number, price: number) => `Lot ${lotNumber} now ${euros(price)}.`,
  announcePriceLead: (lotNumber: number, price: number) =>
    `Lot ${lotNumber} now ${euros(price)}, you lead.`,
  announceReserve: (lotNumber: number) => `Reserve met on lot ${lotNumber}.`,
  announceSold: (lotNumber: number, hammer: number) => `Lot ${lotNumber} sold for ${euros(hammer)}.`,
  announceUnsold: (lotNumber: number) => `Lot ${lotNumber} closed unsold.`,

  connectionLost: "Live connection lost — reconnecting",
  retryNow: "Retry now",
  serverFailure: "Something went wrong in the saleroom. Try again.",

  registerPending: "Registering…",
  limitPendingApproval: "Limit pending approval",
  limitApproved: (limit: number, committed: number) =>
    `Spending limit ${euros(limit)} · ${euros(committed)} committed`,
  offerAccepted: (lotNumber: number, offered: number, invoiceNumber: string) =>
    `Lot ${lotNumber} is yours for ${euros(offered)}. Invoice ${invoiceNumber} is ready.`,
  offerDeclined: (lotNumber: number) => `You declined the offer on lot ${lotNumber}.`,
  offerExpired: "This offer has expired.",
  offerAnswered: "This offer has already been answered.",

  emptyDeskLine: "NOTHING CONSIGNED YET",
  emptyDeskSentence:
    "Offer a watch or camera and our specialist will estimate it within the week.",
  consignPending: "Sending to the specialist…",
  secondChanceSent: (expires: string) =>
    `Offer sent to the top bidder until ${rotterdamTime(expires)}.`,
  leaveUnsold: (lotNumber: number) => `Lot ${lotNumber} stays unsold.`,

  estimateSaved: (title: string) => `Estimate saved for ${title}.`,
  saleCreated: (title: string) => `Sale ${title} created.`,
  saleEndsForm: "Enter the end as YYYY-MM-DD HH:MM, Rotterdam time.",
  salePublished: (count: number) => `Sale published. ${count} lots are open.`,
  paymentPart: (paid: string, outstanding: string) =>
    `Payment of ${amount(paid)} recorded. ${amount(outstanding)} outstanding.`,
  paymentFull: (paid: string, invoiceNumber: string) =>
    `Payment of ${amount(paid)} recorded. Invoice ${invoiceNumber} is paid.`,
  approved: (paddle: number, limit: number) =>
    `Paddle ${paddle} approved with a spending limit of ${euros(limit)}.`,
  bidRemoved: (lotNumber: number, price: number) =>
    `Bid removed. Lot ${lotNumber} now ${euros(price)}.`,
  bidRemovedEmpty: (lotNumber: number) => `Bid removed. Lot ${lotNumber} has no bids.`,
  statementIssued: (number: string) => `Statement ${number} issued.`,
  statementCorrected: (newNumber: string, oldNumber: string) =>
    `Statement ${newNumber} issued, replacing ${oldNumber}.`,
  noInvoicesLine: "NO INVOICES YET",
  noInvoicesSentence: "Invoices appear when a sale's last lot closes.",
  noSaleLine: "NO SALE THIS WEEK",
  noSaleSentence: "The next catalogue opens soon.",
};

/** The State labels the consignor's Your lots table shows. */
export const stateLabels: Record<string, string> = {
  intake: "Intake",
  estimated: "Estimated",
  placed: "In sale",
  open: "Open",
  extended: "Extended",
  closed_sold: "Sold",
  closed_unsold: "Unsold",
  second_chance_offered: "Second chance offered",
  sold_by_offer: "Sold by offer",
  offer_lapsed: "Offer lapsed",
  invoiced: "Invoiced",
  paid: "Paid",
  defaulted: "Defaulted",
  underbidder_offered: "Offered to underbidder",
};
