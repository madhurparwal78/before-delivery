package main

import (
	"fmt"
	"slices"
	"time"
)

// machine is one of the brief's state machines: for each state, the states it may move to.
type machine map[string][]string

// The legal moves, copied from the brief's Business rules.
var (
	lotMoves = machine{
		"intake":                {"estimated"},
		"estimated":             {"estimated", "placed"},
		"placed":                {"estimated", "open"},
		"open":                  {"extended", "closed_sold", "closed_unsold"},
		"extended":              {"extended", "closed_sold", "closed_unsold"},
		"closed_sold":           {"invoiced"},
		"closed_unsold":         {"second_chance_offered"},
		"second_chance_offered": {"sold_by_offer", "offer_lapsed"},
		"underbidder_offered":   {"sold_by_offer", "offer_lapsed"},
		"invoiced":              {"paid", "defaulted"},
		"sold_by_offer":         {"paid", "defaulted"},
		"defaulted":             {"underbidder_offered"},
	}
	saleMoves         = machine{"draft": {"open"}, "open": {"closed"}}
	offerMoves        = machine{"open": {"accepted", "declined", "expired"}}
	invoiceMoves      = machine{"issued": {"paid", "defaulted"}}
	statementMoves    = machine{"draft": {"issued"}, "issued": {"superseded"}}
	registrationMoves = machine{"pending": {"active"}}
)

// canMove reports whether the machine allows a move from one state to another.
func (m machine) canMove(from, to string) bool {
	return slices.Contains(m[from], to)
}

// flow is one entity's state machine as the code uses it: the state a new row starts in and, for each event the
// handlers and timed jobs carry out, the state it leads to from each state it may fire in. This file is the only
// place a state is decided: every write of a state elsewhere takes its value from start or next, every check calls
// next or one of the predicates below, and every query that filters on a state takes its list from here.
type flow struct {
	name   string
	moves  machine
	start  string
	events map[string]map[string]string
}

// The events, by entity. Staying in the same state (a re-estimate, a new order, a second extension) is no move;
// every other step is one of the brief's moves above, which init checks.
var (
	lotFlow = flow{name: "lot", moves: lotMoves, start: "intake", events: map[string]map[string]string{
		// estimating an intake lot makes it estimated; re-estimating an estimated or placed lot keeps its state
		"estimate": {"intake": "estimated", "estimated": "estimated", "placed": "placed"},
		"place":    {"estimated": "placed", "placed": "placed"},
		"unplace":  {"placed": "estimated"},
		"publish":  {"placed": "open"},
		"extend":   {"open": "extended", "extended": "extended"},
		"sell":     {"open": "closed_sold", "extended": "closed_sold"},
		"pass":     {"open": "closed_unsold", "extended": "closed_unsold"},
		"invoice":  {"closed_sold": "invoiced"},
		"offer":    {"closed_unsold": "second_chance_offered"},
		"reoffer":  {"defaulted": "underbidder_offered"},
		"accept":   {"second_chance_offered": "sold_by_offer", "underbidder_offered": "sold_by_offer"},
		"lapse":    {"second_chance_offered": "offer_lapsed", "underbidder_offered": "offer_lapsed"},
		"pay":      {"invoiced": "paid", "sold_by_offer": "paid"},
		"default":  {"invoiced": "defaulted", "sold_by_offer": "defaulted"},
	}}
	saleFlow = flow{name: "sale", moves: saleMoves, start: "draft", events: map[string]map[string]string{
		"publish": {"draft": "open"},
		"close":   {"open": "closed"},
	}}
	offerFlow = flow{name: "offer", moves: offerMoves, start: "open", events: map[string]map[string]string{
		"accept":  {"open": "accepted"},
		"decline": {"open": "declined"},
		"expire":  {"open": "expired"},
	}}
	invoiceFlow = flow{name: "invoice", moves: invoiceMoves, start: "issued", events: map[string]map[string]string{
		"pay":     {"issued": "paid"},
		"default": {"issued": "defaulted"},
	}}
	statementFlow = flow{name: "statement", moves: statementMoves, start: "draft", events: map[string]map[string]string{
		"issue":     {"draft": "issued"},
		"supersede": {"issued": "superseded"},
	}}
	registrationFlow = flow{name: "registration", moves: registrationMoves, start: "pending", events: map[string]map[string]string{
		"approve": {"pending": "active"},
	}}
	flows = []flow{lotFlow, saleFlow, offerFlow, invoiceFlow, statementFlow, registrationFlow}
)

