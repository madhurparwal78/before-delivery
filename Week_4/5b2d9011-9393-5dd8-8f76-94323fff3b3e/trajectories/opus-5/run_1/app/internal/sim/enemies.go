package sim

import "math"

// advanceEnemies moves every enemy through patrol, detect, pursue, attack and
// dead under the published ranges, speeds and damage.
func (r *Room) advanceEnemies() {
	const dt = float64(tickMS) / 1000

	for _, e := range r.enemies {
		if e.State == EnemyDead {
			continue
		}
		nearest, nearestDist := r.nearestUpPlayer(e.X, e.Z)
		inDetectRange := nearest != nil && nearestDist <= DetectRange

		switch e.State {
		case EnemyPatrol:
			r.patrol(e, dt)
			if inDetectRange && !r.gmap.SegmentBlocked(e.X, e.Z, nearest.X, nearest.Z) {
				e.State = EnemyDetect
				e.detectRemainingMS = DetectDelayMS
			}

		case EnemyDetect:
			if !inDetectRange {
				e.State = EnemyPatrol
				continue
			}
			e.detectRemainingMS -= tickMS
			if e.detectRemainingMS <= 0 {
				e.detectRemainingMS = 0
				e.State = EnemyPursue
				e.targetID = nearest.ID
			}

		case EnemyPursue:
			if !inDetectRange {
				e.State = EnemyPatrol
				e.targetID = ""
				continue
			}
			e.targetID = nearest.ID
			if nearestDist <= AttackRange {
				e.State = EnemyAttack
				e.attackCooldownMS = 0
				continue
			}
			r.pursue(e, nearest, dt)

		case EnemyAttack:
			if !inDetectRange {
				e.State = EnemyPatrol
				e.targetID = ""
				continue
			}
			if nearestDist > AttackRange {
				e.State = EnemyPursue
				continue
			}
			e.targetID = nearest.ID
			e.attackCooldownMS -= tickMS
			if e.attackCooldownMS <= 0 {
				e.attackCooldownMS = AttackIntervalMS
				r.strike(e, nearest)
			}
		}
	}
}

// patrol walks an enemy back and forth along x within its patrol span.
func (r *Room) patrol(e *Enemy, dt float64) {
	step := e.patrolDir * PatrolSpeed * dt
	nextX, nextZ := r.step(e.X, e.Z, step, 0)
	if nextX == e.X {
		e.patrolDir = -e.patrolDir
		return
	}
	if nextX > e.spawnX+PatrolSpan {
		nextX = e.spawnX + PatrolSpan
		e.patrolDir = -e.patrolDir
	}
	if nextX < e.spawnX-PatrolSpan {
		nextX = e.spawnX - PatrolSpan
		e.patrolDir = -e.patrolDir
	}
	e.X, e.Z = nextX, nextZ
}

// pursue walks an enemy towards its target, sliding around solid blocks.
func (r *Room) pursue(e *Enemy, towards *Player, dt float64) {
	dx, dz := towards.X-e.X, towards.Z-e.Z
	length := math.Hypot(dx, dz)
	if length == 0 {
		return
	}
	speed := enemyPursueSpeed(e.Kind) * dt
	e.X, e.Z = r.step(e.X, e.Z, dx/length*speed, dz/length*speed)
}

// strike deals an enemy's attack damage, downing a player it empties.
func (r *Room) strike(e *Enemy, victim *Player) {
	damage := enemyAttackDamage(e.Kind)
	if damage > victim.HP {
		damage = victim.HP
	}
	victim.HP -= damage
	if victim.HP > 0 {
		return
	}
	victim.Status = StatusDowned
	victim.ReviveRemainingMS = ReviveWindowMS
	victim.ReloadRemainingMS = 0
	r.logEvent("player_down", map[string]any{"player": victim.ID, "callsign": victim.Callsign})
}
