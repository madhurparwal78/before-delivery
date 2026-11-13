export type BoxState =
  | 'available'
  | 'held'
  | 'claimed'
  | 'awaiting_transfer'
  | 'packed'
  | 'shipped'
  | 'returned';

export type PublicBoxState = 'available' | 'held' | 'taken';

export type PaymentState =
  | 'started'
  | 'challenge'
  | 'authorised'
  | 'captured'
  | 'partially_refunded'
  | 'refunded'
  | 'voided'
  | 'declined'
  | 'capture_failed'
  | 'authorisation_expired'
  | 'pending'
  | 'settled'
  | 'lapsed';

export type PaymentMethod = 'card' | 'bank';

export type CertificateState = 'none' | 'pending' | 'issued' | 'cancelled';

export type FulfilmentEventType = 'order.paid' | 'box.packed';

export interface EditionResponse {
  edition: number;
  priceOre: number;
  netOre: number;
  vatOre: number;
  courierOre: number;
  totalOre: number;
  charityName: string;
  rateBasisPoints: number;
  charityOre: number;
  closesAt: string;
  salesOpen: boolean;
}

export interface ShelfBox {
  number: number;
  plate: string;
  state: PublicBoxState;
}

export interface ShelfResponse {
  salesPaused: boolean;
  remaining: number;
  boxes: ShelfBox[];
}

export interface HoldResponse {
  number: number;
  plate: string;
  holdToken: string;
  holdMs: number;
  remainingMs: number;
}

export interface CheckoutReply {
  reference: string;
  orderToken: string;
  paymentState: PaymentState;
  boxState: BoxState;
  holdRemainingMs: number | null;
  challenge?: { id: string; expiresInMs: number };
  transfer?: TransferDetails;
}

export interface TransferDetails {
  iban: string;
  paymentReference: string;
  amountOre: number;
  deadlineAt: string;
}

export interface OrderResponse {
  reference: string;
  number: number;
  plate: string;
  method: PaymentMethod;
  paymentState: PaymentState;
  boxState: BoxState;
  totalOre: number;
  charityOre: number;
  transfer: TransferDetails | null;
  certificate: { state: CertificateState };
}

export type SearchHit =
  | { kind: 'passage'; passageId: string; chapter: string; excerpt: string }
  | { kind: 'box'; number: number; plate: string; state: PublicBoxState };

export interface StaffHit {
  number: number;
  plate: string;
  state: BoxState;
  recipientName: string | null;
  reference: string | null;
}
