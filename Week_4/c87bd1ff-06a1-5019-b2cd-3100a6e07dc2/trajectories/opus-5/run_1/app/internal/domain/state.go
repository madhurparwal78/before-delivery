package domain

// Lot states, the full state machine from Business rules.
const (
	LotIntake             = "intake"
	LotEstimated          = "estimated"
	LotPlaced             = "placed"
	LotOpen               = "open"
	LotExtended           = "extended"
	LotClosedSold         = "closed_sold"
	LotClosedUnsold       = "closed_unsold"
	LotInvoiced           = "invoiced"
	LotSecondChanceOffer  = "second_chance_offered"
	LotSoldByOffer        = "sold_by_offer"
	LotOfferLapsed        = "offer_lapsed"
	LotUnderbidderOffered = "underbidder_offered"
	LotPaid               = "paid"
	LotDefaulted          = "defaulted"
)

// Sale states.
const (
	SaleDraft  = "draft"
	SaleOpen   = "open"
	SaleClosed = "closed"
)

// Offer states.
const (
	OfferOpen     = "open"
	OfferAccepted = "accepted"
	OfferDeclined = "declined"
	OfferExpired  = "expired"
)

// Offer kinds.
const (
	OfferSecondChance = "second_chance"
	OfferDefault      = "default"
)

// Invoice states.
const (
	InvoiceIssued    = "issued"
	InvoicePaid      = "paid"
	InvoiceDefaulted = "defaulted"
)

// Statement states.
const (
	StatementDraft      = "draft"
	StatementIssued     = "issued"
	StatementSuperseded = "superseded"
)

// Invoice line sources.
const (
	SourceHammer       = "hammer"
	SourceSecondChance = "second_chance"
	SourceDefaultOffer = "default_offer"
)

// Portraits are the six procedural drawings a lot can carry.
var Portraits = []string{"chronograph", "rangefinder", "diver", "twin_lens", "dress", "bellows"}

// IsPortrait reports whether a value is one of the six portraits.
func IsPortrait(v string) bool {
	for _, p := range Portraits {
		if p == v {
			return true
		}
	}
	return false
}

// IsLive reports whether bidding may still happen on a lot in this state.
func IsLive(state string) bool { return state == LotOpen || state == LotExtended }

// closedAfterSale reports the states a lot reaches once its sale has run.
func closedAfterSale(state string) bool {
	switch state {
	case LotClosedSold, LotClosedUnsold, LotInvoiced, LotSecondChanceOffer,
		LotSoldByOffer, LotOfferLapsed, LotUnderbidderOffered, LotPaid, LotDefaulted:
		return true
	}
	return false
}

// PublicStatus maps a lot's full state and its hammer result to the status the
// public and bidder projections carry. It records the hammer result and never
// changes after the close.
func PublicStatus(state string, soldAtHammer bool) string {
	switch {
	case state == LotExtended:
		return LotExtended
	case closedAfterSale(state):
		if soldAtHammer {
			return LotClosedSold
		}
		return LotClosedUnsold
	default:
		return LotOpen
	}
}
