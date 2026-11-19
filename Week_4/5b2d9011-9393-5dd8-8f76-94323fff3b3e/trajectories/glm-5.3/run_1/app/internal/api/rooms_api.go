package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"holdfast/internal/apperr"
	"holdfast/internal/httpx"
	"holdfast/internal/sim"
	"holdfast/internal/store"
)

// handleRooms routes /api/rooms and /api/rooms/{code}/….
func (a *App) handleRooms(w http.ResponseWriter, r *http.Request, rest string) {
	if rest == "" || rest == "/" {
		if r.Method != http.MethodPost {
			httpx.WriteError(w, apperr.NotFound)
			return
		}
		a.handleRoomCreate(w, r)
		return
	}
	rest = strings.TrimPrefix(rest, "/")
	parts := strings.Split(rest, "/")
	code := parts[0]
	upper := strings.ToUpper(code)
	room, ok := a.Hub.RoomByCode(upper)
	if !ok {
		httpx.WriteError(w, apperr.RoomNotFound)
		return
	}
	sub := ""
	if len(parts) > 1 {
		sub = strings.Join(parts[1:], "/")
	}

	switch sub {
	case "":
		if r.Method != http.MethodGet {
			httpx.WriteError(w, apperr.NotFound)
			return
		}
		a.touchFromRequest(room, r)
		a.writeRoomState(w, room)
	case "stream":
		a.handleRoomStream(w, r, room)
	case "join":
		a.handleRoomJoin(w, r, room)
	case "ready":
		a.handleRoomReady(w, r, room)
	case "start":
		a.handleRoomStart(w, r, room)
	case "end":
		a.handleRoomEnd(w, r, room)
	case "heartbeat":
		a.handleRoomHeartbeat(w, r, room)
	case "leave":
		a.handleRoomLeave(w, r, room)
	case "input":
		a.handleRoomInput(w, r, room)
	case "reports":
		a.handleRoomReport(w, r, room)
	case "reports/batch":
		a.handleRoomReportBatch(w, r, room)
	case "pose":
		a.handleRoomPose(w, r, room)
	case "purchases":
		a.handleRoomPurchase(w, r, room)
	case "ledger":
		a.handleRoomLedger(w, r, room)
	default:
		httpx.WriteError(w, apperr.NotFound)
	}
}

