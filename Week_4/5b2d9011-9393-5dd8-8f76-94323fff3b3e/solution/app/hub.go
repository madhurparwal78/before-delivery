package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// hub owns every live room and the map from a player to the room they hold a seat in.
type hub struct {
	srv *server

	mu    sync.Mutex
	rooms map[string]*room

	pmu      sync.Mutex
	byPlayer map[string]string

	// creating serialises one player's room creations, so of several simultaneous requests exactly one creates
	// a room and the rest see it as already_in_room.
	creating sync.Map // player id -> *sync.Mutex
}

func newHub(srv *server) *hub {
	return &hub{srv: srv, rooms: map[string]*room{}, byPlayer: map[string]string{}}
}

func (h *hub) remember(playerID, code string) {
	h.pmu.Lock()
	defer h.pmu.Unlock()
	h.byPlayer[playerID] = code
}

func (h *hub) forget(playerID string) {
	h.pmu.Lock()
	defer h.pmu.Unlock()
	delete(h.byPlayer, playerID)
}

func (h *hub) roomOf(playerID string) (string, bool) {
	h.pmu.Lock()
	defer h.pmu.Unlock()
	code, ok := h.byPlayer[playerID]
	return code, ok
}

func (h *hub) lookup(code string) (*room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	rm, ok := h.rooms[strings.ToUpper(code)]
	if !ok {
		return nil, fail("room_not_found")
	}
	return rm, nil
}

// run advances every live room each tick and removes rooms 60 seconds after they end.
func (h *hub) run(ctx context.Context) {
	tick := time.NewTicker(tickDur / 2)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		h.mu.Lock()
		rooms := make([]*room, 0, len(h.rooms))
		for _, rm := range h.rooms {
			rooms = append(rooms, rm)
		}
		h.mu.Unlock()
		for _, rm := range rooms {
			rm.mu.Lock()
			rm.advance()
			expired := rm.phase == phaseOver && time.Since(rm.overSince) >= lingerAfterOver
			rm.mu.Unlock()
			if expired {
				h.mu.Lock()
				delete(h.rooms, rm.code)
				h.mu.Unlock()
				rm.mu.Lock()
				rm.mirror(h.srv.reg.remove(rm.code))
				rm.mu.Unlock()
			}
		}
	}
}

func randomCode() string {
	raw := make([]byte, 6)
	rand.Read(raw) // crypto/rand.Read never returns an error
	code := make([]byte, 6)
	for i, b := range raw {
		code[i] = codeAlphabet[int(b)%len(codeAlphabet)]
	}
	return string(code)
}

// ---- handlers