func init() {
	for _, f := range flows {
		if err := f.check(); err != nil {
			panic(err)
		}
	}
}

// check reports an event step that is not one of the brief's moves.
func (f flow) check() error {
	for event, steps := range f.events {
		for from, to := range steps {
			if from != to && !f.moves.canMove(from, to) {
				return fmt.Errorf("%s event %s: %s to %s is not a legal move", f.name, event, from, to)
			}
		}
	}
	return nil
}

// next is the one decision for every move: the state event leads to from this one, or false when it may not fire.
func (f flow) next(from, event string) (string, bool) {
	to, ok := f.events[event][from]
	return to, ok
}

// can reports whether event may fire from this state.
func (f flow) can(from, event string) bool {
	_, ok := f.next(from, event)
	return ok
}

// from lists, sorted, the states event may fire in; queries select their candidate rows with it.
func (f flow) from(event string) []string {
	var out []string
	for from := range f.events[event] {
		out = append(out, from)
	}
	slices.Sort(out)
	return out
}

// to lists, sorted, the states event leads to.
func (f flow) to(event string) []string {
	var out []string
	for _, to := range f.events[event] {
		if !slices.Contains(out, to) {
			out = append(out, to)
		}
	}
	slices.Sort(out)
	return out
}

// known reports whether a state belongs to the flow: its start or a state some event fires in or leads to.
func (f flow) known(state string) bool {
	if state == f.start {
		return true
	}
	for _, steps := range f.events {
		for from, to := range steps {
			if state == from || state == to {
				return true
			}
		}
	}
	return false
}

// walk returns the state a new row reaches after the events in order; the seed uses it, so seeded rows are in a
// state the flow can reach.
func (f flow) walk(events ...string) string {
	state := f.start
	for _, e := range events {
		next, ok := f.next(state, e)
		if !ok {
			panic(fmt.Sprintf("%s: %s may not fire from %s", f.name, e, state))
		}
		state = next
	}
	return state
}

// ---- lots ----

// The state groups the queries and views use, each worked out from the events above.
var (
	lotsRunning = lotFlow.from("sell")     // still take bids and wait for their close
	lotsOnDesk  = lotFlow.from("estimate") // with the specialist, not yet in a published sale
	lotsHammer  = lotFlow.from("invoice")  // sold at the close and waiting for the sale's invoices
	// sold, at the hammer or by offer, and not defaulted: the bidder's won lots and the statement's sold lines
	lotsSold = union(lotsHammer, lotFlow.to("invoice"), lotFlow.to("accept"), lotFlow.to("pay"))
)

func union(lists ...[]string) []string {
	var out []string
	for _, l := range lists {
		for _, s := range l {
			if !slices.Contains(out, s) {
				out = append(out, s)
			}
		}
	}
	slices.Sort(out)
	return out
}

// lotRunning reports whether a lot still takes bids: it can still close.
func lotRunning(state string) bool { return lotFlow.can(state, "sell") }

// lotPublished reports whether a lot is in a published sale: it has left the specialist's desk.
func lotPublished(state string) bool { return !slices.Contains(lotsOnDesk, state) }

// lotSold reports whether a lot is sold and not defaulted.
func lotSold(state string) bool { return slices.Contains(lotsSold, state) }

// closeOutcome is a lot's close: the state the close leads to and the hammer result it records.
func closeOutcome(state string, sold bool) (to, result string, ok bool) {
	if sold {
		to, ok = lotFlow.next(state, "sell")
		return to, "sold", ok
	}
	to, ok = lotFlow.next(state, "pass")
	return to, "unsold", ok
}

