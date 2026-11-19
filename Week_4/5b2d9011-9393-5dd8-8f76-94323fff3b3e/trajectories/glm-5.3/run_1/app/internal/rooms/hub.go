// Package rooms owns the live room registry. Live simulation runs in this
// process's memory; Valkey holds the registry keys, the seat leases and the
// report dedupe.
package rooms

import (
	"context"
	"strings"
	"sync"
	"time"

	"holdfast/internal/apperr"
	"holdfast/internal/clock"
	"holdfast/internal/maps"
	"holdfast/internal/sim"
	"holdfast/internal/store"
)

// Hub runs every live room, its tick loop and its registry mirror in Valkey.
type Hub struct {
	mu     sync.RWMutex
	rooms  map[string]*sim.Room
	codes  map[string]bool // live codes, upper case
	clock  *clock.Clock
	valkey *Valkey
	store  *store.Store

	streams   map[string]map[int]chan []byte // code -> stream id -> channel
	streamSeq int

	// valkeyUp is the last observed Valkey reachability.
	valkeyUp bool

	// priceNow is consulted for live shop prices.
	priceNow PriceSource

	onMatchOver func(m FinishRecord)
}

// PriceSource supplies live shop prices for a snapshot.
type PriceSource func(ctx context.Context, now time.Time) []sim.ShopItem

// NewHub creates the hub.
func NewHub(c *clock.Clock, vk *Valkey, st *store.Store, priceNow PriceSource) *Hub {
	return &Hub{
		rooms:   map[string]*sim.Room{},
		codes:   map[string]bool{},
		clock:   c,
		valkey:  vk,
		store:   st,
		streams: map[string]map[int]chan []byte{},
	}
}

// SetMatchOver sets the callback fired when a room reaches over.
func (h *Hub) SetMatchOver(fn func(m FinishRecord)) {
	h.mu.Lock()
	h.onMatchOver = fn
	h.mu.Unlock()
}

// ValkeyUp reports whether Valkey is reachable.
func (h *Hub) ValkeyUp() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.valkeyUp
}

// SetValkeyUp records the probe result and freezes or unfreezes rooms.
func (h *Hub) SetValkeyUp(up bool) {
	h.mu.Lock()
	h.valkeyUp = up
	rooms := make([]*sim.Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()

	nowMono := h.clock.Mono()
	for _, r := range rooms {
		r.FreezePublic()
		if up {
			r.UnfreezePublic(nowMono)
			h.rewriteRegistry(r)
		}
	}
}

// RoomByCode returns the live room with the given code, matched
// case-insensitively.
func (h *Hub) RoomByCode(code string) (*sim.Room, bool) {
	upper := strings.ToUpper(code)
	h.mu.RLock()
	defer h.mu.RUnlock()
	r, ok := h.rooms[upper]
	return r, ok
}

// Create creates a room for the player, who takes seat 1 and becomes host.
func (h *Hub) Create(playerID, callsign, mode, nightID string) (*sim.Room, error) {
	h.mu.Lock()
	// A player whose seat is in a room that is not over cannot create another.
	for _, r := range h.rooms {
		if r.PlayerSeated(playerID) && r.PhasePublic() != sim.PhaseOver {
			code := r.Code
			h.mu.Unlock()
			return nil, apperr.AlreadyInRoom(code)
		}
	}
	if !h.valkeyUp {
		h.mu.Unlock()
		return nil, apperr.RoomsUnavailable
	}
	code := h.newCode()
	r := newRoom(code, mode, playerID, callsign, nightID, h.clock)
	h.rooms[code] = r
	h.codes[code] = true
	h.mu.Unlock()

	h.rewriteRegistry(r)
	return r, nil
}

// newCode generates a unique short code from the published alphabet.
func (h *Hub) newCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		buf := make([]byte, 6)
		for i := range buf {
			buf[i] = alphabet[sim.RandomIndex(len(alphabet))]
		}
		code := string(buf)
		if !h.codes[code] {
			return code
		}
	}
}

func newRoom(code, mode, hostID, hostCallsign, nightID string, c *clock.Clock) *sim.Room {
	m := maps.BreakwaterYard
	if mode == "convoy" {
		m = maps.SaltpanLoop
	}
	r := &sim.Room{
		Code:           code,
		Mode:           mode,
		Map:            m,
		Phase:          sim.PhaseLobby,
		Clock:          c,
		HostID:         hostID,
		NightID:        nightID,
		CreatedAt:      c.Now().UTC(),
		InviteExpiresAt: c.Now().UTC().Add(sim.InviteMs),
		Players:        map[string]*sim.Player{},
		Seats:          map[int]string{},
		Enemies:        map[string]*sim.Enemy{},
		Barrels:        map[string]*sim.Barrel{},
		Grenades:       map[string]*sim.Grenade{},
		Vehicles:       map[string]*sim.Vehicle{},
		Purchases:      map[string]*sim.PurchaseRecord{},
	}
	for _, b := range m.Barrels {
		r.Barrels[b.ID] = &sim.Barrel{ID: b.ID, X: b.X, Z: b.Z, HP: sim.BarrelHP}
	}
	sp := m.SpawnFor(1)
	p := &sim.Player{
		ID: hostID, Callsign: hostCallsign, Seat: 1, Ready: false,
		Connection: sim.Connected,
		LeaseUntil: c.Mono() + sim.LeaseMs,
		Status:     sim.Up, HP: sim.MaxHP,
		X: sp.X, Z: sp.Z, Aim: sp.Aim,
		Mag: sim.MagSize, Reserve: sim.ReserveStart, Grenades: sim.GrenadesStart,
		Credits: 0, Score: 0,
	}
	r.Players[hostID] = p
	r.Seats[1] = hostID
	return r
}

// Join joins a player by code. Rejoining your own seat ignores invite expiry.
func (h *Hub) Join(code, playerID, callsign string) (int, error) {
	r, ok := h.RoomByCode(code)
	if !ok {
		return 0, apperr.RoomNotFound
	}
	h.mu.Lock()
	if !h.valkeyUp {
		h.mu.Unlock()
		return 0, apperr.RoomsUnavailable
	}
	h.mu.Unlock()

	r.RoomLock()
	defer r.RoomUnlock()

	if p, seated := r.PlayerSeatedID(playerID); seated {
		// Rejoining your own seat ignores invite expiry. A player whose grace
		// has time left reconnects; one whose grace ran out is refused.
		if p.Connection == sim.Disconnected {
			if !r.Reconnect(p, h.clock.Mono()) {
				r.RoomUnlock()
				return 0, apperr.SeatReleased(r.Code)
			}
			h.ClearGrace(r, p)
		}
		h.touch(r, p)
		return p.Seat, nil
	}
	if r.PhasePublic() != sim.PhaseLobby {
		return 0, apperr.MatchInProgress(r.Code)
	}
	if h.clock.Now().After(r.InviteExpiresAtPublic()) {
		return 0, apperr.InviteExpired
	}
	seat, free := r.AnySeatFree()
	if !free {
		return 0, apperr.RoomFull(r.Code)
	}
	sp := r.SpawnForSeat(seat)
	p := &sim.Player{
		ID: playerID, Callsign: callsign, Seat: seat, Ready: false,
		Connection: sim.Connected,
		LeaseUntil: h.clock.Mono() + sim.LeaseMs,
		Status: sim.Up, HP: sim.MaxHP,
		X: sp.X, Z: sp.Z, Aim: sp.Aim,
		Mag: sim.MagSize, Reserve: sim.ReserveStart, Grenades: sim.GrenadesStart,
	}
	r.SeatPlayer(playerID, p, seat)
	return seat, nil
}