// withSeat resolves the room and the caller's seat, renews the lease and runs fn under the room lock.
func (h *hub) withSeat(w http.ResponseWriter, r *http.Request, fn func(rm *room, s *seat) error) error {
	p, err := h.srv.requirePlayer(r)
	if err != nil {
		return err
	}
	rm, err := h.lookup(r.PathValue("code"))
	if err != nil {
		return err
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.advance()
	s := rm.seatOf(p.ID)
	if s == nil {
		return fail("not_seated")
	}
	rm.touch(s)
	return fn(rm, s)
}

func (h *hub) postRoom(w http.ResponseWriter, r *http.Request) error {
	p, err := h.srv.requirePlayer(r)
	if err != nil {
		return err
	}
	lock, _ := h.creating.LoadOrStore(p.ID, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()
	if !h.srv.reg.available() {
		return fail("rooms_unavailable")
	}
	if code, in := h.roomOf(p.ID); in {
		return alreadyInRoom(code)
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := decodeBody(r, &body); err != nil {
		return err
	}
	if body.Mode != modeSiege && body.Mode != modeConvoy {
		return failFields(map[string]string{"mode": "Pick siege or convoy."})
	}
	now := h.srv.clock.Now()
	rm := newRoom(h.srv, "", body.Mode, now)
	if p.Role == roleFounder {
		if rm.nightID, err = h.srv.store.liveNightID(r.Context(), body.Mode, now); err != nil {
			return err
		}
	}
	for attempt := 0; attempt < 24; attempt++ {
		rm.code = randomCode()
		rm.host = p.ID
		claimed, err := h.srv.reg.claimCode(rm.fields())
		if err != nil {
			return fail("rooms_unavailable")
		}
		if claimed {
			break
		}
		rm.code = ""
	}
	if rm.code == "" {
		return fail("rooms_unavailable")
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.addSeat(p)
	h.mu.Lock()
	h.rooms[rm.code] = rm
	h.mu.Unlock()
	writeJSON(w, http.StatusCreated, rm.state())
	return nil
}

func (h *hub) getRoom(w http.ResponseWriter, r *http.Request) error {
	p, err := h.srv.requirePlayer(r)
	if err != nil {
		return err
	}
	rm, err := h.lookup(r.PathValue("code"))
	if err != nil {
		return err
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.advance()
	if s := rm.seatOf(p.ID); s != nil {
		rm.touch(s)
	}
	writeJSON(w, http.StatusOK, rm.state())
	return nil
}

func (h *hub) postJoin(w http.ResponseWriter, r *http.Request) error {
	p, err := h.srv.requirePlayer(r)
	if err != nil {
		return err
	}
	if !h.srv.reg.available() {
		return fail("rooms_unavailable")
	}
	rm, err := h.lookup(r.PathValue("code"))
	if err != nil {
		return err
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.advance()
	s := rm.seatOf(p.ID)
	switch {
	case s != nil && s.connection == connLeft:
		return fail("seat_released")
	case s != nil:
		rm.touch(s)
	default:
		if code, in := h.roomOf(p.ID); in {
			return alreadyInRoom(code)
		}
		switch {
		case rm.phase != phaseLobby:
			return fail("match_in_progress")
		case !rm.inviteOpen(h.srv.clock.Now()):
			return fail("invite_expired")
		case len(rm.seats) >= maxSeats:
			return fail("room_full")
		}
		s = rm.addSeat(p)
	}
	payload, err := json.Marshal(map[string]any{"seat": s.number, "state": rm.state()})
	if err != nil {
		return err
	}
	writeStatus(w, http.StatusOK, string(payload))
	return nil
}

func (h *hub) postReady(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		var body struct {
			Ready *bool `json:"ready"`
		}
		if err := decodeBody(r, &body); err != nil {
			return err
		}
		if rm.phase != phaseLobby {
			return fail("wrong_phase")
		}
		if body.Ready == nil {
			return failFields(map[string]string{"ready": "Send true or false."})
		}
		s.ready = *body.Ready
		writeJSON(w, http.StatusOK, rm.state())
		return nil
	})
}

func (h *hub) postStart(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		switch {
		case rm.host != s.playerID:
			return fail("not_host")
		case rm.phase != phaseLobby:
			return fail("wrong_phase")
		case !rm.allReady():
			return fail("not_all_ready")
		}
		rm.start()
		writeJSON(w, http.StatusOK, rm.state())
		return nil
	})
}

func (h *hub) postEnd(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		switch {
		case rm.host != s.playerID:
			return fail("not_host")
		case rm.phase == phaseLobby || rm.phase == phaseOver:
			return fail("wrong_phase")
		}
		rm.finish("ended")
		writeJSON(w, http.StatusOK, rm.state())
		return nil
	})
}

func (h *hub) postHeartbeat(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		w.WriteHeader(http.StatusNoContent)
		return nil
	})
}

func (h *hub) postLeave(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		rm.leave(s)
		writeJSON(w, http.StatusOK, rm.state())
		return nil
	})
}

func (h *hub) getLedger(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		balances := map[string]int{}
		entries := make([]map[string]any, 0, len(rm.ledger))
		total := 0
		for _, e := range rm.ledger {
			balances[e.account] += e.amount
			total += e.amount
			var item, unit any
			if e.item != "" {
				item, unit = e.item, e.unitPrice
			}
			entries = append(entries, map[string]any{"id": e.id, "account": e.account, "amount": e.amount,
				"kind": e.kind, "ref": e.ref, "item": item, "unit_price": unit, "at": formatInstant(e.at)})
		}
		writeJSON(w, http.StatusOK, map[string]any{"balances": balances, "entries": entries, "total": total})
		return nil
	})
}

// streamRoom sends one snapshot event per server tick until the client leaves.
func (h *hub) streamRoom(w http.ResponseWriter, r *http.Request) error {
	p, err := h.srv.requirePlayer(r)
	if err != nil {
		return err
	}
	rm, err := h.lookup(r.PathValue("code"))
	if err != nil {
		return err
	}
	flusher := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if err := flusher.Flush(); err != nil {
		return nil
	}
	poll := time.NewTicker(tickDur / 2)
	defer poll.Stop()
	lastTick, lastSent := -1, time.Time{}
	for {
		rm.mu.Lock()
		rm.advance()
		if s := rm.seatOf(p.ID); s != nil {
			rm.touch(s)
		}
		frozen := rm.degraded != "" || rm.phase == phaseOver
		var payload []byte
		if rm.tick > lastTick || (frozen && time.Since(lastSent) >= tickDur) {
			payload, err = json.Marshal(rm.state())
			lastTick = rm.tick
		}
		rm.mu.Unlock()
		if err != nil {
			return err
		}
		if payload != nil {
			lastSent = time.Now()
			if _, err := fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", payload); err != nil {
				return nil
			}
			if err := flusher.Flush(); err != nil {
				return nil
			}
		}
		select {
		case <-r.Context().Done():
			return nil
		case <-poll.C:
		}
	}
}

// alreadyInRoom names the room the player already holds a seat in.
func alreadyInRoom(code string) *apiError {
	e := failMessage("already_in_room", "You're already in room "+code+".")
	e.extra = map[string]any{"room_code": code}
	return e
}
