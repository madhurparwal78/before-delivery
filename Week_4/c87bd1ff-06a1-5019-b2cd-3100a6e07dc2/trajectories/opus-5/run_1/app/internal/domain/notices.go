package domain

import (
	"fmt"
	"time"
)

// Notice kinds, one per timed or decided event.
const (
	NoticeOutbid           = "outbid"
	NoticeClosingSoon      = "closing_soon"
	NoticeWon              = "won"
	NoticeLotClosed        = "lot_closed"
	NoticeLotResult        = "lot_result"
	NoticeSecondChance     = "second_chance"
	NoticeDefaultOffer     = "default_offer"
	NoticeOfferAccepted    = "offer_accepted"
	NoticeOfferLapsed      = "offer_lapsed"
	NoticeInvoiceIssued    = "invoice_issued"
	NoticeInvoiceDefaulted = "invoice_defaulted"
	NoticeLimitApproved    = "limit_approved"
	NoticeBidRemoved       = "bid_removed"
	NoticeStatementIssued  = "statement_issued"
)

// NoticeOutbidText is sent to the bidder who just lost the lead.
func NoticeOutbidText(lotNumber int) string {
	return fmt.Sprintf("You have been outbid on lot %d.", lotNumber)
}

// NoticeClosingSoonText is sent to each watcher before the lot's close.
func NoticeClosingSoonText(lotNumber int, closesAt time.Time) string {
	return fmt.Sprintf("Lot %d closes soon, at %s.", lotNumber, RotterdamTime(closesAt))
}

// NoticeWonText is sent to the hammer winner.
func NoticeWonText(lotNumber, hammer int) string {
	return fmt.Sprintf("You won lot %d at %s.", lotNumber, Euros(hammer))
}

// NoticeLotClosedText is sent to each other bidder and watcher.
func NoticeLotClosedText(lotNumber int, sold bool, hammer int) string {
	if sold {
		return fmt.Sprintf("Lot %d sold for %s.", lotNumber, Euros(hammer))
	}
	return fmt.Sprintf("Lot %d closed unsold.", lotNumber)
}

// NoticeLotResultText is sent to the consignor at the close.
func NoticeLotResultText(lotNumber int, sold bool, hammer int, secondChanceOpen bool) string {
	switch {
	case sold:
		return fmt.Sprintf("Your lot %d sold for %s.", lotNumber, Euros(hammer))
	case secondChanceOpen:
		return fmt.Sprintf("Your lot %d closed unsold. You can offer it to the top bidder.", lotNumber)
	default:
		return fmt.Sprintf("Your lot %d closed unsold.", lotNumber)
	}
}

// NoticeSecondChanceText is sent to the top bidder of an unsold lot.
func NoticeSecondChanceText(lotNumber, amount int, expiresAt time.Time) string {
	return fmt.Sprintf("Second chance: lot %d can be yours for %s until %s.",
		lotNumber, Euros(amount), RotterdamTime(expiresAt))
}

// NoticeDefaultOfferText is sent to the underbidder after a default.
func NoticeDefaultOfferText(lotNumber, amount int, expiresAt time.Time) string {
	return fmt.Sprintf("Lot %d is offered to you for %s until %s.",
		lotNumber, Euros(amount), RotterdamTime(expiresAt))
}

// NoticeOfferAcceptedText is sent to the consignor when an offer is taken.
func NoticeOfferAcceptedText(lotNumber, amount int) string {
	return fmt.Sprintf("Your lot %d sold by offer for %s.", lotNumber, Euros(amount))
}

// NoticeOfferLapsedText is sent to the consignor when an offer lapses.
func NoticeOfferLapsedText(lotNumber int) string {
	return fmt.Sprintf("The offer on your lot %d has lapsed.", lotNumber)
}

// NoticeInvoiceIssuedText is sent to the buyer when an invoice is issued.
func NoticeInvoiceIssuedText(number string, total Cents, dueAt time.Time) string {
	return fmt.Sprintf("Invoice %s for %s is ready. Payment is due by %s.",
		number, Amount(total), RotterdamTime(dueAt))
}

// NoticeInvoiceDefaultedText is sent to the buyer at the due time.
func NoticeInvoiceDefaultedText(number string) string {
	return fmt.Sprintf("Invoice %s was not paid in time and has defaulted.", number)
}

// NoticeLimitApprovedText is sent to the bidder on approval.
func NoticeLimitApprovedText(limit int) string {
	return fmt.Sprintf("Your spending limit of %s is approved. You can bid now.", Euros(limit))
}

// NoticeBidRemovedText is sent to the bidder whose bid the admin removed.
func NoticeBidRemovedText(lotNumber int) string {
	return fmt.Sprintf("Your bid on lot %d was removed by the saleroom.", lotNumber)
}

// NoticeStatementIssuedText is sent to the consignor when a statement issues.
func NoticeStatementIssuedText(number string) string {
	return fmt.Sprintf("Your statement %s is ready.", number)
}
