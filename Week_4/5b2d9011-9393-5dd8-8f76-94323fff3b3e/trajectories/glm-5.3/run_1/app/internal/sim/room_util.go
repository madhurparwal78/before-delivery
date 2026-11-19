package sim

import (
	"sort"
)

// Log appends an event, keeping the latest 100.
func (r *Room) Log(tick int64, typ string, data map[string]any) Event {
	r.EventSeq++
	ev := Event{Seq: r.EventSeq, Type: typ, Tick: tick, Data: data}
	r.Events = append(r.Events, ev)
	if len(r.Events) > 100 {
		r.Events = r.Events[len(r.Events)-100:]
	}
	return ev
}

// SortedPlayerIDs returns seated player ids in seat order.
func (r *Room) SortedPlayerIDs() []string {
	seats := make([]int, 0, len(r.Seats))
	for seat := range r.Seats {
		seats = append(seats, seat)
	}
	sort.Ints(seats)
	out := make([]string, 0, len(seats))
	for _, seat := range seats {
		out = append(out, r.Seats[seat])
	}
	return out
}

// PlayersInSeatOrder returns the players in seat order.
func (r *Room) PlayersInSeatOrder() []*Player {
	ids := r.SortedPlayerIDs()
	out := make([]*Player, 0, len(ids))
	for _, id := range ids {
		if p, ok := r.Players[id]; ok {
			out = append(out, p)
		}
	}
	return out
}

// AnySeatFree returns the lowest free seat, and whether one exists.
func (r *Room) AnySeatFree() (int, bool) {
	for seat := 1; seat <= 4; seat++ {
		if _, taken := r.Seats[seat]; !taken {
			return seat, true
		}
	}
	return 0, false
}

// FreeSeatCount counts free seats.
func (r *Room) FreeSeatCount() int {
	n := 0
	for seat := 1; seat <= 4; seat++ {
		if _, taken := r.Seats[seat]; !taken {
			n++
		}
	}
	return n
}

// LowestConnectedSeat returns the player id holding the lowest connected seat.
func (r *Room) LowestConnectedSeat() (string, bool) {
	for seat := 1; seat <= 4; seat++ {
		id, taken := r.Seats[seat]
		if !taken {
			continue
		}
		p := r.Players[id]
		if p != nil && p.Connection == Connected {
			return id, true
		}
	}
	return "", false
}

// UpCount counts players who are up.
func (r *Room) UpCount() int {
	n := 0
	for _, p := range r.Players {
		if p.Status == Up && p.Connection != Left {
			n++
		}
	}
	return n
}
