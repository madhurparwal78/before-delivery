package sim

import (
	"math"

	"holdfast/internal/maps"
)

// MoveIntent applies a movement intent with its sequence number.
func (r *Room) MoveIntent(playerID string, seq int64, moveX, moveZ, aim float64) bool {
	p := r.Players[playerID]
	if p == nil {
		return false
	}
	if seq <= p.LastInputSeq {
		return false
	}
	p.LastInputSeq = seq
	if moveX > 1 {
		moveX = 1
	}
	if moveX < -1 {
		moveX = -1
	}
	if moveZ > 1 {
		moveZ = 1
	}
	if moveZ < -1 {
		moveZ = -1
	}
	p.MoveX = moveX
	p.MoveZ = moveZ
	p.Aim = normalizeAngle(aim)
	return true
}

func normalizeAngle(a float64) float64 {
	for a < 0 {
		a += 360
	}
	for a >= 360 {
		a -= 360
	}
	return a
}

// movePlayers moves each up player by its latest intent at the published
// speed, never into a solid block cell or past the map edge.
func (r *Room) movePlayers() {
	if r.Phase != PhaseWave && r.Phase != PhaseBossWave && r.Phase != PhaseCountdown && r.Phase != PhaseIntermission {
		return
	}
	for _, p := range r.Players {
		if p.Status != Up || p.Connection == Left {
			continue
		}
		if r.Phase != PhaseWave && r.Phase != PhaseBossWave {
			// Between waves players may still walk; the rules let a squad
			// regroup during intermission.
			p.MoveX, p.MoveZ = 0, 0
			continue
		}
		len_ := math.Hypot(p.MoveX, p.MoveZ)
		if len_ == 0 {
			continue
		}
		if len_ > 1 {
			p.MoveX /= len_
			p.MoveZ /= len_
			len_ = 1
		}
		dist := MoveSpeed * (float64(TickMs) / 1000.0) * len_
		nx := p.X + p.MoveX*dist
		nz := p.Z + p.MoveZ*dist
		if nx < 0 {
			nx = 0
		}
		if nz < 0 {
			nz = 0
		}
		if nx > r.Map.Width {
			nx = r.Map.Width
		}
		if nz > r.Map.Depth {
			nz = r.Map.Depth
		}
		// Slide along the blocking axis: try x first, then z.
		if !r.Map.SolidAt(nx, nz) {
			p.X, p.Z = nx, nz
		} else if !r.Map.SolidAt(nx, p.Z) {
			p.X = nx
		} else if !r.Map.SolidAt(p.X, nz) {
			p.Z = nz
		}
	}
}

// spawnWave spawns the given wave's enemies and barrels' initial state.
func (r *Room) spawnWave(waveIdx int) {
	r.Enemies = map[string]*Enemy{}
	for _, e := range r.Map.Waves[waveIdx].Enemies {
		r.Enemies[e.ID] = &Enemy{
			ID:      e.ID,
			Kind:    e.Kind,
			State:   "patrol",
			SpawnX:  e.X,
			SpawnZ:  e.Z,
			X:       e.X,
			Z:       e.Z,
			HP:      enemyHP(e.Kind),
		}
	}
}

func enemyHP(kind string) int {
	switch kind {
	case "grunt":
		return GruntHP
	case "brute":
		return BruteHP
	default:
		return BossHP
	}
}

func enemyRadius(kind string) float64 {
	switch kind {
	case "grunt":
		return GruntRadius
	case "brute":
		return BruteRadius
	default:
		return BossRadius
	}
}

func enemySpeed(kind string) float64 {
	switch kind {
	case "grunt":
		return GruntSpeed
	case "brute":
		return BruteSpeed
	default:
		return BossSpeed
	}
}

func enemyDamage(kind string) int {
	switch kind {
	case "grunt":
		return GruntDamage
	case "brute":
		return BruteDamage
	default:
		return BossDamage
	}
}

