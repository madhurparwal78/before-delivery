package sim

import (
	"time"
)

// PhaseEndMono is the monotonic instant the current phase timer ends. The
// phaseRemainingMs bookkeeping keeps a countdown target so a freeze can
// resume from the same remaining milliseconds.
type timerState struct {
	// phaseEndMono is where PhaseRemainingMs counts to.
	phaseEndMono int64
}

// Start begins the match: countdown of 5,000 ms.
func (r *Room) Start(nowMono int64) {
	r.Phase = PhaseCountdown
	rem := int64(CountdownMs)
	r.PhaseRemainingMs = &rem
	r.phaseEndMono = nowMono + CountdownMs
	r.StartedAt = time.Now().UTC()
	if r.Mode == "convoy" {
		r.Log(r.Tick, "phase", map[string]any{"phase": "countdown"})
	} else {
		r.Log(r.Tick, "phase", map[string]any{"phase": "countdown"})
	}
}

// EndByHost ends the match with result ended.
func (r *Room) EndByHost() {
	r.finish("ended")
}

// TickOnce advances the simulation one tick. wallNow converts a remaining-ms
// value to the monotonic deadline convention used by phaseAdvance.
func (r *Room) TickOnce() {
	if r.Phase == PhaseOver {
		r.Tick++
		return
	}
	if r.Frozen {
		// Degraded: every match timer and enemy is frozen.
		return
	}
	nowMono := r.Clock.Mono()
	r.Tick++
	r.movePlayers()
	r.moveEnemies(nowMono)
	r.completeReloads(nowMono)
	r.detonateGrenades(nowMono)
	r.resolveExplosions(nowMono)
	r.expireReviveWindows(nowMono)
	r.advancePhaseTimers(nowMono)
	r.resetWrecked(nowMono)
	r.expireLeases(nowMono)
}

// advancePhaseTimers runs the room state machine with the countdown and
// intermission deadlines.
func (r *Room) advancePhaseTimers(nowMono int64) {
	switch r.Phase {
	case PhaseCountdown:
		if nowMono >= r.phaseEndMono {
			if r.Mode == "convoy" {
				r.beginRace(nowMono)
			} else {
				r.beginWave(1)
			}
		}
	case PhaseIntermission:
		if nowMono >= r.phaseEndMono {
			next := r.Wave + 1
			if next > 3 {
				r.beginWave(4)
			} else {
				r.beginWave(next)
			}
		}
	case PhaseWave:
		if len(r.aliveEnemies()) == 0 {
			r.clearWave(nowMono)
		}
	case PhaseBossWave:
		if len(r.aliveEnemies()) == 0 {
			r.clearBossWave(nowMono)
		}
	case PhaseRace:
		r.checkRaceEnd()
	}
}

// beginRace starts the convoy race from countdown.
func (r *Room) beginRace(nowMono int64) {
	r.Phase = PhaseRace
	r.PhaseRemainingMs = nil
	now := time.Now().UTC()
	r.StartedAt = now
	for _, p := range r.PlayersInSeatOrder() {
		st := r.Map.StartFor(p.Seat)
		v := &Vehicle{
			Player:        p.ID,
			State:         "running",
			X:             st.X,
			Z:             st.Z,
			Heading:       st.Heading,
			LastSeq:       0,
			LastPoseAt:    nowMono,
			NextCheckpoint: "C1",
			LapStartAt:    nowMono,
		}
		r.Vehicles[p.ID] = v
	}
	r.Log(r.Tick, "phase", map[string]any{"phase": "race"})
}

// checkRaceEnd finishes the race when every seated, connected racer has
// finished three laps.
func (r *Room) checkRaceEnd() {
	anyRacer := false
	allDone := true
	for _, p := range r.Players {
		if p.Connection == Left {
			continue
		}
		v := r.Vehicles[p.ID]
		if v == nil {
			continue
		}
		anyRacer = true
		if v.State != "finished" {
			allDone = false
		}
	}
	if anyRacer && allDone {
		r.finish("finished")
	}
}

// expireLeases marks players whose lease has lapsed disconnected and starts
// their reconnect grace; it releases seats whose grace has run out.
func (r *Room) expireLeases(nowMono int64) {
	for _, p := range r.Players {
		if p.Connection == Connected && nowMono >= p.LeaseUntil {
			p.Connection = Disconnected
			grace := nowMono + ReconnectGraceMs
			p.GraceUntil = &grace
			r.Log(r.Tick, "disconnected", map[string]any{"player": p.ID})
			if r.HostID == p.ID {
				r.migrateHost()
			}
		}
		if p.Connection == Disconnected && p.GraceUntil != nil && nowMono >= *p.GraceUntil {
			r.releaseSeat(p)
		}
	}
}

