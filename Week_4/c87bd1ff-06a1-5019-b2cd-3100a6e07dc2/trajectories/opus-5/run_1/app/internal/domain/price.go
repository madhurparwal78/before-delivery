package domain

// Increment is the published bid step for a current price, in whole euros.
func Increment(price int) int {
	switch {
	case price < 100:
		return 5
	case price < 500:
		return 10
	case price < 1000:
		return 25
	case price < 5000:
		return 50
	default:
		return 100
	}
}

// Bid is one accepted, not removed maximum, in acceptance order.
type Bid struct {
	ID       string
	BidderID string
	Paddle   int
	MaxEuros int
	// PriceAfter is filled in by Replay: the lot's price once this bid is applied.
	PriceAfter int
}

// Standing is a lot's price and leader worked out from its remaining bids.
// Every caller — bids, removals, closes, offers and statements alike — reads
// the lot's standing from Replay and nowhere else.
type Standing struct {
	HasLeader  bool
	LeaderID   string
	LeaderPddl int
	LeaderMax  int
	Price      int
	ReserveMet bool
	BidCount   int
	Asking     int
}

// Replay applies the remaining bids in acceptance order and returns the lot's
// standing. It fills each bid's PriceAfter as it goes.
func Replay(openingBid, reserve int, bids []Bid) Standing {
	s := Standing{BidCount: len(bids)}
	for i := range bids {
		b := &bids[i]
		switch {
		case !s.HasLeader:
			s.HasLeader = true
			s.LeaderID = b.BidderID
			s.LeaderPddl = b.Paddle
			s.LeaderMax = b.MaxEuros
			s.Price = openingBid
		case b.BidderID == s.LeaderID:
			s.LeaderMax = b.MaxEuros
		case b.MaxEuros > s.LeaderMax:
			s.Price = min(b.MaxEuros, s.LeaderMax+Increment(s.LeaderMax))
			s.LeaderID = b.BidderID
			s.LeaderPddl = b.Paddle
			s.LeaderMax = b.MaxEuros
		default:
			if cand := min(s.LeaderMax, b.MaxEuros+Increment(b.MaxEuros)); cand > s.Price {
				s.Price = cand
			}
		}
		if s.LeaderMax >= reserve && s.Price < reserve {
			s.Price = reserve
		}
		b.PriceAfter = s.Price
	}
	s.ReserveMet = s.HasLeader && s.LeaderMax >= reserve
	if s.HasLeader {
		s.Asking = s.Price + Increment(s.Price)
	} else {
		s.Asking = openingBid
	}
	return s
}

// Underbidder is the bidder other than the winner holding the highest maximum
// on the lot, the earlier bid taking a tie. It is the recipient of a default
// offer, and the offer amount is that maximum.
func Underbidder(winnerID string, bids []Bid) (Bid, bool) {
	best := Bid{}
	found := false
	for _, b := range bids {
		if b.BidderID == winnerID {
			continue
		}
		if !found || b.MaxEuros > best.MaxEuros {
			best = b
			found = true
		}
	}
	return best, found
}
