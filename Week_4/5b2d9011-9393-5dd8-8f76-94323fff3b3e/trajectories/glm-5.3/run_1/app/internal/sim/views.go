package sim

import (
	"strconv"
	"time"

	"holdfast/internal/clock"
)

// AllReady reports whether every seated player is ready.
func (r *Room) AllReady() bool {
	for _, p := range r.Players {
		if !p.Ready {
			return false
		}
	}
	return len(r.Players) > 0
}

// LeavePublic starts a leave: the grace at once during a match; in the lobby
// the seat is freed immediately.
func (r *Room) LeavePublic(p *Player, nowMono int64) {
	r.Leave(p, nowMono)
}

// PlayerView returns the player's published view.
func (r *Room) PlayerView(playerID string) map[string]any {
	p, ok := r.Players[playerID]
	if !ok {
		return nil
	}
	view := map[string]any{
		"id": p.ID, "callsign": p.Callsign, "seat": p.Seat,
		"mag": p.Mag, "reserve": p.Reserve, "grenades": p.Grenades,
		"credits": p.Credits, "score": p.Score, "kills": p.Kills, "hp": p.HP,
		"status": string(p.Status),
	}
	return view
}

// VehicleView returns the vehicle's published view.
func (r *Room) VehicleView(playerID string) map[string]any {
	v := r.Vehicles[playerID]
	if v == nil {
		return nil
	}
	view := map[string]any{
		"player": v.Player, "state": v.State, "x": round2(v.X), "z": round2(v.Z),
		"heading": round2(v.Heading), "last_seq": v.LastSeq,
		"next_checkpoint": v.NextCheckpoint, "laps_done": v.LapsDone,
		"best_lap_ms": v.BestLapMs,
	}
	if v.ResetAt != nil {
		view["reset_remaining_ms"] = *v.ResetAt - r.Clock.Mono()
	} else {
		view["reset_remaining_ms"] = nil
	}
	return view
}

// strconvFormat renders a float for report bodies.
func strconvFormat(f float64) string {
	return strconv.FormatFloat(f, 'g', -1, 64)
}

// clockInstant formats an instant.
func clockInstant(t time.Time) string {
	return clock.Instant(t)
}
