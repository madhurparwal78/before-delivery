package sim

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/pricing"
	"github.com/cinderlatch/holdfast/internal/registry"
	"github.com/cinderlatch/holdfast/internal/store"
)

// codeAlphabet is the room code alphabet, which leaves out letters and digits
// that read alike.
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

const codeLength = 6

// Manager owns the live rooms. The simulation runs in memory here, while the
// room registry, seat leases and report dedupe live in Valkey.
type Manager struct {
	clock    *clockx.Clock
	prices   *pricing.Cache
	registry *registry.Registry
	st       *store.Store

	mu    sync.RWMutex
	rooms map[string]*Room
}

// NewManager builds the room manager.
func NewManager(clock *clockx.Clock, prices *pricing.Cache, reg *registry.Registry, st *store.Store) *Manager {
	return &Manager{
		clock: clock, prices: prices, registry: reg, st: st,
		rooms: map[string]*Room{},
	}
}

// ErrAlreadyInRoom reports that a player already holds a seat in a live room.
type ErrAlreadyInRoom struct{ Code string }

func (e *ErrAlreadyInRoom) Error() string { return "already in room " + e.Code }

// Create opens a room with a unique short code and seats its creator as host.
func (m *Manager) Create(ctx context.Context, playerID, callsign, mode string, nightID *string) (*Room, error) {
	if code, ok := m.roomOfPlayer(playerID); ok {
		return nil, &ErrAlreadyInRoom{Code: code}
	}

	for attempt := 0; attempt < 8; attempt++ {
		room := newRoom(newCode(), mode, nightID, m.clock, m.prices)
		room.hostID = playerID
		room.seatPlayer(1, playerID, callsign)

		code := room.Code()
		roomMode, host, phase, createdAt, inviteExpiresAt := room.RegistryFields()
		claimed, err := m.registry.ClaimRoom(ctx, code, registry.RoomFields{
			Mode: roomMode, Host: host, Phase: phase,
			CreatedAt: createdAt, InviteExpiresAt: inviteExpiresAt,
		})
		if err != nil {
			return nil, err
		}
		if !claimed {
			continue
		}
		_ = m.registry.RenewSeat(ctx, code, playerID, time.Duration(SeatLeaseMS)*time.Millisecond)

		m.mu.Lock()
		m.rooms[code] = room
		m.mu.Unlock()
		return room, nil
	}
	return nil, registry.ErrDown
}

// Get resolves a room by code, matched case-insensitively.
func (m *Manager) Get(code string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	room, ok := m.rooms[strings.ToUpper(code)]
	return room, ok
}

// roomOfPlayer reports the live room a player holds a seat in.
func (m *Manager) roomOfPlayer(playerID string) (string, bool) {
	m.mu.RLock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, room := range m.rooms {
		rooms = append(rooms, room)
	}
	m.mu.RUnlock()

	for _, room := range rooms {
		if _, over := room.OverSince(); over {
			continue
		}
		if room.HoldsSeat(playerID) {
			return room.Code(), true
		}
	}
	return "", false
}

// JoinRoom seats a player and mirrors the seat lease into the registry.
func (m *Manager) JoinRoom(ctx context.Context, room *Room, playerID, callsign string) (int, StateView, error) {
	seat, state, err := room.Join(playerID, callsign)
	if err != nil {
		return 0, StateView{}, err
	}
	_ = m.registry.RenewSeat(ctx, room.Code(), playerID, time.Duration(SeatLeaseMS)*time.Millisecond)
	return seat, state, nil
}

// Touch renews a seat lease in memory and in the registry.
func (m *Manager) Touch(ctx context.Context, room *Room, playerID string) {
	room.Touch(playerID)
	_ = m.registry.RenewSeat(ctx, room.Code(), playerID, time.Duration(SeatLeaseMS)*time.Millisecond)
}

// ApplyReport judges a report and mirrors its stored result into the registry.
func (m *Manager) ApplyReport(ctx context.Context, room *Room, playerID string, in ReportInput) (ReportResult, error) {
	result, err := room.ApplyReport(playerID, in)
	if err != nil {
		return ReportResult{}, err
	}
	m.mirrorReport(ctx, room.Code(), result)
	return result, nil
}

// ApplyReports judges a batch and mirrors each stored result.
func (m *Manager) ApplyReports(ctx context.Context, room *Room, playerID string, batch []ReportInput) ([]ReportResult, []error, error) {
	results, failures, err := room.ApplyReports(playerID, batch)
	if err != nil {
		return nil, nil, err
	}
	for i := range results {
		if failures[i] == nil {
			m.mirrorReport(ctx, room.Code(), results[i])
		}
	}
	return results, failures, nil
}

func (m *Manager) mirrorReport(ctx context.Context, code string, result ReportResult) {
	payload, err := json.Marshal(result)
	if err != nil {
		return
	}
	_ = m.registry.StoreReport(ctx, code, result.ReportID, string(payload))
}

// Run drives every live room at the server tick rate, follows the room registry
// and writes each finished match once.
func (m *Manager) Run(ctx context.Context) {
	ticker := time.NewTicker(TickInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.step(ctx)
		}
	}
}

func (m *Manager) step(ctx context.Context) {
	m.mu.RLock()
	rooms := make([]*Room, 0, len(m.rooms))
	for _, room := range m.rooms {
		rooms = append(rooms, room)
	}
	m.mu.RUnlock()

	registryUp := m.registry.Up()
	for _, room := range rooms {
		m.followRegistry(ctx, room, registryUp)
		room.Tick()
		m.persistFinished(ctx, room)
		m.retireRoom(ctx, room)
	}
}

// followRegistry freezes a room that lost the room registry and resumes it once
// the registry is back, rewriting its keys.
func (m *Manager) followRegistry(ctx context.Context, room *Room, up bool) {
	if !up {
		room.SetDegraded(DegradedRoomRegist)
		return
	}
	if room.Degraded() == "" {
		return
	}
	mode, host, phase, createdAt, inviteExpiresAt := room.RegistryFields()
	if err := m.registry.WriteRoom(ctx, room.Code(), registry.RoomFields{
		Mode: mode, Host: host, Phase: phase,
		CreatedAt: createdAt, InviteExpiresAt: inviteExpiresAt,
	}); err != nil {
		return
	}
	room.SetDegraded("")
}

func (m *Manager) persistFinished(ctx context.Context, room *Room) {
	record, ok := room.TakeFinished()
	if !ok {
		return
	}
	go func() {
		writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		for attempt := 0; attempt < 30; attempt++ {
			if err := m.st.SaveMatch(writeCtx, record.Match, record.Laps, record.Entries); err == nil {
				return
			}
			select {
			case <-writeCtx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}()
}

// retireRoom drops a room's code and registry keys once it has answered for the
// linger window.
func (m *Manager) retireRoom(ctx context.Context, room *Room) {
	since, over := room.OverSince()
	if !over || time.Since(since) < OverLinger {
		return
	}
	m.mu.Lock()
	delete(m.rooms, room.Code())
	m.mu.Unlock()
	_ = m.registry.DropRoom(ctx, room.Code())
}

func newCode() string {
	buf := make([]byte, codeLength)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	out := make([]byte, codeLength)
	for i, b := range buf {
		out[i] = codeAlphabet[int(b)%len(codeAlphabet)]
	}
	return string(out)
}
