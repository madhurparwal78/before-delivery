package rooms

import (
	"context"
	"time"

	"holdfast/internal/apperr"
	"holdfast/internal/clock"
	"holdfast/internal/sim"
	"holdfast/internal/store"
)

// FinishRecord is what history needs when a match ends.
type FinishRecord struct {
	Code         string
	Mode         string
	Result       string
	WavesCleared int
	NightID      string
	StartedAt    time.Time
	Players      []FinishPlayer
	Laps         []store.LapRow
}

// FinishPlayer is one player's results.
type FinishPlayer struct {
	Seat          int
	PlayerID      string
	Callsign      string
	Score         int64
	Kills         int
	CreditsEarned int64
	BestLapMs     *int64
}

// rewriteRegistry rewrites a room's registry keys in Valkey.
func (h *Hub) rewriteRegistry(r *sim.Room) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	h.valkey.writeRoomKey(ctx, r)
	for _, p := range r.PlayersInSeatOrder() {
		if p.Connection == sim.Connected {
			h.valkey.renewSeatLease(ctx, r.Code, p.ID)
		}
	}
}

// touch renews a seated player's lease in the sim and the registry.
func (h *Hub) touch(r *sim.Room, p *sim.Player) {
	r.Touch(p, h.clock.Mono())
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	h.valkey.renewSeatLease(ctx, r.Code, p.ID)
}

// StartGrace starts a reconnect grace for a player.
func (h *Hub) StartGrace(r *sim.Room, p *sim.Player) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	h.valkey.startGrace(ctx, r.Code, p.ID)
}

// ClearGrace clears a reconnect grace.
func (h *Hub) ClearGrace(r *sim.Room, p *sim.Player) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	h.valkey.clearGrace(ctx, r.Code, p.ID)
}

// removeRoom clears a room's registry keys.
func (h *Hub) removeRoom(code string) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	h.valkey.removeRoomKey(ctx, code)
}

// ReconnectPlayer reconnects a disconnected player while their grace has time
// left.
func (h *Hub) ReconnectPlayer(r *sim.Room, playerID string) (*sim.Player, error) {
	r.RoomLock()
	defer r.RoomUnlock()
	p, ok := r.PlayerSeatedID(playerID)
	if !ok {
		return nil, apperr.SeatReleased(r.Code)
	}
	if p.Connection == sim.Disconnected {
		if !r.Reconnect(p, h.clock.Mono()) {
			return nil, apperr.SeatReleased(r.Code)
		}
		h.ClearGrace(r, p)
	}
	r.Touch(p, h.clock.Mono())
	return p, nil
}

// EnsureSeated returns the seated player, reconnecting them if needed.
func (h *Hub) EnsureSeated(r *sim.Room, playerID string) (*sim.Player, error) {
	return h.ReconnectPlayer(r, playerID)
}

// Clock returns the hub's clock.
func (h *Hub) Clock() *clock.Clock { return h.clock }
