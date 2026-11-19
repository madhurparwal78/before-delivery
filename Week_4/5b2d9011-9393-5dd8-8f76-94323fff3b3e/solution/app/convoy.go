package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"time"
)

const (
	topSpeed        = 30.0
	poseSlack       = 0.5
	checkpointReach = 6.0
	resetDelay      = 3 * time.Second
	lapsToFinish    = 3
)

const (
	vehicleRunning  = "running"
	vehicleWrecked  = "wrecked"
	vehicleFinished = "finished"
)

type vehicle struct {
	state      string
	x, z       float64
	heading    float64
	lastSeq    int
	next       int
	lapsDone   int
	lapStart   time.Duration
	lastPoseAt time.Duration
	lastPassed int
	best       int
	resetAt    time.Duration
}

type vehicleJSON struct {
	Player           string  `json:"player"`
	State            string  `json:"state"`
	X                float64 `json:"x"`
	Z                float64 `json:"z"`
	Heading          float64 `json:"heading"`
	LastSeq          int     `json:"last_seq"`
	NextCheckpoint   int     `json:"next_checkpoint"`
	LapsDone         int     `json:"laps_done"`
	LapElapsedMs     int64   `json:"lap_elapsed_ms"`
	BestLapMs        *int    `json:"best_lap_ms"`
	ResetRemainingMs *int64  `json:"reset_remaining_ms"`
}

// checkpointIndex maps a next-checkpoint number (1 to 4, then 0 for the start/finish) to the map.
func (r *room) checkpointAt(number int) checkpoint { return r.gmap.checkpoints[(number+4)%5] }

func (r *room) createVehicles() {
	for _, s := range r.seats {
		sp := r.gmap.spawn(s.number)
		s.vehicle = &vehicle{state: vehicleRunning, x: sp.x, z: sp.z, heading: sp.heading, next: 1}
	}
}

func (r *room) startRace() {
	for _, s := range r.seats {
		s.vehicle.lapStart, s.vehicle.lastPoseAt = r.clockNow, r.clockNow
	}
	r.setPhase(phaseRace)
	r.emit("phase", map[string]any{"phase": phaseRace, "wave": 0})
}

func (r *room) vehicleState(s *seat) vehicleJSON {
	v := s.vehicle
	out := vehicleJSON{Player: s.playerID, State: v.state, X: round3(v.x), Z: round3(v.z), Heading: round3(v.heading),
		LastSeq: v.lastSeq, NextCheckpoint: v.next, LapsDone: v.lapsDone}
	if v.best > 0 {
		best := v.best
		out.BestLapMs = &best
	}
	if r.phase == phaseRace && v.state != vehicleFinished {
		out.LapElapsedMs = (r.clockNow - v.lapStart).Milliseconds()
	}
	if v.state == vehicleWrecked {
		left := max(0, (v.resetAt - r.clockNow).Milliseconds())
		out.ResetRemainingMs = &left
	}
	return out
}

// simulateConvoy resets wrecked vehicles once their reset delay has passed.
func (r *room) simulateConvoy() {
	for _, s := range r.seats {
		v := s.vehicle
		if v.state != vehicleWrecked || r.clockNow < v.resetAt {
			continue
		}
		at := r.checkpointAt(v.lastPassed)
		ahead := r.checkpointAt(v.next)
		v.x, v.z = at.x, at.z
		v.heading = headingTo(at.x, at.z, ahead.x, ahead.z)
		v.state = vehicleRunning
		v.lastPoseAt = r.clockNow
		r.emit("reset", map[string]any{"player": s.playerID})
	}
}

func headingTo(fx, fz, tx, tz float64) float64 {
	deg := math.Atan2(tz-fz, tx-fx) * 180 / math.Pi
	if deg < 0 {
		deg += 360
	}
	return deg
}

type poseBody struct {
	Seq     int      `json:"seq"`
	X       *float64 `json:"x"`
	Z       *float64 `json:"z"`
	Heading *float64 `json:"heading"`
}

