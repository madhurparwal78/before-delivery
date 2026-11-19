package sim

import (
	"time"

	"holdfast/internal/clock"
)

// Snapshot is the published room state, exactly as the API returns it.
type Snapshot struct {
	Code              string        `json:"code"`
	Mode              string        `json:"mode"`
	Phase             string        `json:"phase"`
	Wave              int           `json:"wave"`
	PhaseRemainingMs  *int64        `json:"phase_remaining_ms"`
	Tick              int64         `json:"tick"`
	ServerTime        string        `json:"server_time"`
	Host              string        `json:"host"`
	NightID           *string       `json:"night_id"`
	InviteExpiresAt   string        `json:"invite_expires_at"`
	InviteRemainingMs *int64        `json:"invite_remaining_ms"`
	Degraded          *string       `json:"degraded"`
	Result            *string       `json:"result"`
	Players           []PlayerSnap  `json:"players"`
	Enemies           []EnemySnap   `json:"enemies"`
	Barrels           []BarrelSnap  `json:"barrels"`
	Grenades          []GrenadeSnap `json:"grenades"`
	Shop              ShopSnap      `json:"shop"`
	Vehicles          []VehicleSnap `json:"vehicles"`
	Events            []EventSnap   `json:"events"`
}

// PlayerSnap is one player in the snapshot.
type PlayerSnap struct {
	ID              string  `json:"id"`
	Callsign        string  `json:"callsign"`
	Seat            int     `json:"seat"`
	Ready           bool    `json:"ready"`
	Connection      string  `json:"connection"`
	GraceRemainingMs *int64 `json:"grace_remaining_ms"`
	Status          string  `json:"status"`
	HP              int     `json:"hp"`
	X               float64 `json:"x"`
	Z               float64 `json:"z"`
	Aim             float64 `json:"aim"`
	LastInputSeq    int64   `json:"last_input_seq"`
	Mag             int     `json:"mag"`
	Reserve         int     `json:"reserve"`
	Grenades        int     `json:"grenades"`
	ReloadRemainingMs *int64 `json:"reload_remaining_ms"`
	ReviveRemainingMs *int64 `json:"revive_remaining_ms"`
	Credits         int64   `json:"credits"`
	Score           int64   `json:"score"`
	Kills           int     `json:"kills"`
}

// EnemySnap is one enemy in the snapshot.
type EnemySnap struct {
	ID    string  `json:"id"`
	Kind  string  `json:"kind"`
	State string  `json:"state"`
	HP    int     `json:"hp"`
	X     float64 `json:"x"`
	Z     float64 `json:"z"`
}

// BarrelSnap is one barrel in the snapshot.
type BarrelSnap struct {
	ID        string  `json:"id"`
	HP        int     `json:"hp"`
	X         float64 `json:"x"`
	Z         float64 `json:"z"`
	Destroyed bool    `json:"destroyed"`
}

// GrenadeSnap is one grenade in the snapshot.
type GrenadeSnap struct {
	ID               string  `json:"id"`
	Owner            string  `json:"owner"`
	X                float64 `json:"x"`
	Z                float64 `json:"z"`
	FuseRemainingMs int64   `json:"fuse_remaining_ms"`
}

// ShopSnap is the shop in the snapshot.
type ShopSnap struct {
	Open  bool      `json:"open"`
	Items []ItemSnap `json:"items"`
}

// ItemSnap is one shop item.
type ItemSnap struct {
	Item           string `json:"item"`
	Name           string `json:"name"`
	Price          int    `json:"price"`
	NextPrice      *int   `json:"next_price"`
	NextChangeInMs *int64 `json:"next_change_in_ms"`
}

// VehicleSnap is one vehicle in the snapshot.
type VehicleSnap struct {
	Player         string  `json:"player"`
	State          string  `json:"state"`
	X              float64 `json:"x"`
	Z              float64 `json:"z"`
	Heading        float64 `json:"heading"`
	LastSeq        int64   `json:"last_seq"`
	NextCheckpoint string  `json:"next_checkpoint"`
	LapsDone       int     `json:"laps_done"`
	LapElapsedMs   int64   `json:"lap_elapsed_ms"`
	BestLapMs      *int64  `json:"best_lap_ms"`
	ResetRemainingMs *int64 `json:"reset_remaining_ms"`
}

// EventSnap is one event in the snapshot.
type EventSnap struct {
	Seq  int64          `json:"seq"`
	Type string         `json:"type"`
	Tick int64          `json:"tick"`
	Data map[string]any `json:"-"`
}

// ShopItemSource supplies the current prices to the snapshot.
type ShopItemSource func() []ShopItem

// ShopItem is one item's current price.
type ShopItem struct {
	Item           string
	Name           string
	Price          int
	NextPrice      *int
	NextChangeInMs *int64
}

