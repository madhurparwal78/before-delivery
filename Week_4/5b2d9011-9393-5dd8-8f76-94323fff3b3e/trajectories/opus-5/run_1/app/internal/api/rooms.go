package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/cinderlatch/holdfast/internal/apierr"
	"github.com/cinderlatch/holdfast/internal/calendar"
	"github.com/cinderlatch/holdfast/internal/registry"
	"github.com/cinderlatch/holdfast/internal/sim"
	"github.com/cinderlatch/holdfast/internal/store"
)

// roomError maps a room's domain failure onto its published code.
func roomError(err error) *apierr.Error {
	var already *sim.ErrAlreadyInRoom
	switch {
	case errors.As(err, &already):
		// The error shape owns "code", so the room code rides alongside it and in
		// the sentence.
		return apierr.New(http.StatusConflict, "already_in_room",
			"You're already in room "+already.Code+".").WithExtra("room_code", already.Code)
	case errors.Is(err, sim.ErrRoomFull):
		return apierr.New(http.StatusConflict, "room_full", "That room is full.")
	case errors.Is(err, sim.ErrMatchInProgress):
		return apierr.New(http.StatusConflict, "match_in_progress", "That room is mid-match.")
	case errors.Is(err, sim.ErrSeatReleased):
		return apierr.New(http.StatusConflict, "seat_released", "Your seat in that room was released.")
	case errors.Is(err, sim.ErrInviteExpired):
		return apierr.New(http.StatusGone, "invite_expired", "This invite expired.")
	case errors.Is(err, sim.ErrWrongPhase):
		return apierr.New(http.StatusConflict, "wrong_phase", "That isn't allowed in this phase.")
	case errors.Is(err, sim.ErrNotAllReady):
		return apierr.New(http.StatusConflict, "not_all_ready", "Everyone must be ready first.")
	case errors.Is(err, sim.ErrNotHost):
		return apierr.New(http.StatusForbidden, "not_host", "Only the host can do that.")
	case errors.Is(err, sim.ErrNotSeated):
		return apierr.New(http.StatusForbidden, "not_seated", "You don't hold a seat in that room.")
	case errors.Is(err, sim.ErrShopClosed):
		return apierr.New(http.StatusConflict, "shop_closed", "The ammo station is closed until the next intermission.")
	case errors.Is(err, sim.ErrInsufficientCredits):
		return apierr.New(http.StatusConflict, "insufficient_credits", "You don't have enough credits for that.")
	case errors.Is(err, sim.ErrAtCapacity):
		return apierr.New(http.StatusConflict, "at_capacity", "You're carrying as many as you can.")
	case errors.Is(err, sim.ErrPurchaseConflict):
		return apierr.New(http.StatusConflict, "purchase_conflict", "That purchase id was used for another item.")
	case errors.Is(err, sim.ErrReportConflict):
		return apierr.New(http.StatusConflict, "report_conflict", "That report id was used for another report.")
	case errors.Is(err, sim.ErrRoomPaused):
		return apierr.RoomPaused()
	case errors.Is(err, sim.ErrPricesUnavailable):
		return apierr.StorageUnavailable()
	case errors.Is(err, registry.ErrDown):
		return apierr.RoomsUnavailable()
	default:
		return apierr.Internal()
	}
}

func roomNotFound() *apierr.Error {
	return apierr.New(http.StatusNotFound, "room_not_found", "No room with that code.")
}

// roomFor resolves the session and the room, renews the seat lease and, when
// asked, insists on a seat.
func (s *Server) roomFor(r *http.Request, requireSeat bool) (*sim.Room, store.Player, *apierr.Error) {
	player, failure := s.player(r)
	if failure != nil {
		return nil, store.Player{}, failure
	}
	room, ok := s.rooms.Get(r.PathValue("code"))
	if !ok {
		return nil, store.Player{}, roomNotFound()
	}
	if _, seated := room.Seat(player.ID); !seated {
		if requireSeat {
			return nil, store.Player{}, roomError(sim.ErrNotSeated)
		}
		return room, player, nil
	}
	s.rooms.Touch(r.Context(), room, player.ID)
	return room, player, nil
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	player, failure := s.player(r)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	if body.Mode != "siege" && body.Mode != "convoy" {
		apierr.Write(w, apierr.Field("mode", "Pick either siege or convoy."))
		return
	}
	if !s.registry.Up() {
		apierr.Write(w, apierr.RoomsUnavailable())
		return
	}

	var nightID *string
	if player.Role == "founder" {
		nightID = s.liveNightForMode(r, body.Mode)
	}
	room, err := s.rooms.Create(r.Context(), player.ID, player.Callsign, body.Mode, nightID)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}
	writeJSON(w, http.StatusCreated, room.Snapshot())
}

// liveNightForMode links a founder's room to a night of the same mode that the
// server clock makes live.
func (s *Server) liveNightForMode(r *http.Request, mode string) *string {
	now := s.clock.Now()
	today := calendar.StudioDate(now, s.zone)
	nights, err := s.store.NightsOnDates(r.Context(), mode, today.AddDate(0, 0, -1), today.AddDate(0, 0, 1))
	if err != nil {
		return nil
	}
	for _, night := range nights {
		if view := calendar.Build(night, s.zone, now); view.Status == calendar.StatusLive {
			id := view.ID
			return &id
		}
	}
	return nil
}

