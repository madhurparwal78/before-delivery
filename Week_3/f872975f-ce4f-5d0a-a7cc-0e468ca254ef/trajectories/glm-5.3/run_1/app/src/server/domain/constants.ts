export const SPECIES = ['Black walnut', 'Chestnut', 'Douglas fir', 'Heart pine', 'White oak'] as const;
export const GRADES = ['Select', 'Character', 'Rustic'] as const;
export const DEFECT_KINDS = ['nail hole', 'check', 'bolt hole'] as const;
export const BOARD_STATUSES = ['tagged', 'graded', 'available', 'held', 'sold-whole', 'cut'] as const;
export const TICKET_STATUSES = ['issued', 'at-saw', 'done'] as const;
export const HOLD_STATUSES = ['pending-payment', 'held', 'released', 'converted-to-sale'] as const;

export type Species = (typeof SPECIES)[number];
export type Grade = (typeof GRADES)[number];
export type DefectKind = (typeof DEFECT_KINDS)[number];
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export const OPEN_STATUSES: ReadonlySet<BoardStatus> = new Set(['tagged', 'graded', 'available', 'held']);
export const RETIRED_STATUSES: ReadonlySet<BoardStatus> = new Set(['cut', 'sold-whole']);
export const PUBLIC_VIEW_STATUSES: ReadonlySet<BoardStatus> = new Set(['available', 'held']);

export const DEPOSIT_CENTS = 2500;
export const KERF_ROUND_MM = 4;
export const OFFCUT_MIN_MM = 300;
export const MAX_PIECES = 20;
export const MAX_PHOTOS_PER_BOARD = 8;