// SnapshotState renders the room state. items supplies live prices.
func (r *Room) SnapshotState(now time.Time, nowMono int64, items []ShopItem) Snapshot {
	snap := Snapshot{
		Code:    r.Code,
		Mode:    r.Mode,
		Phase:   string(r.Phase),
		Wave:    r.Wave,
		Tick:    r.Tick,
		ServerTime: clock.Instant(now),
		Host:    r.HostID,
		InviteExpiresAt: clock.Instant(r.InviteExpiresAt),
		Degraded: degradedPtr(r.Degraded),
		Result:  resultPtr(r.Result),
	}
	if r.NightID != "" {
		n := r.NightID
		snap.NightID = &n
	}
	if r.Phase == PhaseCountdown || r.Phase == PhaseIntermission {
		rem := r.phaseEndMono - nowMono
		if rem < 0 {
			rem = 0
		}
		snap.PhaseRemainingMs = &rem
	}
	if r.Phase == PhaseLobby || r.Phase == PhaseCountdown {
		remMs := r.InviteExpiresAt.Sub(now).Milliseconds()
		if remMs < 0 {
			remMs = 0
		}
		if remMs > 0 || now.Before(r.InviteExpiresAt) {
			snap.InviteRemainingMs = &remMs
		}
	}
	for _, p := range r.PlayersInSeatOrder() {
		ps := PlayerSnap{
			ID: p.ID, Callsign: p.Callsign, Seat: p.Seat, Ready: p.Ready,
			Connection: string(p.Connection), Status: string(p.Status),
			HP: p.HP, X: round2(p.X), Z: round2(p.Z), Aim: round2(p.Aim),
			LastInputSeq: p.LastInputSeq, Mag: p.Mag, Reserve: p.Reserve,
			Grenades: p.Grenades, Credits: p.Credits, Score: p.Score, Kills: p.Kills,
		}
		if p.GraceUntil != nil {
			rem := *p.GraceUntil - nowMono
			if rem < 0 {
				rem = 0
			}
			ps.GraceRemainingMs = &rem
		}
		if p.ReloadUntil != nil {
			rem := *p.ReloadUntil - nowMono
			if rem < 0 {
				rem = 0
			}
			ps.ReloadRemainingMs = &rem
		}
		if p.ReviveUntil != nil {
			rem := *p.ReviveUntil - nowMono
			if rem < 0 {
				rem = 0
			}
			ps.ReviveRemainingMs = &rem
		}
		snap.Players = append(snap.Players, ps)
	}
	for _, e := range sortedEnemies(r.Enemies) {
		snap.Enemies = append(snap.Enemies, EnemySnap{ID: e.ID, Kind: e.Kind, State: e.State, HP: e.HP, X: round2(e.X), Z: round2(e.Z)})
	}
	for _, b := range sortedBarrels(r.Barrels) {
		snap.Barrels = append(snap.Barrels, BarrelSnap{ID: b.ID, HP: b.HP, X: b.X, Z: b.Z, Destroyed: b.Destroyed})
	}
	for _, g := range sortedGrenades(r.Grenades) {
		rem := g.DetonateAt - nowMono
		if rem < 0 {
			rem = 0
		}
		snap.Grenades = append(snap.Grenades, GrenadeSnap{ID: g.ID, Owner: g.Owner, X: g.X, Z: g.Z, FuseRemainingMs: rem})
	}
	snap.Shop.Open = r.Phase == PhaseIntermission
	for _, it := range items {
		snap.Shop.Items = append(snap.Shop.Items, ItemSnap{
			Item: it.Item, Name: it.Name, Price: it.Price,
			NextPrice: it.NextPrice, NextChangeInMs: it.NextChangeInMs,
		})
	}
	for _, v := range r.vehiclesInSeatOrder() {
		vs := VehicleSnap{
			Player: v.Player, State: v.State, X: round2(v.X), Z: round2(v.Z),
			Heading: round2(v.Heading), LastSeq: v.LastSeq,
			NextCheckpoint: v.NextCheckpoint, LapsDone: v.LapsDone,
			BestLapMs: v.BestLapMs,
		}
		if r.Phase == PhaseRace && v.State == "running" {
			elapsed := nowMono - v.LapStartAt
			if elapsed < 0 {
				elapsed = 0
			}
			vs.LapElapsedMs = elapsed
		} else {
			vs.LapElapsedMs = v.LapElapsedMs
		}
		if v.ResetAt != nil {
			rem := *v.ResetAt - nowMono
			if rem < 0 {
				rem = 0
			}
			vs.ResetRemainingMs = &rem
		}
		snap.Vehicles = append(snap.Vehicles, vs)
	}
	// Events carry the latest 100 in seq order.
	events := r.Events
	if len(events) > 100 {
		events = events[len(events)-100:]
	}
	for _, ev := range events {
		es := EventSnap{Seq: ev.Seq, Type: ev.Type, Tick: ev.Tick, Data: ev.Data}
		snap.Events = append(snap.Events, es)
	}
	return snap
}

func degradedPtr(d string) *string {
	if d == "" {
		return nil
	}
	v := d
	return &v
}

func resultPtr(res string) *string {
	if res == "" {
		return nil
	}
	v := res
	return &v
}
