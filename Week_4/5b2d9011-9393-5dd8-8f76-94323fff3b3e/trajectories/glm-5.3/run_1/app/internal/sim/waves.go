package sim

// beginWave starts a wave, or the boss wave for n == 4.
func (r *Room) beginWave(n int) {
	r.Wave = n
	r.PhaseRemainingMs = nil
	if n == 4 {
		r.Phase = PhaseBossWave
		r.Log(r.Tick, "phase", map[string]any{"phase": "boss_wave", "wave": 4})
	} else {
		r.Phase = PhaseWave
		r.Log(r.Tick, "phase", map[string]any{"phase": "wave", "wave": n})
	}
	r.spawnWave(n - 1)
}

// clearWave ends a wave, pays the wave bonus and starts its intermission.
func (r *Room) clearWave(nowMono int64) {
	r.Log(r.Tick, "wave_cleared", map[string]any{"wave": r.Wave})
	r.payWaveBonus()
	r.Phase = PhaseIntermission
	rem := int64(IntermissionMs)
	r.PhaseRemainingMs = &rem
	r.phaseEndMono = nowMono + IntermissionMs
	next := r.Wave + 1
	r.Log(r.Tick, "phase", map[string]any{"phase": "intermission", "wave": r.Wave, "to_wave": next, "intermission_ms": IntermissionMs})
	r.respawnOutPlayers()
}

// clearBossWave clears the boss wave, pays the bonus and ends the match in
// victory in the same tick.
func (r *Room) clearBossWave(nowMono int64) {
	r.Log(r.Tick, "wave_cleared", map[string]any{"wave": 4})
	r.payWaveBonus()
	r.finish("victory")
}

// endDefeat ends the match in defeat.
func (r *Room) endDefeat() {
	if r.Phase == PhaseOver {
		return
	}
	r.finish("defeat")
}

// payWaveBonus pays every up player the wave bonus.
func (r *Room) payWaveBonus() {
	for _, p := range r.Players {
		if p.Status == Up && p.Connection != Left {
			p.Credits += WaveBonusCredits
			r.recordCredit(p.ID, WaveBonusCredits, "wave_bonus", "wave:"+waveRef(r.Wave))
		}
	}
}

// waveRef renders the wave number for a ledger ref.
func waveRef(n int) string {
	if n == 0 {
		return "0"
	}
	var b [4]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// respawnOutPlayers respawns out players at their seat's spawn point at the
// start of an intermission.
func (r *Room) respawnOutPlayers() {
	for _, p := range r.Players {
		if p.Status == Out && p.Connection != Left {
			sp := r.Map.SpawnFor(p.Seat)
			p.Status = Up
			p.HP = MaxHP
			p.X, p.Z = sp.X, sp.Z
			p.Aim = sp.Aim
			p.Mag = MagSize
			r.Log(r.Tick, "player_respawned", map[string]any{"player": p.ID, "callsign": p.Callsign})
		}
	}
}

// finish ends the match with a result.
func (r *Room) finish(result string) {
	r.Phase = PhaseOver
	r.PhaseRemainingMs = nil
	r.Result = result
	r.Log(r.Tick, "phase", map[string]any{"phase": "over", "result": result})
}

// aliveEnemies lists living enemies.
func (r *Room) aliveEnemies() []*Enemy {
var out []*Enemy
for _, e := range r.Enemies {
if e.State != "dead" {
out = append(out, e)
}
}
return out
}
