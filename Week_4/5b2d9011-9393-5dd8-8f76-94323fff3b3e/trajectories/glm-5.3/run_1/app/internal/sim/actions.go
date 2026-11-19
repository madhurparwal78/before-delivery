package sim

import (
	"math"
	"time"

	"holdfast/internal/maps"
)

// Revive accepts a revive report targeting a downed teammate.
func (r *Room) Revive(playerID, reportID, targetPlayer string, nowMono int64) ReportResult {
	p := r.Players[playerID]
	reject := func(reason string) ReportResult {
		return ReportResult{ReportID: reportID, Type: "revive", Accepted: false, Reason: reason, Tick: r.Tick, Outcome: nil,
			Body: "revive:" + targetPlayer}
	}
	if p == nil || p.Status != Up {
		return reject("not_up")
	}
	if targetPlayer == playerID {
		return reject("self_revive")
	}
	t := r.Players[targetPlayer]
	if t == nil {
		return reject("not_downed")
	}
	if t.Status != Downed {
		return reject("not_downed")
	}
	if math.Hypot(p.X-t.X, p.Z-t.Z) > 2.0 {
		return reject("too_far")
	}
	if t.ReviveUntil == nil || nowMono >= *t.ReviveUntil {
		// The window's end is exclusive.
		return reject("window_closed")
	}
	t.Status = Up
	t.HP = RevivedHP
	t.ReviveUntil = nil
	r.Log(r.Tick, "player_revived", map[string]any{"player": t.ID, "callsign": t.Callsign, "by": playerID})
	return ReportResult{
		ReportID: reportID,
		Type:     "revive",
		Accepted: true,
		Reason:   nil,
		Tick:     r.Tick,
		Outcome:  map[string]any{"revived": t.ID},
		Body:     "revive:" + targetPlayer,
	}
}

// expireReviveWindows downs players whose window has run out.
func (r *Room) expireReviveWindows(nowMono int64) {
	for _, p := range r.Players {
		if p.Status == Downed && p.ReviveUntil != nil && nowMono >= *p.ReviveUntil {
			p.Status = Out
			p.ReviveUntil = nil
			r.Log(r.Tick, "player_out", map[string]any{"player": p.ID, "callsign": p.Callsign})
		}
	}
}

// Purchase applies an ammo-station purchase during an intermission.
type PurchaseOutcome struct {
	PurchaseID        string    `json:"purchase_id"`
	Item              string    `json:"item"`
	UnitPrice         int       `json:"unit_price"`
	PriceEffectiveAt  time.Time `json:"price_effective_at"`
	Balance           int64     `json:"balance"`
}

// Buy applies a purchase's effect and returns the outcome, or a reason.
func (r *Room) Buy(playerID, purchaseID, item string, unitPrice int, effectiveAt time.Time, nowMono int64) (*PurchaseOutcome, string) {
	p := r.Players[playerID]
	if r.Phase != PhaseIntermission {
		return nil, "shop_closed"
	}
	switch item {
	case "ammo_pack":
		if p.Reserve >= ReserveMax {
			return nil, "at_capacity"
		}
		if p.Credits < int64(unitPrice) {
			return nil, "insufficient_credits"
		}
		p.Credits -= int64(unitPrice)
		p.Reserve += 90
		if p.Reserve > ReserveMax {
			p.Reserve = ReserveMax
		}
	case "grenade":
		if p.Grenades >= GrenadesMax {
			return nil, "at_capacity"
		}
		if p.Credits < int64(unitPrice) {
			return nil, "insufficient_credits"
		}
		p.Credits -= int64(unitPrice)
		p.Grenades++
	case "med_kit":
		if p.HP >= MaxHP {
			return nil, "at_capacity"
		}
		if p.Credits < int64(unitPrice) {
			return nil, "insufficient_credits"
		}
		p.Credits -= int64(unitPrice)
		p.HP += 50
		if p.HP > MaxHP {
			p.HP = MaxHP
		}
	default:
		return nil, "unknown_item"
	}
	r.Log(r.Tick, "purchase", map[string]any{
		"player": playerID, "item": item, "unit_price": unitPrice, "purchase_id": purchaseID,
	})
	return &PurchaseOutcome{
		PurchaseID: purchaseID, Item: item, UnitPrice: unitPrice,
		PriceEffectiveAt: effectiveAt, Balance: p.Credits,
	}, ""
}

