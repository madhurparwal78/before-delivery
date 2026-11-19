package main

// increment is the published bid increment for a price.
func increment(price int) int {
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

// bidRecord is one remaining (not removed) bid in acceptance order.
type bidRecord struct {
	ID       string
	PersonID string
	Max      int
}

// standing is the price and leader the remaining bids produce.
type standing struct {
	Price      int // 0 until the first bid
	LeaderID   string
	LeaderMax  int
	PriceAfter []int // price after each bid, in the same order as the bids
	ReserveMet bool  // the leader's maximum is at least the reserve
}

// sold reports whether a lot closing on this standing is hammered: it has a leader and the reserve is met.
func (s standing) sold() bool { return s.LeaderID != "" && s.ReserveMet }

// resolve is the one place that decides price and leader. Bids, removals,
// closes and offers all call it with the remaining bids in acceptance order.
func resolve(bids []bidRecord, opening, reserve int) standing {
	var s standing
	for _, b := range bids {
		switch {
		case s.LeaderID == "":
			s.LeaderID, s.LeaderMax, s.Price = b.PersonID, b.Max, opening
		case b.PersonID == s.LeaderID:
			s.LeaderMax = b.Max
		case b.Max > s.LeaderMax:
			s.Price = min(b.Max, s.LeaderMax+increment(s.LeaderMax))
			s.LeaderID, s.LeaderMax = b.PersonID, b.Max
		default:
			s.Price = max(s.Price, min(s.LeaderMax, b.Max+increment(b.Max)))
		}
		if s.LeaderMax >= reserve && s.Price < reserve {
			s.Price = reserve
		}
		s.PriceAfter = append(s.PriceAfter, s.Price)
	}
	s.ReserveMet = s.LeaderID != "" && s.LeaderMax >= reserve
	return s
}

// asking is the next bid: the opening bid before any bid, else price plus increment.
func asking(price, opening int) int {
	if price == 0 {
		return opening
	}
	return price + increment(price)
}