func (b poseBody) validate() map[string]string {
	fields := map[string]string{}
	if b.Seq < 1 {
		fields["seq"] = "Use a whole number from 1."
	}
	if b.X == nil {
		fields["x"] = "Send x."
	}
	if b.Z == nil {
		fields["z"] = "Send z."
	}
	if b.Heading == nil || *b.Heading < 0 || *b.Heading > 360 {
		fields["heading"] = "Use a heading from 0 to 360."
	}
	return fields
}

// judgePose applies the pose checks in their published order; a refused pose changes nothing.
func (r *room) judgePose(s *seat, b poseBody) (accepted bool, reason *string) {
	v := s.vehicle
	refuse := func(why string) (bool, *string) { return false, &why }
	switch {
	case v != nil && b.Seq <= v.lastSeq:
		return refuse("stale_seq")
	case r.phase != phaseRace:
		return refuse("not_racing")
	case v.state == vehicleFinished:
		return refuse("finished")
	case v.state == vehicleWrecked:
		return refuse("wrecked")
	}
	elapsed := (r.clockNow - v.lastPoseAt).Seconds()
	if math.Hypot(*b.X-v.x, *b.Z-v.z) > topSpeed*elapsed+poseSlack {
		return refuse("too_fast")
	}
	v.lastSeq = b.Seq
	v.lastPoseAt = r.clockNow
	if !r.gmap.inside(*b.X, *b.Z) || r.gmap.solidAt(*b.X, *b.Z) {
		v.state = vehicleWrecked
		v.resetAt = r.clockNow + resetDelay
		r.emit("wrecked", map[string]any{"player": s.playerID, "checkpoint": v.lastPassed})
		return true, nil
	}
	v.x, v.z, v.heading = *b.X, *b.Z, *b.Heading
	r.passCheckpoint(s)
	return true, nil
}

func (r *room) passCheckpoint(s *seat) {
	v := s.vehicle
	c := r.checkpointAt(v.next)
	if math.Hypot(v.x-c.x, v.z-c.z) > checkpointReach {
		return
	}
	if v.next != 0 {
		v.lastPassed = v.next
		v.next = (v.next + 1) % 5
		return
	}
	lap := int((r.clockNow - v.lapStart).Milliseconds())
	v.lapsDone++
	v.lapStart, v.lastPassed, v.next = r.clockNow, 0, 1
	if v.best == 0 || lap < v.best {
		v.best = lap
	}
	r.emit("lap", map[string]any{"player": s.playerID, "lap": v.lapsDone, "lap_ms": lap})
	record := lapRecord{ID: newID("lap_"), MatchID: r.matchID, PlayerID: s.playerID, Callsign: s.callsign, LapMs: lap, SetAt: r.srv.clock.Now()}
	r.srv.persist.add(func(ctx context.Context) error { return r.srv.store.saveLap(ctx, record) })
	if v.lapsDone >= lapsToFinish {
		v.state = vehicleFinished
		r.emit("finished", map[string]any{"player": s.playerID})
		r.finishRaceIfDone()
	}
}

// finishRaceIfDone ends the race once every connected racer has finished.
func (r *room) finishRaceIfDone() {
	connected := r.connectedSeats()
	for _, s := range connected {
		if s.vehicle.state != vehicleFinished {
			return
		}
	}
	if len(connected) > 0 {
		r.finish("finished")
	}
}

func (h *hub) postPose(w http.ResponseWriter, r *http.Request) error {
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		var body poseBody
		if err := decodeBody(r, &body); err != nil {
			return err
		}
		if rm.degraded != "" {
			return fail("room_paused")
		}
		if fields := body.validate(); len(fields) > 0 {
			return failFields(fields)
		}
		accepted, reason := rm.judgePose(s, body)
		var vehicleOut any
		if s.vehicle != nil {
			vehicleOut = rm.vehicleState(s)
		}
		payload, err := json.Marshal(map[string]any{"seq": body.Seq, "accepted": accepted, "reason": reason, "vehicle": vehicleOut})
		if err != nil {
			return err
		}
		writeStatus(w, http.StatusOK, string(payload))
		return nil
	})
}