// releaseSeat releases a player's seat when their grace has run out.
func (r *Room) releaseSeat(p *Player) {
	if r.Phase == PhaseLobby || r.Phase == PhaseOver {
		delete(r.Seats, p.Seat)
		delete(r.Players, p.ID)
	} else {
		p.Connection = Left
		p.GraceUntil = nil
		r.Log(r.Tick, "released", map[string]any{"player": p.ID})
	}
	if r.HostID == p.ID {
		r.migrateHost()
	}
	if r.seatsAllReleased() {
		r.finish("ended")
	}
}

// migrateHost passes hosting to the connected player with the lowest seat.
func (r *Room) migrateHost() {
	id, ok := r.LowestConnectedSeat()
	if !ok {
		return
	}
	if id == r.HostID {
		return
	}
	r.HostID = id
	if p := r.Players[id]; p != nil {
		r.Log(r.Tick, "host_changed", map[string]any{"player": id, "callsign": p.Callsign})
	}
}

// seatsAllReleased reports whether every seat is gone.
func (r *Room) seatsAllReleased() bool {
	for _, p := range r.Players {
		if p.Connection != Left {
			return false
		}
	}
	return len(r.Players) == 0 || r.allLeft()
}

func (r *Room) allLeft() bool {
	for seat, id := range r.Seats {
		p := r.Players[id]
		_ = seat
		if p != nil && p.Connection != Left {
			return false
		}
	}
	// No seats at all counts as all released.
	return true
}

// Reconnect restores a player's connection while their grace has time left.
func (r *Room) Reconnect(p *Player, nowMono int64) bool {
	if p.Connection == Disconnected && p.GraceUntil != nil && nowMono < *p.GraceUntil {
		p.Connection = Connected
		p.LeaseUntil = nowMono + LeaseMs
		p.GraceUntil = nil
		r.Log(r.Tick, "reconnected", map[string]any{"player": p.ID})
		if r.HostID == "" {
			r.HostID = p.ID
			r.Log(r.Tick, "host_changed", map[string]any{"player": p.ID, "callsign": p.Callsign})
		}
		return true
	}
	return false
}

// Touch renews a seat's lease.
func (r *Room) Touch(p *Player, nowMono int64) {
	p.LeaseUntil = nowMono + LeaseMs
}

// Leave handles a player's leave: the grace starts at once during a match; in
// the lobby the seat is freed immediately.
func (r *Room) Leave(p *Player, nowMono int64) {
	if r.Phase == PhaseLobby {
		delete(r.Seats, p.Seat)
		delete(r.Players, p.ID)
		if r.HostID == p.ID {
			r.HostID = ""
			r.migrateHost()
		}
		return
	}
	p.Connection = Left
	p.GraceUntil = nil
	r.Log(r.Tick, "released", map[string]any{"player": p.ID})
	if r.HostID == p.ID {
		r.migrateHost()
	}
	if r.seatsAllReleased() {
		r.finish("ended")
	}
}

// Freeze freezes every match timer while the room registry is down.
func (r *Room) Freeze(nowMono int64) {
	if r.Frozen {
		return
	}
	r.Frozen = true
	r.FreezeAtMono = nowMono
}

// Unfreeze rewrites the room's frozen timers so they resume from the same
// remaining milliseconds.
func (r *Room) Unfreeze(nowMono int64) {
	if !r.Frozen {
		return
	}
	frozen := nowMono - r.FreezeAtMono
	// Move every deadline forward by the frozen duration.
	if r.Phase == PhaseCountdown || r.Phase == PhaseIntermission {
		r.phaseEndMono += frozen
	}
	for _, p := range r.Players {
		if p.ReloadUntil != nil {
			*p.ReloadUntil += frozen
		}
		if p.ReviveUntil != nil {
			*p.ReviveUntil += frozen
		}
		if p.GraceUntil != nil {
			*p.GraceUntil += frozen
		}
		p.LeaseUntil += frozen
	}
	for _, g := range r.Grenades {
		g.DetonateAt += frozen
	}
	for _, v := range r.Vehicles {
		v.LapStartAt += frozen
		if v.ResetAt != nil {
			*v.ResetAt += frozen
		}
		v.LastPoseAt += frozen
	}
	r.Frozen = false
	r.Degraded = ""
}
