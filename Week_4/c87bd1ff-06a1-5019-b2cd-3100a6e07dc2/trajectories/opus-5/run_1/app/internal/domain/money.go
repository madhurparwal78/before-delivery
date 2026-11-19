// Package domain holds the saleroom's rules: the increment table, the
// price-and-leader rule, the money arithmetic and the state machines.
package domain

import (
	"fmt"
	"strconv"
	"strings"
)

// Cents is an amount of euros held as a whole number of cents. Money is never
// held as floating point.
type Cents int64

// EurosToCents lifts a whole-euro amount to cents.
func EurosToCents(euros int) Cents { return Cents(euros) * 100 }

// divRoundHalfUp divides a non-negative numerator by a positive denominator,
// rounding halves away from zero.
func divRoundHalfUp(num, den int64) int64 { return (2*num + den) / (2 * den) }

// PremiumCeiling is the hammer up to which the higher premium rate applies.
const premiumBandEuros = 2000

const (
	premiumLowRatePercent  = 25
	premiumHighRatePercent = 20
	vatRatePercent         = 21
	commissionRatePermille = 125
	commissionMinimum      = Cents(1500)
	// MaxBidEuros is the ceiling on any single maximum.
	MaxBidEuros = 1000000
)

// Premium is the buyer's premium on a hammer price: 25 % of the hammer up to
// and including the band, plus 20 % of any part above it, rounded half up to
// the cent exactly once.
func Premium(hammer Cents) Cents {
	band := Cents(premiumBandEuros) * 100
	low := hammer
	var high Cents
	if hammer > band {
		low = band
		high = hammer - band
	}
	num := premiumLowRatePercent*int64(low) + premiumHighRatePercent*int64(high)
	return Cents(divRoundHalfUp(num, 100))
}

// VAT is 21 % of the premium only, rounded half up to the cent. The hammer
// carries no VAT because the house sells under the margin scheme.
func VAT(premium Cents) Cents {
	return Cents(divRoundHalfUp(vatRatePercent*int64(premium), 100))
}

// Commission is the seller commission on a sold lot: 12.5 % of the hammer,
// rounded half up to the cent, with a per-lot minimum.
func Commission(hammer Cents) Cents {
	c := Cents(divRoundHalfUp(commissionRatePermille*int64(hammer), 1000))
	if c < commissionMinimum {
		return commissionMinimum
	}
	return c
}

// String writes an amount as euros and cents with exactly two decimals, the
// form invoice, payment and statement amounts take on the wire.
func (c Cents) String() string {
	neg := c < 0
	v := int64(c)
	if neg {
		v = -v
	}
	s := fmt.Sprintf("%d.%02d", v/100, v%100)
	if neg {
		return "-" + s
	}
	return s
}

// ParseCents reads an amount written in euros with exactly two decimals, the
// form the cashier's payment amounts take.
func ParseCents(s string) (Cents, bool) {
	whole, frac, ok := strings.Cut(s, ".")
	if !ok || len(frac) != 2 || whole == "" {
		return 0, false
	}
	if strings.HasPrefix(whole, "+") || strings.HasPrefix(whole, "-") {
		return 0, false
	}
	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil || w > 100000000 {
		return 0, false
	}
	f, err := strconv.ParseInt(frac, 10, 64)
	if err != nil || f < 0 {
		return 0, false
	}
	return Cents(w*100 + f), true
}