// soldAtHammer reports whether a recorded close result is a sale.
func soldAtHammer(result string) bool { return result == "sold" }

// publicStatus is the hammer result the public sees: the running state, then the close's outcome, which never
// changes after the close.
func publicStatus(state, result string) string {
	if lotRunning(state) {
		return state
	}
	if soldAtHammer(result) {
		return lotFlow.to("sell")[0]
	}
	return lotFlow.to("pass")[0]
}

// hammerShown reports whether a consignor sees the lot's hammer: sold at the close or by an offer.
func hammerShown(state, result string) bool {
	return soldAtHammer(result) || slices.Contains(lotFlow.to("accept"), state)
}

// secondChanceAllowed reports whether a consignor may still offer an unsold lot to its top bidder.
func secondChanceAllowed(state string, bids int, decided bool) bool {
	return lotFlow.can(state, "offer") && bids > 0 && !decided
}

// canPlace reports whether ordering a draft sale may put a lot in it: a lot that may be placed, or one already
// placed in this same sale (a new order).
func canPlace(state, lotSale, saleID string) bool {
	to, ok := lotFlow.next(state, "place")
	return ok && (to != state || lotSale == saleID)
}

// ---- sales ----

var (
	salesLive  = saleFlow.from("close") // the current sale, while its lots run
	salesEnded = saleFlow.to("close")   // the last sale, once every lot has closed
)

// salePublic reports whether a sale is published: it can no longer be published.
func salePublic(state string) bool { return !saleFlow.can(state, "publish") }

// ---- statements ----

// statementsDraft are worked out again on every read and never shown to the consignor.
var statementsDraft = statementFlow.from("issue")

func statementDraft(status string) bool { return statementFlow.can(status, "issue") }

// ---- registrations ----

// registrationStart is a new registration's state: a consignor is active at once, a bidder waits for a limit.
func registrationStart(role string) string {
	if role == "consignor" {
		return registrationFlow.walk("approve")
	}
	return registrationFlow.start
}

// registrationMayBid reports whether a bidder's limit is approved.
func registrationMayBid(status string) bool {
	return slices.Contains(registrationFlow.to("approve"), status)
}

// ---- offers and invoices ----

var (
	errOfferExpired = failure(409, "offer_expired", "This offer has expired.")
	errOfferClosed  = failure(409, "offer_closed", "This offer has already been answered.")
	offersOpen      = offerFlow.from("expire")
	invoicesDue     = invoiceFlow.from("default")
)

// offerAnswer decides an accept or decline at the server's time: nil to go on; an open offer at or past its expiry
// must lapse first (expire is true) and answers offer_expired; an expired one offer_expired; any other offer_closed.
func offerAnswer(status string, expires, now time.Time) (expire bool, refusal error) {
	switch {
	case offerFlow.can(status, "accept") && now.Before(expires):
		return false, nil
	case offerFlow.can(status, "expire"):
		return true, errOfferExpired
	case slices.Contains(offerFlow.to("expire"), status):
		return false, errOfferExpired
	}
	return false, errOfferClosed
}

// paymentRefusal decides whether an invoice takes a payment at the server's time: nil, invoice_paid, or
// invoice_defaulted once it has defaulted or reached its due time.
func paymentRefusal(status, number string, due, now time.Time) error {
	switch {
	case slices.Contains(invoiceFlow.to("pay"), status):
		return failure(409, "invoice_paid", fmt.Sprintf("Invoice %s is already paid.", number))
	case !invoiceFlow.can(status, "pay") || !now.Before(due):
		return failure(409, "invoice_defaulted", fmt.Sprintf("Invoice %s has defaulted and can no longer be paid.", number))
	}
	return nil
}

// invoiceDefaults reports whether an invoice defaults at the server's time: it is still unpaid at its due time.
func invoiceDefaults(status string, due, now time.Time) bool {
	return invoiceFlow.can(status, "default") && !now.Before(due)
}

// offerLapses reports whether an offer lapses at the server's time: it is still open at its expiry.
func offerLapses(status string, expires, now time.Time) bool {
	return offerFlow.can(status, "expire") && !now.Before(expires)
}
