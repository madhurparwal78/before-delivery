package rooms

import (
	"context"
	"encoding/json"
	"time"

	"holdfast/internal/sim"
)

// Run drives every live room at the 20 Hz tick, publishes snapshots to the
// streams and stores finished matches. It returns when ctx is done.
func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(sim.TickMs) * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.tickAll(ctx)
		}
	}
}

// tickAll advances each room one tick and publishes snapshots.
func (h *Hub) tickAll(ctx context.Context) {
	h.mu.RLock()
	rooms := make([]*sim.Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.RUnlock()

	now := h.clock.Now().UTC()
	nowMono := h.clock.Mono()

	var over []*sim.Room
	for _, r := range rooms {
		r.RoomLock()
		wasOver := r.PhasePublic() == sim.PhaseOver
		r.TickOnceLocked()
		movements := r.TakeCreditMovements()
		isOver := r.PhasePublic() == sim.PhaseOver
		if !wasOver && isOver {
			over = append(over, r)
		}
		r.RoomUnlock()
		if len(movements) > 0 && h.store != nil {
			ctx2, cancel := context.WithTimeout(ctx, 3*time.Second)
			for _, m := range movements {
				h.store.AppendLedger(ctx2, r.MatchIDPublic(), m.PlayerID, m.Amount, m.Kind, m.Ref, "", 0)
			}
			cancel()
		}
	}

	// Publish a snapshot per tick to every open stream.
	for _, r := range rooms {
		h.publishSnapshot(ctx, r, now, nowMono)
	}

	// Store finished matches and retire rooms.
	for _, r := range over {
		h.finishMatch(ctx, r)
	}
	h.retireRooms()
}

// publishSnapshot renders a room's state and fans it out to streams.
func (h *Hub) publishSnapshot(ctx context.Context, r *sim.Room, now time.Time, nowMono int64) {
	r.RoomLock()
	items := []sim.ShopItem{}
	if h.priceNow != nil {
		items = h.priceNow(ctx, now)
	}
	snap := r.SnapshotState(now, nowMono, items)
	r.RoomUnlock()
	data, err := json.Marshal(snap)
	if err != nil {
		return
	}
	h.mu.RLock()
	streams := h.streams[r.Code]
	chans := make([]chan []byte, 0, len(streams))
	for _, ch := range streams {
		chans = append(chans, ch)
	}
	h.mu.RUnlock()
	for _, ch := range chans {
		select {
		case ch <- data:
		default:
			// A slow consumer drops frames; the next snapshot catches up.
		}
	}
}

// Subscribe opens a snapshot stream for a room. The returned channel receives
// one JSON snapshot per server tick. The cancel func closes the stream.
func (h *Hub) Subscribe(code string) (<-chan []byte, func(), bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.rooms[code]
	if !ok {
		return nil, nil, false
	}
	h.streamSeq++
	id := h.streamSeq
	ch := make(chan []byte, 4)
	if h.streams[code] == nil {
		h.streams[code] = map[int]chan []byte{}
	}
	h.streams[code][id] = ch
	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if m := h.streams[code]; m != nil {
			delete(m, id)
			if len(m) == 0 {
				delete(h.streams, code)
			}
		}
	}
	return ch, cancel, true
}

// finishMatch stores the finished match and its laps.
func (h *Hub) finishMatch(ctx context.Context, r *sim.Room) {
	r.RoomLock()
	defer r.RoomUnlock()
	rec := FinishRecord{
		Code:         r.Code,
		Mode:         r.Mode,
		Result:       r.Result,
		NightID:      r.NightID,
		StartedAt:   r.StartedAt,
	}
	if r.Result == "victory" {
		rec.WavesCleared = 4
	} else if r.Mode == "siege" {
		rec.WavesCleared = wavesClearedFromLog(r)
	}
	seenLap := map[string]bool{}
	for _, p := range r.PlayersInSeatOrder() {
		fp := FinishPlayer{
			Seat:     p.Seat,
			PlayerID: p.ID,
			Callsign: p.Callsign,
			Score:    p.Score,
			Kills:    p.Kills,
		}
		if r.Mode == "siege" {
			var err error
			fp.CreditsEarned, err = h.store.PlayerCreditsEarned(ctx, r.MatchID, p.ID)
			if err != nil {
				fp.CreditsEarned = 0
			}
		}
		if r.Mode == "convoy" {
			v := r.Vehicles[p.ID]
			if v != nil {
				fp.BestLapMs = v.BestLapMs
			}
		}
		rec.Players = append(rec.Players, fp)
	}
	if h.onMatchOver != nil {
		fn := h.onMatchOver
		fn(rec)
	}
	_ = seenLap
}

// wavesClearedFromLog counts cleared waves from the event log.
func wavesClearedFromLog(r *sim.Room) int {
	n := 0
	for _, ev := range r.Events {
		if ev.Type == "wave_cleared" {
			n++
		}
	}
	return n
}

// retireRooms removes rooms that ended more than 60 seconds ago.
func (h *Hub) retireRooms() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for code, r := range h.rooms {
		if r.PhasePublic() == sim.PhaseOver && h.clock.Now().Sub(r.OverAtPublic()) > sim.RoomGoneAfterMs {
			delete(h.rooms, code)
			delete(h.codes, code)
			go h.removeRoom(code)
		}
	}
}