// Pose judges a convoy pose. It returns the result reason and the vehicle.
func (r *Room) Pose(playerID string, seq int64, x, z, heading float64, nowMono int64) (accepted bool, reason string) {
	v := r.Vehicles[playerID]
	if v == nil {
		return false, "not_racing"
	}
	if seq <= v.LastSeq {
		return false, "stale_seq"
	}
	if v.State == "finished" {
		return false, "finished"
	}
	if v.State == "wrecked" {
		return false, "wrecked"
	}
	if r.Phase != PhaseRace {
		return false, "not_racing"
	}
	elapsedMs := nowMono - v.LastPoseAt
	limit := ConvoyTopSpeed*(float64(elapsedMs)/1000.0) + ConvoyPoseTolerance
	d := maps.Distance(v.X, v.Z, x, z)
	if d > limit {
		return false, "too_fast"
	}

	// An accepted pose whose position is inside a solid block cell or outside
	// the map wrecks the vehicle. It stays at its previous position.
	if !r.Map.Inside(x, z) || r.Map.SolidAt(x, z) {
		v.LastSeq = seq
		v.State = "wrecked"
		resetAt := nowMono + ResetMs
		v.ResetAt = &resetAt
		r.Log(r.Tick, "wrecked", map[string]any{"player": playerID, "checkpoint": v.LastPassedCheckpoint})
		return true, ""
	}

	// Pose accepted.
	v.LastSeq = seq
	v.X, v.Z = x, z
	v.Heading = normalizeAngle(heading)
	v.LastPoseAt = nowMono

	// Checkpoint pass.
	nextID := v.NextCheckpoint
	next, ok := r.Map.CheckpointAt(nextID)
	if ok && maps.Distance(x, z, next.X, next.Z) <= CheckpointRadius {
		v.LastPassedCheckpoint = nextID
		if nextID == "C0" {
			// Passing C0 completes a lap.
			lapMs := nowMono - v.LapStartAt
			v.LapsDone++
			l := lapMs
			v.BestLapMs = betterLap(v.BestLapMs, &l)
			r.Log(r.Tick, "lap", map[string]any{"player": playerID, "lap": v.LapsDone, "lap_ms": lapMs})
			v.LapStartAt = nowMono
			if v.LapsDone >= LapsPerRace {
				v.State = "finished"
				r.Log(r.Tick, "finished", map[string]any{"player": playerID})
			} else {
				v.NextCheckpoint = "C1"
				v.LastPassedCheckpoint = ""
			}
		} else {
			idx := checkpointIndex(nextID)
			v.NextCheckpoint = r.Map.Checkpoints[idx+1].ID
		}
	}
	return true, ""
}

func betterLap(best *int64, l *int64) *int64 {
	if best == nil || *l < *best {
		v := *l
		return &v
	}
	return best
}

func checkpointIndex(id string) int {
	for i, c := range SaltpanCheckpoints {
		if c.ID == id {
			return i
		}
	}
	return -1
}

// SaltpanCheckpoints mirrors the convoy map's checkpoints for checkpointIndex.
var SaltpanCheckpoints = []struct {
	ID string
	X  float64
	Z  float64
}{
	{"C1", 100, 12},
	{"C2", 180, 60},
	{"C3", 100, 108},
	{"C4", 20, 60},
	{"C0", 24, 11},
}

// resetWrecked resets vehicles whose reset delay has passed, placing them at
// their last passed checkpoint facing the next one.
func (r *Room) resetWrecked(nowMono int64) {
	for _, v := range r.Vehicles {
		if v.State != "wrecked" || v.ResetAt == nil {
			continue
		}
		if nowMono < *v.ResetAt {
			continue
		}
		v.State = "running"
		v.ResetAt = nil
		cpID := v.LastPassedCheckpoint
		if cpID == "" {
			cpID = "C0"
		}
		cp, _ := r.Map.CheckpointAt(cpID)
		v.X, v.Z = cp.X, cp.Z
		next, ok := r.Map.CheckpointAt(v.NextCheckpoint)
		if ok {
			v.Heading = normalizeAngle(math.Atan2(next.Z-cp.Z, next.X-cp.X) * 180 / math.Pi)
		}
		v.LastPoseAt = nowMono
		r.Log(r.Tick, "reset", map[string]any{"player": v.Player})
	}
}

// LapElapsed returns the vehicle's lap elapsed milliseconds.
func (r *Room) LapElapsed(v *Vehicle, nowMono int64) int64 {
	if v.State == "finished" {
		return v.LapElapsedMs
	}
	return nowMono - v.LapStartAt
}