// touchFromRequest renews a seated player's lease from any authenticated
// request or an open stream.
func (a *App) touchFromRequest(room *sim.Room, r *http.Request) {
	token := SessionTokenFrom(r)
	if token == "" {
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	p, err := a.Store.PlayerByToken(ctx, token)
	if err != nil {
		return
	}
	a.Hub.TouchPlayer(room, p.ID)
}

// writeRoomState renders the room state.
func (a *App) writeRoomState(w http.ResponseWriter, room *sim.Room) {
	now := a.Clock.Now().UTC()
	nowMono := a.Clock.Mono()
	room.RoomLock()
	items := a.liveShopItems(now)
	snap := room.SnapshotState(now, nowMono, items)
	room.RoomUnlock()
	httpx.WriteJSON(w, http.StatusOK, snap)
}

func (a *App) handleRoomCreate(w http.ResponseWriter, r *http.Request) {
	player, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	if !a.Hub.ValkeyUp() {
		httpx.WriteError(w, apperr.RoomsUnavailable)
		return
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if body.Mode != "siege" && body.Mode != "convoy" {
		httpx.WriteError(w, apperr.SingleValidation("mode", "Pick siege or convoy."))
		return
	}
	// A founder's room is linked to a live night of the same mode.
	nightID := a.liveNightID(body.Mode, player.Role)
	room, err := a.Hub.Create(player.ID, player.Callsign, body.Mode, nightID)
	if err != nil {
		if ae, ok := err.(*apperr.Error); ok {
			httpx.WriteError(w, ae)
			return
		}
		httpx.WriteError(w, apperr.RoomsUnavailable)
		return
	}
	room.RoomLock()
	room.MatchID = store.NewID()
	now := a.Clock.Now().UTC()
	nowMono := a.Clock.Mono()
	items := a.liveShopItems(now)
	snap := room.SnapshotState(now, nowMono, items)
	room.RoomUnlock()
	httpx.WriteJSON(w, http.StatusCreated, snap)
}

// liveNightID finds the live night of the given mode, for a founder.
func (a *App) liveNightID(mode, role string) string {
	if role != "founder" {
		return ""
	}
	if err := a.requireStorage(); err != nil {
		return ""
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	now := a.Clock.Now().UTC()
	nights, err := a.Store.NightsLive(ctx, now)
	if err != nil {
		return ""
	}
	for _, n := range nights {
		if n.Mode == mode {
			return n.ID
		}
	}
	return ""
}

func (a *App) handleRoomStream(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	token := SessionTokenFrom(r)
	var seatedID string
	if token != "" {
		ctx, cancel := ctxWithTimeout()
		if p, err := a.Store.PlayerByToken(ctx, token); err == nil {
			seatedID = p.ID
			a.Hub.TouchPlayer(room, p.ID)
		}
		cancel()
	}
	ch, cancel, ok := a.Hub.Subscribe(room.Code)
	if !ok {
		httpx.WriteError(w, apperr.RoomNotFound)
		return
	}
	defer cancel()
	// An open stream renews the seat's lease for the lease time, repeatedly.
	if seatedID != "" {
		stop := make(chan struct{})
		go func() {
			ticker := time.NewTicker(time.Duration(sim.LeaseMs-500) * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case <-r.Context().Done():
					return
				case <-ticker.C:
					a.Hub.TouchPlayer(room, seatedID)
				}
			}
		}()
		defer close(stop)
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.WriteError(w, apperr.NotFound)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, ":ok\n\n")
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case data, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func (a *App) handleRoomJoin(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	player, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	seat, err := a.Hub.Join(room.Code, player.ID, player.Callsign)
	if err != nil {
		if ae, ok := err.(*apperr.Error); ok {
			httpx.WriteError(w, ae)
			return
		}
		httpx.WriteError(w, apperr.RoomsUnavailable)
		return
	}
	state := a.roomStateView(room)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"seat": seat, "state": state})
}

// roomStateView renders the room state without extra locking races.
func (a *App) roomStateView(room *sim.Room) sim.Snapshot {
	now := a.Clock.Now().UTC()
	nowMono := a.Clock.Mono()
	room.RoomLock()
	defer room.RoomUnlock()
	items := a.liveShopItems(now)
	return room.SnapshotState(now, nowMono, items)
}

func (a *App) handleRoomReady(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	player, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	var body struct {
		Ready *bool `json:"ready"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if body.Ready == nil {
		httpx.WriteError(w, apperr.SingleValidation("ready", "Send true or false."))
		return
	}
	room.RoomLock()
	defer room.RoomUnlock()
	if room.PhasePublic() != sim.PhaseLobby {
		httpx.WriteError(w, apperr.WrongPhase)
		return
	}
	player.Ready = *body.Ready
	a.writeRoomStateLocked(w, room)
}

func (a *App) handleRoomStart(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	p, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	room.RoomLock()
	defer room.RoomUnlock()
	if room.HostID != p.ID {
		httpx.WriteError(w, apperr.NotHost)
		return
	}
	if room.PhasePublic() != sim.PhaseLobby {
		httpx.WriteError(w, apperr.WrongPhase)
		return
	}
	if !room.AllReady() {
		httpx.WriteError(w, apperr.NotAllReady)
		return
	}
	room.MatchID = store.NewID()
	room.Start(a.Clock.Mono())
	a.writeRoomStateLocked(w, room)
}

func (a *App) handleRoomEnd(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	p, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	room.RoomLock()
	defer room.RoomUnlock()
	if room.HostID != p.ID {
		httpx.WriteError(w, apperr.NotHost)
		return
	}
	if room.PhasePublic() == sim.PhaseLobby || room.PhasePublic() == sim.PhaseOver {
		httpx.WriteError(w, apperr.WrongPhase)
		return
	}
	room.EndByHost()
	a.writeRoomStateLocked(w, room)
}

func (a *App) handleRoomHeartbeat(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	a.touchFromRequest(room, r)
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) handleRoomLeave(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	player, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	room.RoomLock()
	room.LeavePublic(player, a.Clock.Mono())
	room.RoomUnlock()
	a.writeRoomState(w, room)
}

func (a *App) handleRoomInput(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	player, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	var body struct {
		Seq  *int64   `json:"seq"`
		Move *struct {
			X *float64 `json:"x"`
			Z *float64 `json:"z"`
		} `json:"move"`
		Aim *float64 `json:"aim"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	fields := map[string]string{}
	if body.Seq == nil || *body.Seq < 1 {
		fields["seq"] = "Use a whole number of 1 or more."
	}
	if body.Move == nil || body.Move.X == nil || body.Move.Z == nil {
		fields["move"] = "Send x and z between -1 and 1."
	} else if *body.Move.X < -1 || *body.Move.X > 1 || *body.Move.Z < -1 || *body.Move.Z > 1 {
		fields["move"] = "Send x and z between -1 and 1."
	}
	if body.Aim == nil || *body.Aim < 0 || *body.Aim > 360 {
		fields["aim"] = "Send 0 to 360."
	}
	if len(fields) > 0 {
		httpx.WriteError(w, apperr.Validation(fields))
		return
	}
	room.RoomLock()
	applied := room.MoveIntent(player.ID, *body.Seq, *body.Move.X, *body.Move.Z, *body.Aim)
	room.RoomUnlock()
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"seq": *body.Seq, "applied": applied})
}

// requireSeat authenticates, reconnects and returns the seated player.
func (a *App) requireSeat(w http.ResponseWriter, r *http.Request, room *sim.Room) (*sim.Player, bool) {
	player, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return nil, false
	}
	p, err := a.Hub.EnsureSeated(room, player.ID)
	if err != nil {
		if ae, ok := err.(*apperr.Error); ok {
			httpx.WriteError(w, ae)
			return nil, false
		}
		httpx.WriteError(w, apperr.RoomsUnavailable)
		return nil, false
	}
	return p, true
}



// writeRoomStateLocked writes the room state while the room lock is held.
func (a *App) writeRoomStateLocked(w http.ResponseWriter, room *sim.Room) {
	now := a.Clock.Now().UTC()
	nowMono := a.Clock.Mono()
	items := a.liveShopItems(now)
	snap := room.SnapshotState(now, nowMono, items)
	httpx.WriteJSON(w, http.StatusOK, snap)
}

