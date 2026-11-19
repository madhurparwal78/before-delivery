package sim

import (
	"math"
	"time"

	"github.com/cinderlatch/holdfast/internal/gamemap"
	"github.com/cinderlatch/holdfast/internal/store"
)

// beginRace puts every vehicle on its seat's start position and starts the lap
// clocks.
func (r *Room) beginRace() {
	r.phase = PhaseRace
	r.phaseRemainingMS = 0
	now := time.Now()
	for _, p := range r.seated() {
		spawn := r.spawnFor(p.Seat)
		heading := 0.0
		if spawn.Heading != nil {
			heading = *spawn.Heading
		}
		r.vehicles[p.ID] = &Vehicle{
			PlayerID: p.ID, State: VehicleRunning,
			X: spawn.X, Z: spawn.Z, Heading: heading,
			NextCheckpoint: 1, lastCheckpoint: -1,
			lapStart: now, lastPoseAt: now,
		}
	}
	r.logEvent("phase", map[string]any{"phase": PhaseRace, "wave": 0})
}

// simulateRace runs the reset timers and finishes the race when every seated,
// connected racer has finished three laps.
func (r *Room) simulateRace() {
	for _, p := range r.seated() {
		v, ok := r.vehicles[p.ID]
		if !ok || v.State != VehicleWrecked {
			continue
		}
		v.ResetRemainingMS -= tickMS
		if v.ResetRemainingMS > 0 {
			continue
		}
		v.ResetRemainingMS = 0
		r.resetVehicle(p, v)
	}

	racers := 0
	for _, p := range r.seated() {
		if p.Connection == ConnLeft {
			continue
		}
		racers++
		if v, ok := r.vehicles[p.ID]; !ok || v.State != VehicleFinished {
			return
		}
	}
	if racers > 0 {
		r.endMatch(ResultFinished)
	}
}

// resetVehicle places a wrecked vehicle at its last passed checkpoint, facing
// the next one, and runs it again.
func (r *Room) resetVehicle(p *Player, v *Vehicle) {
	from := r.checkpoint(StartFinishIndex)
	if v.lastCheckpoint >= 0 {
		from = r.checkpoint(v.lastCheckpoint)
	}
	next := r.checkpoint(v.NextCheckpoint)

	v.X, v.Z = from.X, from.Z
	v.Heading = headingTowards(from.X, from.Z, next.X, next.Z)
	v.State = VehicleRunning
	v.lastPoseAt = time.Now()
	r.logEvent("reset", map[string]any{
		"player": p.ID, "callsign": p.Callsign, "checkpoint": checkpointNumber(v.lastCheckpoint),
	})
}

func (r *Room) checkpoint(index int) gamemap.Checkpoint {
	for _, c := range r.gmap.Checkpoints {
		if c.Index == index {
			return c
		}
	}
	return r.gmap.Checkpoints[0]
}

// checkpointNumber renders the checkpoint a wreck resets to.
func checkpointNumber(lastCheckpoint int) int {
	if lastCheckpoint < 0 {
		return StartFinishIndex
	}
	return lastCheckpoint
}

// nextCheckpointAfter reports the checkpoint that follows one in the lap order.
func nextCheckpointAfter(index int) int {
	if index >= LastCheckpointIdx {
		return StartFinishIndex
	}
	return index + 1
}

func headingTowards(fromX, fromZ, toX, toZ float64) float64 {
	degrees := math.Atan2(toZ-fromZ, toX-fromX) * 180 / math.Pi
	for degrees < 0 {
		degrees += 360
	}
	for degrees >= 360 {
		degrees -= 360
	}
	return round4(degrees)
}

// pose judges a vehicle pose, in the published order, and resolves wrecks,
// checkpoints and laps.
func (r *Room) pose(p *Player, seq int64, x, z, heading float64) PoseResult {
	v, ok := r.vehicles[p.ID]
	if !ok {
		return PoseResult{Seq: seq, Accepted: false, Reason: ptrString(ReasonNotRacing)}
	}
	refuse := func(reason string) PoseResult {
		return PoseResult{Seq: seq, Accepted: false, Reason: ptrString(reason), Vehicle: r.vehicleView(v)}
	}

	if seq <= v.LastSeq {
		return refuse(ReasonStaleSeq)
	}
	if r.phase != PhaseRace {
		return refuse(ReasonNotRacing)
	}
	switch v.State {
	case VehicleFinished:
		return refuse(ReasonFinished)
	case VehicleWrecked:
		return refuse(ReasonWrecked)
	}

	now := time.Now()
	elapsed := now.Sub(v.lastPoseAt).Seconds()
	travelled := math.Hypot(x-v.X, z-v.Z)
	if travelled > VehicleTopSpeed*elapsed+PoseTolerance {
		return refuse(ReasonTooFast)
	}

	v.LastSeq = seq
	v.lastPoseAt = now

	if r.gmap.SolidAt(x, z) || r.gmap.Outside(x, z) {
		v.State = VehicleWrecked
		v.ResetRemainingMS = VehicleResetMS
		r.logEvent("wrecked", map[string]any{
			"player": p.ID, "callsign": p.Callsign, "checkpoint": checkpointNumber(v.lastCheckpoint),
		})
		return PoseResult{Seq: seq, Accepted: true, Vehicle: r.vehicleView(v)}
	}

	v.X, v.Z, v.Heading = x, z, heading
	r.checkCheckpoint(p, v, now)
	return PoseResult{Seq: seq, Accepted: true, Vehicle: r.vehicleView(v)}
}

// checkCheckpoint passes the next checkpoint when the vehicle reaches it, and
// completes a lap at the start/finish line.
func (r *Room) checkCheckpoint(p *Player, v *Vehicle, now time.Time) {
	next := r.checkpoint(v.NextCheckpoint)
	if math.Hypot(v.X-next.X, v.Z-next.Z) > CheckpointRadius {
		return
	}
	if v.NextCheckpoint != StartFinishIndex {
		v.lastCheckpoint = v.NextCheckpoint
		v.NextCheckpoint = nextCheckpointAfter(v.NextCheckpoint)
		return
	}

	lapMS := int(now.Sub(v.lapStart).Milliseconds())
	v.LapsDone++
	if v.BestLapMS == 0 || lapMS < v.BestLapMS {
		v.BestLapMS = lapMS
	}
	r.laps = append(r.laps, store.Lap{
		ID: store.NewID(), Code: r.code, PlayerID: p.ID, Callsign: p.Callsign,
		LapNo: v.LapsDone, LapMS: lapMS, SetAt: r.clock.Now(),
	})
	r.logEvent("lap", map[string]any{
		"player": p.ID, "callsign": p.Callsign, "lap": v.LapsDone, "lap_ms": lapMS,
	})

	v.lapStart = now
	v.lastCheckpoint = -1
	v.NextCheckpoint = 1
	if v.LapsDone >= LapsToFinish {
		v.State = VehicleFinished
		v.lapClockFrozen = true
		r.logEvent("finished", map[string]any{
			"player": p.ID, "callsign": p.Callsign, "best_lap_ms": v.BestLapMS,
		})
	}
}

// bestLapFor reports a racer's best lap, or zero when they set none.
func (r *Room) bestLapFor(playerID string) int {
	if v, ok := r.vehicles[playerID]; ok {
		return v.BestLapMS
	}
	return 0
}
