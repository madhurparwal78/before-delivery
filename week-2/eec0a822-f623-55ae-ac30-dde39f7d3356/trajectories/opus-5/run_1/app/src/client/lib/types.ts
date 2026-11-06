export type BaseKey = 'split' | 'lavrio';

export interface YachtProfile {
  readonly slug: string;
  readonly name: string;
  readonly base: BaseKey;
  readonly status: 'on_sale' | 'withdrawn';
  readonly cabins: number;
  readonly lengthM: number;
  readonly beamM: number;
  readonly draftM: number;
  readonly batteryKwh: number;
  readonly hotelKw: number;
  readonly solarKw: number;
  readonly dragKwPerKnCubed: number;
  readonly shorePowerKw: number;
  readonly rates: {
    readonly lowMinor: number;
    readonly shoulderMinor: number;
    readonly highMinor: number;
  };
  readonly currency: string;
  readonly crew: readonly { readonly id: string; readonly name: string; readonly position: string }[];
}

export interface StaffWeek {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly status: 'free' | 'held' | 'booked';
  readonly season: 'low' | 'shoulder' | 'high';
  readonly weeklyRateMinor: number;
  readonly currency: string;
  readonly liveHoldId: string | null;
  readonly waitingCount: number;
}

export type HoldStatus = 'waiting' | 'live' | 'lapsed' | 'released' | 'charter';

export interface Hold {
  readonly id: string;
  readonly yachtSlug: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly clientName: string;
  readonly placedBy: { readonly kind: 'member' | 'broker'; readonly name: string };
  readonly status: HoldStatus;
  readonly position: number | null;
  readonly placedAt: string;
  readonly liveSince: string | null;
  readonly lapsesAt: string | null;
  readonly charterId: string | null;
}

export interface CharterLine {
  readonly kind: 'charter_fee' | 'provisioning_allowance' | 'vat';
  readonly label: string;
  readonly eurMinor: number;
  readonly amountMinor: number;
}

export interface Charter {
  readonly id: string;
  readonly holdId: string | null;
  readonly yachtSlug: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly clientName: string;
  readonly clientEmail: string;
  readonly currency: string;
  readonly season: 'low' | 'shoulder' | 'high';
  readonly depositDate: string | null;
  readonly exchangeTableId: string | null;
  readonly rate: string;
  readonly lines: readonly CharterLine[];
  readonly totalEurMinor: number;
  readonly totalMinor: number;
  readonly invoiceStatus: 'invoiced' | 'not_invoiced';
  readonly killbillInvoiceId: string | null;
  readonly invoicedAt: string | null;
  readonly status: 'open' | 'closed';
  readonly closedAt: string | null;
  readonly erasesAt: string | null;
}

export interface Quote {
  readonly currency: string;
  readonly exchangeTableId: string | null;
  readonly rate: string;
  readonly lines: readonly CharterLine[];
  readonly totalEurMinor: number;
  readonly totalMinor: number;
}

export interface Anchorage {
  readonly id: string;
  readonly name: string;
  readonly base: BaseKey;
  readonly latitude: number;
  readonly longitude: number;
}

export interface PassageLeg {
  readonly index: number;
  readonly fromAnchorageId: string;
  readonly toAnchorageId: string;
  readonly speedKn: number;
  readonly distanceNm: number;
  readonly departsAt: string;
  readonly arrivesAt: string;
  readonly arrivalBase: BaseKey;
  readonly arrivalChargePct: number;
  readonly reserve: 'ok' | 'below_reserve';
}

export interface Passage {
  readonly id: string;
  readonly yachtSlug: string;
  readonly name: string;
  readonly status: 'draft' | 'sent';
  readonly base: BaseKey;
  readonly startAnchorageId: string;
  readonly departureDate: string;
  readonly departureTime: string;
  readonly departsAt: string;
  readonly startChargePct: number;
  readonly legs: readonly PassageLeg[];
  readonly minChargePct: number | null;
  readonly updatedAt: string;
}

export interface Rota {
  readonly yachtSlug: string;
  readonly weekStart: string;
  readonly base: BaseKey;
  readonly version: number;
  readonly savedBy: string | null;
  readonly savedAt: string | null;
  readonly crew: readonly { readonly id: string; readonly name: string; readonly position: string }[];
  readonly slots: readonly { readonly startsAt: string; readonly date: string; readonly label: string }[];
  readonly work: Record<string, readonly string[]>;
}

export interface Marina {
  readonly id: string;
  readonly name: string;
  readonly base: BaseKey;
  readonly today: string;
  readonly berths: readonly {
    readonly code: string;
    readonly lengthM: number;
    readonly widthM: number;
    readonly depthM: number;
  }[];
  readonly pontoons: readonly { readonly code: string; readonly limitKw: number }[];
  readonly tariffs: readonly {
    readonly id: string;
    readonly effectiveDate: string;
    readonly ratePerMetreMinor: number;
    readonly currency: string;
  }[];
}

export interface BerthNight {
  readonly date: string;
  readonly tariffId: string;
  readonly ratePerMetreMinor: number;
  readonly feeMinor: number;
}

export interface BerthResult {
  readonly code: string;
  readonly lengthM: number;
  readonly widthM: number;
  readonly depthM: number;
  readonly fits: boolean;
  readonly available: boolean;
  readonly nights: readonly BerthNight[];
  readonly totalMinor: number;
  readonly currency: string;
}

export interface BerthBooking {
  readonly id: string;
  readonly yachtSlug: string;
  readonly marinaId: string;
  readonly berthCode: string;
  readonly arrivalDate: string;
  readonly departureDate: string;
  readonly nights: readonly BerthNight[];
  readonly totalMinor: number;
  readonly currency: string;
  readonly bookedBy: string;
  readonly bookedAt: string;
}

export interface PowerSlot {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: 'open' | 'full' | 'past';
  readonly bookedKw: number;
  readonly bookings: readonly { readonly yachtSlug: string; readonly yachtName: string }[];
}

export interface StoreItem {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly category: string;
  readonly receivedQty: number;
  readonly usedQty: number;
  readonly spoiledQty: number;
  readonly onHandQty: number;
}

export interface EnergyLog {
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
  readonly objectKey: string;
  readonly dayCount: number;
}

export interface EnergyDay {
  readonly date: string;
  readonly startChargePct: number;
  readonly endChargePct: number;
  readonly lowestChargePct: number;
  readonly solarKwh: number;
}

export interface Broker {
  readonly id: string;
  readonly name: string;
  readonly contactName: string;
  readonly email: string;
  readonly notes: string;
  readonly page: {
    readonly status: 'live' | 'ended' | 'none';
    readonly issuedAt: string | null;
    readonly endsAt: string | null;
  };
}

export interface ManifestGuest {
  readonly id: string;
  readonly fullName: string;
  readonly nationality?: string | null;
  readonly dateOfBirth?: string | null;
  readonly passportNumber?: string | null;
  readonly photoOnFile?: boolean;
  readonly passportOnFile?: boolean;
  readonly dateOfBirthOnFile?: boolean;
}

export interface ManifestPage {
  readonly status: 'live' | 'ended' | 'none';
  readonly issuedAt: string | null;
  readonly endsAt: string | null;
  readonly path: string | null;
}

export interface ExchangeTable {
  readonly id: string;
  readonly effectiveDate: string;
  readonly rates: { readonly GBP: string; readonly USD: string };
}
