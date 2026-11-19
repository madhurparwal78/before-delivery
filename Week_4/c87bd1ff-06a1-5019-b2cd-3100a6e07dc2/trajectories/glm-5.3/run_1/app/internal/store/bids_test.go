package store

import (
	"testing"
	"time"
)

// The brief's worked example: opening bid €1,600, reserve €2,200.
func TestApplyBidsWorkedExample(t *testing.T) {
	opening := 1600
	reserve := 2200
	lot := &LotFull{Lot: Lot{OpeningBid: &opening, Reserve: &reserve}}
	byA := Bid{ID: "a1", BidderID: "A", MaxAmount: 1700}
	price, lead, met := applyBids(lot, &byA)
	if price != 1600 || lead == nil || lead.BidderID != "A" || met {
		t.Fatalf("A bids 1700: price %d leader %v met %v", price, lead, met)
	}
	byB := Bid{ID: "b1", BidderID: "B", MaxAmount: 1900}
	lot.Bids = append(lot.Bids, byA)
	price, lead, met = applyBids(lot, &byB)
	if price != 1750 || lead.BidderID != "B" || met {
		t.Fatalf("B bids 1900, leads at 1750: price %d leader %v met %v", price, lead, met)
	}
	// A raises to 2100: leads at min(2100, 1900+inc(1900)=1950).
	lot.Bids = append(lot.Bids, byB)
	byA2 := Bid{ID: "a2", BidderID: "A", MaxAmount: 2100}
	price, lead, met = applyBids(lot, &byA2)
	if price != 1950 || lead.BidderID != "A" || met {
		t.Fatalf("A raises to 2100: price %d leader %v met %v", price, lead, met)
	}
	// B bids 2300: leads at min(2300, 2100+inc(2100)=2150), then the reserve
	// rule lifts the price to 2200 and the reserve is met.
	lot.Bids = append(lot.Bids, byA2)
	byB3 := Bid{ID: "b3", BidderID: "B", MaxAmount: 2300}
	price, lead, met = applyBids(lot, &byB3)
	if price != 2200 || lead.BidderID != "B" || !met {
		t.Fatalf("B bids 2300: price %d leader %v met %v (want 2200 B, met)", price, lead, met)
	}
}

func TestApplyBidsEqualMaximums(t *testing.T) {
	opening := 100
	lot := &LotFull{Lot: Lot{OpeningBid: &opening}}
	first := Bid{ID: "1", BidderID: "A", MaxAmount: 200}
	lot.Bids = append(lot.Bids, first)
	price, lead, _ := applyBids(lot, nil)
	if price != 100 || lead.BidderID != "A" {
		t.Fatalf("first bid: price %d leader %v", price, lead)
	}
	second := Bid{ID: "2", BidderID: "B", MaxAmount: 200}
	lot.Bids = append(lot.Bids, second)
	price, lead, _ = applyBids(lot, nil)
	if price != 200 || lead.BidderID != "A" {
		t.Fatalf("equal maximums go to the earlier bid at that maximum: price %d leader %v", price, lead)
	}
}

func TestLeaderRaiseNeverRaisesPrice(t *testing.T) {
	opening := 100
	lot := &LotFull{Lot: Lot{OpeningBid: &opening}}
	lot.Bids = []Bid{{ID: "1", BidderID: "A", MaxAmount: 200}}
	raise := Bid{ID: "2", BidderID: "A", MaxAmount: 400}
	price, lead, _ := applyBids(lot, &raise)
	if price != 100 || lead.BidderID != "A" {
		t.Fatalf("leader raise: price %d leader %v", price, lead)
	}
}

func TestIncrementTable(t *testing.T) {
	cases := []struct {
		price, want int
	}{
		{0, 5}, {99, 5}, {100, 10}, {499, 10}, {500, 25}, {999, 25},
		{1000, 50}, {4999, 50}, {5000, 100}, {100000, 100},
	}
	for _, c := range cases {
		if got := IncrementFor(c.price); got != c.want {
			t.Errorf("increment(%d) = %d, want %d", c.price, got, c.want)
		}
	}
}

func TestPremiumAndVAT(t *testing.T) {
	cases := []struct {
		hammer, premium, vat int
	}{
		{1250, 31250, 6563},
		{2450, 59000, 12390},
		{85, 2125, 446},
		{2000, 50000, 10500},
		{2001, 50020, 10504},
	}
	for _, c := range cases {
		p := PremiumCents(c.hammer)
		if p != c.premium {
			t.Errorf("premium(%d) = %d, want %d", c.hammer, p, c.premium)
		}
		if v := VatCents(p); v != c.vat {
			t.Errorf("vat(%d) = %d, want %d", p, v, c.vat)
		}
	}
}

func TestCommission(t *testing.T) {
	if c := CommissionCents(1250); c != 15625 {
		t.Errorf("commission(1250) = %d, want 15625", c)
	}
	if c := CommissionCents(85); c != 1500 {
		t.Errorf("commission(85) = %d, want 1500", c)
	}
	if c := CommissionCents(100); c != 1500 {
		t.Errorf("commission(100) = %d, want 1500", c)
	}
	if c := CommissionCents(121); c != 1513 {
		t.Errorf("commission(121) = %d, want 1513", c)
	}
}

func TestTimeLeftFormat(t *testing.T) {
	cases := []struct {
		secs int
		want string
	}{
		{30, "0:30"},
		{3600, "01:00:00"},
		{90000, "1d 01:00:00"},
	}
	for _, c := range cases {
		if got := TimeLeft(secDur(c.secs)); got != c.want {
			t.Errorf("timeLeft(%d) = %s, want %s", c.secs, got, c.want)
		}
	}
}

func TestRoundingHalfUp(t *testing.T) {
	// 21% of 31250 hundredths = 6562.5 hundredths of a cent -> 6563 cents.
	if got := VatCents(31250); got != 6563 {
		t.Errorf("vat half up: %d", got)
	}
	// 12.5% of €121 = €15.125 -> €15.13.
	if got := CommissionCents(121); got != 1513 {
		t.Errorf("commission half up: %d", got)
	}
	// 20% of the €1 above €2000: 2001 -> €500.20.
	if got := PremiumCents(2001); got != 50020 {
		t.Errorf("premium tier: %d", got)
	}
}

func secDur(s int) (d time.Duration) { return time.Duration(s) * time.Second }
