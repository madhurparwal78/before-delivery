package sim

import (
	"math/rand"
	"time"

	"holdfast/internal/maps"
)

// The hub drives each room through this facade, which locks the room's mutex
// for every cross-package operation. The simulation itself runs inside the
// same lock in the tick loop.

// RoomLock locks the room.
func (r *Room) RoomLock() { r.mu.Lock() }

// RoomUnlock unlocks the room.
func (r *Room) RoomUnlock() { r.mu.Unlock() }

// PhasePublic returns the current phase.
func (r *Room) PhasePublic() Phase { return r.Phase }

// CreatedAtPublic returns the room's creation instant.
func (r *Room) CreatedAtPublic() time.Time { return r.CreatedAt }

// InviteExpiresAtPublic returns the invite expiry instant.
func (r *Room) InviteExpiresAtPublic() time.Time { return r.InviteExpiresAt }

// PlayerSeated reports whether the player holds a seat.
func (r *Room) PlayerSeated(playerID string) bool {
	p, ok := r.Players[playerID]
	return ok && p != nil
}

// PlayerSeatedID returns the seated player.
func (r *Room) PlayerSeatedID(playerID string) (*Player, bool) {
	p, ok := r.Players[playerID]
	if !ok || p == nil {
		return nil, false
	}
	return p, true
}

// SeatPlayer seats a player.
func (r *Room) SeatPlayer(playerID string, p *Player, seat int) {
	r.Players[playerID] = p
	r.Seats[seat] = playerID
}

// SpawnForSeat returns the spawn point for a seat.
func (r *Room) SpawnForSeat(seat int) maps.Spawn {
	for _, s := range r.Map.Spawns {
		if s.Seat == seat {
			return s
		}
	}
	return maps.Spawn{X: r.Map.Width / 2, Z: r.Map.Depth / 2, Aim: 90}
}

// FreezePublic freezes the room's timers while the registry is down.
func (r *Room) FreezePublic() {
	if r.Phase == PhaseOver || r.Phase == PhaseLobby {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Freeze(r.Clock.Mono())
	r.Degraded = DegradedKey
}

// UnfreezePublic resumes the room's timers from the same remaining
// milliseconds.
func (r *Room) UnfreezePublic(nowMono int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Unfreeze(nowMono)
}

// DegradedPublic returns the degraded key, or an empty string.
func (r *Room) DegradedPublic() string { return r.Degraded }

// TickPublic runs one tick.
func (r *Room) TickPublic() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.TickOnce()
}

// TickOnce advances the simulation one tick with the room locked.
func (r *Room) TickOnceLocked() {
	r.TickOnce()
}

// TouchPublic renews a seated player's lease.
func (r *Room) TouchPublic(playerID string) {
	p, ok := r.Players[playerID]
	if !ok {
		return
	}
	r.Touch(p, r.Clock.Mono())
}

// ResultPublic returns the match result, or an empty string.
func (r *Room) ResultPublic() string { return r.Result }

// RandomIndex returns a random index for code generation.
func RandomIndex(n int) int { return rand.Intn(n) }

// OverAtPublic returns when a finished room ended.
func (r *Room) OverAtPublic() time.Time { return r.OverAt }