func (s *Server) handleRoomState(w http.ResponseWriter, r *http.Request) {
	room, _, failure := s.roomFor(r, false)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	writeJSON(w, http.StatusOK, room.Snapshot())
}

func (s *Server) handleRoomStream(w http.ResponseWriter, r *http.Request) {
	room, player, failure := s.roomFor(r, false)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		apierr.Write(w, apierr.Internal())
		return
	}

	snapshots, unsubscribe := room.Subscribe()
	defer unsubscribe()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	send := func(view sim.StateView) bool {
		payload, err := json.Marshal(view)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", payload); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !send(room.Snapshot()) {
		return
	}

	lease := time.NewTicker(time.Second)
	defer lease.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-lease.C:
			s.rooms.Touch(r.Context(), room, player.ID)
		case view, open := <-snapshots:
			if !open || !send(view) {
				return
			}
		}
	}
}

func (s *Server) handleJoinRoom(w http.ResponseWriter, r *http.Request) {
	player, failure := s.player(r)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	if !s.registry.Up() {
		apierr.Write(w, apierr.RoomsUnavailable())
		return
	}
	room, ok := s.rooms.Get(r.PathValue("code"))
	if !ok {
		apierr.Write(w, roomNotFound())
		return
	}
	seat, state, err := s.rooms.JoinRoom(r.Context(), room, player.ID, player.Callsign)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"seat": seat, "state": state})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Ready *bool `json:"ready"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	if body.Ready == nil {
		apierr.Write(w, apierr.Field("ready", "Send true or false."))
		return
	}
	state, err := room.Ready(player.ID, *body.Ready)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	state, err := room.Start(player.ID)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleEnd(w http.ResponseWriter, r *http.Request) {
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	state, err := room.End(player.ID)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	if _, _, failure := s.roomFor(r, true); failure != nil {
		apierr.Write(w, failure)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLeave(w http.ResponseWriter, r *http.Request) {
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	state := room.Leave(player.ID)
	_ = s.registry.ReleaseSeat(r.Context(), room.Code(), player.ID)
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleInput(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Seq  *int64 `json:"seq"`
		Move *struct {
			X *float64 `json:"x"`
			Z *float64 `json:"z"`
		} `json:"move"`
		Aim *float64 `json:"aim"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}

	fields := map[string]string{}
	if body.Seq == nil || *body.Seq < 1 {
		fields["seq"] = "Use a whole number of 1 or more."
	}
	if body.Move == nil || body.Move.X == nil || body.Move.Z == nil {
		fields["move"] = "Send move.x and move.z between -1 and 1."
	} else if *body.Move.X < -1 || *body.Move.X > 1 || *body.Move.Z < -1 || *body.Move.Z > 1 {
		fields["move"] = "Send move.x and move.z between -1 and 1."
	}
	if body.Aim == nil || *body.Aim < 0 || *body.Aim > 360 {
		fields["aim"] = "Use a bearing from 0 to 360."
	}
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	applied := room.Input(player.ID, *body.Seq, *body.Move.X, *body.Move.Z, *body.Aim)
	writeJSON(w, http.StatusAccepted, map[string]any{"seq": *body.Seq, "applied": applied})
}

func (s *Server) handlePose(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Seq     *int64   `json:"seq"`
		X       *float64 `json:"x"`
		Z       *float64 `json:"z"`
		Heading *float64 `json:"heading"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}

	fields := map[string]string{}
	if body.Seq == nil || *body.Seq < 1 {
		fields["seq"] = "Use a whole number of 1 or more."
	}
	if body.X == nil {
		fields["x"] = "Send the vehicle's x position."
	}
	if body.Z == nil {
		fields["z"] = "Send the vehicle's z position."
	}
	if body.Heading == nil || *body.Heading < 0 || *body.Heading > 360 {
		fields["heading"] = "Use a bearing from 0 to 360."
	}
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	result, err := room.Pose(player.ID, *body.Seq, *body.X, *body.Z, *body.Heading)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handlePurchase(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PurchaseID string `json:"purchase_id"`
		Item       string `json:"item"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	room, player, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}

	fields := map[string]string{}
	if !validReportID(body.PurchaseID) {
		fields["purchase_id"] = "Use 1 to 64 letters, digits, underscores or hyphens."
	}
	if !store.KnownItem(body.Item) {
		fields["item"] = "Pick an ammo-station item."
	}
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	result, err := room.Purchase(player.ID, body.PurchaseID, body.Item)
	if err != nil {
		apierr.Write(w, roomError(err))
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleLedger(w http.ResponseWriter, r *http.Request) {
	room, _, failure := s.roomFor(r, true)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	balances, entries, total := room.LedgerView()
	writeJSON(w, http.StatusOK, map[string]any{
		"balances": balances, "entries": entries, "total": total,
	})
}

// validReportID reports whether an id is 1 to 64 of A-Z a-z 0-9 _ -.
func validReportID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}
