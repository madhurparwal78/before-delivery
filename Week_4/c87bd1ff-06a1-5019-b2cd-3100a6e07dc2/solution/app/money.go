package main

import (
	"fmt"
	"strconv"
	"strings"
)

// Money is held as integer euro cents; bids and limits are whole euros.

func euros(n int) string { return "€" + commas(int64(n)) }

func amountText(cents int64) string {
	return fmt.Sprintf("€%s.%02d", commas(cents/100), cents%100)
}

// decimalText renders cents as the API's two-decimal string, e.g. "1628.13".
func decimalText(cents int64) string {
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

func commas(n int64) string {
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// parseCents reads "125.50" (digits, a point, exactly two decimals).
func parseCents(s string) (int64, bool) {
	whole, frac, found := strings.Cut(s, ".")
	if !found || len(frac) != 2 || whole == "" || len(whole) > 12 {
		return 0, false
	}
	for _, part := range []string{whole, frac} {
		for _, r := range part {
			if r < '0' || r > '9' {
				return 0, false
			}
		}
	}
	w, _ := strconv.ParseInt(whole, 10, 64)
	f, _ := strconv.ParseInt(frac, 10, 64)
	return w*100 + f, true
}

// premiumCents: 25 % of the hammer up to €2,000 plus 20 % of the part above, exact in cents.
func premiumCents(hammerEuros int) int64 {
	h := int64(hammerEuros)
	low := min(h, 2000)
	high := max(h-2000, 0)
	return low*25 + high*20
}

// vatCents: 21 % of the premium, rounded half up to the cent.
func vatCents(premium int64) int64 { return (premium*21 + 50) / 100 }

// commissionCents: 12.5 % of the hammer rounded half up, at least €15.00.
func commissionCents(hammerEuros int) int64 {
	c := (int64(hammerEuros)*100*125 + 500) / 1000
	return max(c, 1500)
}