// moveEnemies advances patrol, detect, pursue and attack each tick.
func (r *Room) moveEnemies(nowMono int64) {
	if r.Phase != PhaseWave && r.Phase != PhaseBossWave {
		return
	}
	dt := float64(TickMs) / 1000.0
	for _, e := range r.Enemies {
		if e.State == "dead" {
			continue
		}
		// Find nearest up player with line of sight for detection.
		targetID, targetDist, targetLOS := r.nearestUpPlayer(e)
		switch e.State {
		case "patrol":
			// Patrol back and forth along x between spawn x - 2 and + 2.
			dir := 1.0
			if e.patrolDir() {
				dir = -1
			}
			nx := e.X + dir*PatrolSpeed*dt
			if nx > e.SpawnX+PatrolSpan {
				nx = e.SpawnX + PatrolSpan
				e.flipPatrol()
			} else if nx < e.SpawnX-PatrolSpan {
				nx = e.SpawnX - PatrolSpan
				e.flipPatrol()
			}
			e.X = nx
			if targetID != "" && targetDist <= DetectRange && targetLOS {
				e.State = "detect"
				t := nowMono
				e.DetectSince = &t
			}
		case "detect":
			if targetID == "" || targetDist > DetectRange || !targetLOS {
				e.State = "patrol"
				e.DetectSince = nil
				continue
			}
			if e.DetectSince != nil && nowMono-*e.DetectSince >= DetectDelayMs {
				e.State = "pursue"
			}
		case "pursue":
			if targetID == "" {
				e.State = "patrol"
				continue
			}
			if targetID == "" || targetDist > DetectRange {
				e.State = "patrol"
				continue
			}
			p := r.Players[targetID]
			if p == nil {
				e.State = "patrol"
				continue
			}
			if targetDist <= AttackRange {
				e.State = "attack"
				e.TargetID = targetID
				continue
			}
			r.stepToward(e, p.X, p.Z, enemySpeed(e.Kind)*dt)
		case "attack":
			p := r.Players[e.TargetID]
			if p == nil || p.Status != Up || p.Connection == Left {
				e.State = "pursue"
				e.TargetID = ""
				continue
			}
			dist := maps.Distance(e.X, e.Z, p.X, p.Z)
			if dist > AttackRange {
				e.State = "pursue"
				continue
			}
			if e.LastAttack == nil || nowMono-*e.LastAttack >= AttackCooldownMs {
				t := nowMono
				e.LastAttack = &t
				r.damagePlayer(p, enemyDamage(e.Kind))
			}
		}
	}
}

// nearestUpPlayer finds the nearest up player, its distance and whether the
// line between them is clear of solid blocks.
func (r *Room) nearestUpPlayer(e *Enemy) (string, float64, bool) {
	bestID := ""
	bestDist := math.MaxFloat64
	bestLOS := false
	for _, p := range r.Players {
		if p.Status != Up || p.Connection == Left {
			continue
		}
		d := maps.Distance(e.X, e.Z, p.X, p.Z)
		if d < bestDist {
			bestDist = d
			bestID = p.ID
			bestLOS = !r.Map.SegmentBlocked(e.X, e.Z, p.X, p.Z)
		}
	}
	return bestID, bestDist, bestLOS
}

// stepToward moves an enemy towards a point, never into a solid cell.
func (r *Room) stepToward(e *Enemy, tx, tz float64, dist float64) {
	dx := tx - e.X
	dz := tz - e.Z
	d := math.Hypot(dx, dz)
	if d == 0 {
		return
	}
	if dist > d {
		dist = d
	}
	nx := e.X + dx/d*dist
	nz := e.Z + dz/d*dist
	if !r.Map.SolidAt(nx, nz) {
		e.X, e.Z = nx, nz
		return
	}
	// Route around: try each axis.
	if !r.Map.SolidAt(nx, e.Z) {
		e.X = nx
		return
	}
	if !r.Map.SolidAt(e.X, nz) {
		e.Z = nz
		return
	}
	// Sidestep perpendicular to the block face.
	px, pz := -dz/d, dx/d
	sx := e.X + px*dist
	sz := e.Z + pz*dist
	if !r.Map.SolidAt(sx, sz) {
		e.X, e.Z = sx, sz
	}
}

// damagePlayer applies enemy damage; zero health downs the player.
func (r *Room) damagePlayer(p *Player, dmg int) {
	if p.Status != Up {
		return
	}
	p.HP -= dmg
	if p.HP <= 0 {
		p.HP = 0
		p.Status = Downed
		until := r.Clock.Mono() + ReviveWindowMs
		p.ReviveUntil = &until
		r.Log(r.Tick, "player_down", map[string]any{"player": p.ID, "callsign": p.Callsign})
		if r.UpCount() == 0 {
			r.endDefeat()
		}
	}
}
