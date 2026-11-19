package domain

import "fmt"

// The published sentences the API returns. Feedback states owns the wording.
const (
	MsgNotWholeEuros       = "Enter a whole number of euros."
	MsgAboveCeiling        = "Enter no more than €1,000,000."
	MsgEstimateAmount      = "Enter a whole number of euros from €1 to €1,000,000."
	MsgLowAboveHigh        = "The low estimate must not be above the high estimate."
	MsgOpeningAboveLow     = "The opening bid must not be above the low estimate."
	MsgReserveOutOfBand    = "The reserve must be between the opening bid and the low estimate."
	MsgConditionTooLong    = "Condition notes can be up to 2,000 characters."
	MsgChoosePortrait      = "Choose a portrait."
	MsgChooseRole          = "Choose bid or consign."
	MsgEnterFullName       = "Enter your full name."
	MsgEnterPhone          = "Enter a phone number."
	MsgEnterAddress        = "Enter your address."
	MsgChooseCategory      = "Choose wristwatch or film camera."
	MsgTitleLength         = "Enter a title of up to 120 characters."
	MsgDescriptionLength   = "Describe the item in up to 2,000 characters."
	MsgSpendingLimitRange  = "Enter a spending limit between €100 and €1,000,000."
	MsgSaleMustEndFuture   = "The sale must end in the future."
	MsgAddLotBeforePublish = "Add at least one lot before publishing."
	MsgPaymentMalformed    = "Enter an amount in euros and cents, for example 125.50."
	MsgOfferAboveTopBid    = "That is above what the top bidder offered."
	MsgUnexpectedFailure   = "Something went wrong in the saleroom. Try again."
	MsgForbiddenOrigin     = "Requests must come from the saleroom."
	MsgSaleTitleLength     = "Enter a title of up to 80 characters."
	MsgSaleEndsForm        = "Enter the end as YYYY-MM-DD HH:MM, Rotterdam time."
	MsgFirstLotNumber      = "Enter a first lot number from 1 to 9999."
	MsgReasonLength        = "Enter a reason of up to 300 characters."
	MsgNoteLength          = "Enter a note of up to 300 characters."
	MsgLotIDsRequired      = "Choose the lots for this sale."
	MsgMethodRequired      = "Choose a payment method."
)

// MsgAtLeast is the field error shown below the next bid.
func MsgAtLeast(euros int) string { return fmt.Sprintf("Enter at least %s.", Euros(euros)) }

// MsgRaiseOwnMaximum is the field error for a leader who did not raise.
func MsgRaiseOwnMaximum(euros int) string {
	return fmt.Sprintf("Enter more than your maximum of %s.", Euros(euros))
}

// MsgPastSpendingLimit is the field error for a bid beyond the limit.
func MsgPastSpendingLimit(euros int) string {
	return fmt.Sprintf("This bid would take you past your spending limit of %s.", Euros(euros))
}

// MsgOfferBelowFinal is the consignor's second-chance field error.
func MsgOfferBelowFinal(euros int) string {
	return fmt.Sprintf("Offer at least %s, the lot's final price.", Euros(euros))
}

// MsgMoreThanOwed is the cashier's overpayment field error.
func MsgMoreThanOwed(outstanding Cents) string {
	return fmt.Sprintf("That is more than the %s still owed.", Amount(outstanding))
}

// MsgInvoiceDefaulted is the cashier's error for a defaulted invoice.
func MsgInvoiceDefaulted(number string) string {
	return fmt.Sprintf("Invoice %s has defaulted and can no longer be paid.", number)
}

// MsgStatementLocked is the admin's error for an issued statement.
func MsgStatementLocked(number string) string {
	return fmt.Sprintf("Statement %s is issued and locked.", number)
}
