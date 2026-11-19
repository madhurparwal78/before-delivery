package sim

import (
	"math"
	"sort"
	"strconv"
	"time"
)

// target names an enemy or a barrel for damage and chain bookkeeping.
type target struct {
	id     string
	kind   string
	x, z   float64
	radius float64
	enemy  *Enemy
	barrel *Barrel
}

// liveTargets reports the enemies and intact barrels a ray or blast can reach.
func (r *Room) liveTargets() []target {
	out := make([]target, 0, len(r.enemies)+len(r.barrels))
	for _, e := range r.enemies {
		if e.State == EnemyDead {
			continue
		}
		out = append(out, target{id: e.ID, kind: e.Kind, x: e.X, z: e.Z, radius: enemyRadius(e.Kind), enemy: e})
	}
	for _, b := range r.barrels {
		if b.Destroyed {
			continue
		}
		out = append(out, target{id: b.ID, kind: "barrel", x: b.X, z: b.Z, radius: RadiusBarrel, barrel: b})
	}
	return out
}

// applyDamage caps damage at the target's remaining health and reports the
// applied amount and the health after it.
func (r *Room) applyDamage(t target, amount int, owner string) (applied int, hpAfter int, killed bool) {
	if t.enemy != nil {
		applied = amount
		if applied > t.enemy.HP {
			applied = t.enemy.HP
		}
		t.enemy.HP -= applied
		if t.enemy.HP == 0 && t.enemy.State != EnemyDead {
			t.enemy.State = EnemyDead
			killed = true
		}
		if shooter := r.playerByID(owner); shooter != nil {
			shooter.Score += applied
			if killed {
				shooter.Kills++
				r.payKillReward(shooter, t.enemy)
			}
		}
		if killed {
			r.logEvent("kill", map[string]any{
				"enemy": t.enemy.ID, "kind": t.enemy.Kind,
				"killer": owner, "reward": enemyKillReward(t.enemy.Kind),
			})
		}
		return applied, t.enemy.HP, killed
	}

	applied = amount
	if applied > t.barrel.HP {
		applied = t.barrel.HP
	}
	t.barrel.HP -= applied
	if t.barrel.HP == 0 && !t.barrel.Destroyed {
		t.barrel.Destroyed = true
		killed = true
	}
	return applied, t.barrel.HP, killed
}

func (r *Room) payKillReward(shooter *Player, enemy *Enemy) {
	reward := enemyKillReward(enemy.Kind)
	ref := "kill:" + r.code + ":" + enemy.ID
	r.ledger.Post(shooter.ID, AccountRewards, reward, KindKillReward, ref, nil, nil, r.clock.Now())
}

// Shot judges a shot report and resolves it along the aim angle.
func (r *Room) shot(p *Player, aim float64, now time.Time) (bool, string, *ShotOutcome) {
	switch {
	case !r.inWave():
		return false, ReasonNotInWave, nil
	case !p.isUp():
		return false, ReasonNotUp, nil
	case p.ReloadRemainingMS > 0:
		return false, ReasonReloading, nil
	case p.Mag == 0:
		return false, ReasonEmpty, nil
	case p.hasShot && now.Sub(p.lastShotAt) < FireIntervalMS*time.Millisecond:
		return false, ReasonFireInterval, nil
	}

	p.Mag--
	p.lastShotAt = now
	p.hasShot = true
	p.Aim = aim

	outcome := &ShotOutcome{Mag: p.Mag}
	hit, ok := r.castShot(p.X, p.Z, aim)
	if !ok {
		return true, "", outcome
	}

	applied, hpAfter, killed := r.applyDamage(hit, ShotDamage, p.ID)
	outcome.Hit = &ShotHit{
		ID: hit.id, Kind: hit.kind, Damage: applied, HPAfter: hpAfter, Killed: killed,
	}
	if killed && hit.barrel != nil {
		r.resolveExplosions([]blast{{
			source: "barrel:" + hit.barrel.ID, owner: p.ID, x: hit.barrel.X, z: hit.barrel.Z,
			radius: BarrelRadius, maxDamage: BarrelMaxDamage,
		}})
	}
	return true, "", outcome
}

// castShot finds the first enemy or intact barrel the ray crosses before it
// enters a solid block cell.
func (r *Room) castShot(ox, oz, aim float64) (target, bool) {
	rad := aim * math.Pi / 180
	dx, dz := math.Cos(rad), math.Sin(rad)
	blockDist := r.gmap.RayBlockDistance(ox, oz, dx, dz)

	var best target
	bestDist := ShotRange
	found := false
	for _, t := range r.liveTargets() {
		dist, ok := rayCircle(ox, oz, dx, dz, t.x, t.z, t.radius)
		if !ok || dist > bestDist || dist >= blockDist {
			continue
		}
		best, bestDist, found = t, dist, true
	}
	return best, found
}

// rayCircle reports where a unit ray first crosses a circle.
func rayCircle(ox, oz, dx, dz, cx, cz, radius float64) (float64, bool) {
	fx, fz := ox-cx, oz-cz
	b := 2 * (fx*dx + fz*dz)
	c := fx*fx + fz*fz - radius*radius
	if c <= 0 {
		return 0, true
	}
	discriminant := b*b - 4*c
	if discriminant < 0 {
		return 0, false
	}
	root := math.Sqrt(discriminant)
	near := (-b - root) / 2
	if near >= 0 {
		return near, true
	}
	far := (-b + root) / 2
	if far >= 0 {
		return far, true
	}
	return 0, false
}

// reload judges a reload report. The rounds move after the reload duration.
func (r *Room) reload(p *Player) (bool, string, *ReloadOutcome) {
	switch {
	case p.ReloadRemainingMS > 0:
		return false, ReasonReloading, nil
	case p.Mag >= MagSize || p.Reserve == 0:
		return false, ReasonNothingToReload, nil
	case !p.isUp():
		return false, ReasonNotUp, nil
	}
	p.ReloadRemainingMS = ReloadMS
	return true, "", &ReloadOutcome{ReloadMS: ReloadMS}
}

// grenade judges a grenade report. The grenade lands at once and detonates when
// its fuse ends.
func (r *Room) grenade(p *Player, x, z float64) (bool, string, *GrenadeOutcome) {
	switch {
	case !r.inWave():
		return false, ReasonNotInWave, nil
	case !p.isUp():
		return false, ReasonNotUp, nil
	case p.Grenades == 0:
		return false, ReasonNoGrenades, nil
	case math.Hypot(x-p.X, z-p.Z) > GrenadeThrowRange:
		return false, ReasonOutOfRange, nil
	}
	p.Grenades--
	r.grenadeSeq++
	id := "g" + strconv.Itoa(r.grenadeSeq)
	r.grenades = append(r.grenades, &Grenade{
		ID: id, Owner: p.ID, X: x, Z: z, FuseRemainingMS: GrenadeFuseMS,
	})
	return true, "", &GrenadeOutcome{GrenadeID: id, DetonatesInMS: GrenadeFuseMS}
}

// revive judges a revive report.
func (r *Room) revive(p *Player, targetID string) (bool, string, *ReviveOutcome) {
	if !p.isUp() {
		return false, ReasonNotUp, nil
	}
	if targetID == p.ID {
		return false, ReasonSelfRevive, nil
	}
	downed := r.playerByID(targetID)
	if downed == nil {
		return false, ReasonNotDowned, nil
	}
	if math.Hypot(downed.X-p.X, downed.Z-p.Z) > ReviveRange {
		return false, ReasonTooFar, nil
	}
	if downed.Status != StatusDowned {
		return false, ReasonNotDowned, nil
	}
	if downed.ReviveRemainingMS <= 0 {
		return false, ReasonWindowClosed, nil
	}

	downed.Status = StatusUp
	downed.HP = ReviveHP
	downed.ReviveRemainingMS = 0
	r.logEvent("player_revived", map[string]any{
		"player": downed.ID, "callsign": downed.Callsign, "by": p.ID,
	})
	return true, "", &ReviveOutcome{Revived: downed.ID}
}

// blast is one pending explosion.
type blast struct {
	source    string
	owner     string
	x, z      float64
	radius    float64
	maxDamage float64
}

// explosionHit is one entity an explosion damaged.
type explosionHit struct {
	ID       string  `json:"id"`
	Damage   int     `json:"damage"`
	Distance float64 `json:"distance"`
}

// falloff reports an explosion's damage at a distance.
func falloff(distance, radius, maxDamage float64) int {
	switch {
	case distance <= BlastCoreRadius:
		return int(maxDamage)
	case distance >= radius:
		return 0
	default:
		span := radius - BlastCoreRadius
		return int(math.Floor(maxDamage*(radius-distance)/span + 0.5))
	}
}

// resolveExplosions works the blast queue first in, first out within one tick.
// Barrels a blast destroys join the queue by increasing distance from it, ties by
// barrel id ascending, and each barrel explodes exactly once.
func (r *Room) resolveExplosions(queue []blast) {
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		hits := []explosionHit{}
		blocked := []string{}
		type pending struct {
			t      target
			damage int
		}
		var applyList []pending

		for _, t := range r.liveTargets() {
			distance := math.Hypot(t.x-current.x, t.z-current.z)
			damage := falloff(distance, current.radius, current.maxDamage)
			if damage == 0 {
				continue
			}
			if r.gmap.SegmentBlocked(current.x, current.z, t.x, t.z) {
				blocked = append(blocked, t.id)
				continue
			}
			applyList = append(applyList, pending{t: t, damage: damage})
			hits = append(hits, explosionHit{
				ID: t.id, Damage: damage, Distance: math.Round(distance*100) / 100,
			})
		}

		type chained struct {
			id       string
			distance float64
			x, z     float64
		}
		var chains []chained
		for i, item := range applyList {
			applied, _, killed := r.applyDamage(item.t, item.damage, current.owner)
			hits[i].Damage = applied
			if killed && item.t.barrel != nil {
				chains = append(chains, chained{
					id:       item.t.barrel.ID,
					distance: math.Hypot(item.t.barrel.X-current.x, item.t.barrel.Z-current.z),
					x:        item.t.barrel.X,
					z:        item.t.barrel.Z,
				})
			}
		}

		r.logEvent("explosion", map[string]any{
			"source": current.source, "owner": current.owner,
			"x": round4(current.x), "z": round4(current.z),
			"hits": hits, "blocked": blocked,
		})

		sort.Slice(chains, func(i, j int) bool {
			if chains[i].distance != chains[j].distance {
				return chains[i].distance < chains[j].distance
			}
			return chains[i].id < chains[j].id
		})
		for _, c := range chains {
			queue = append(queue, blast{
				source: "barrel:" + c.id, owner: current.owner, x: c.x, z: c.z,
				radius: BarrelRadius, maxDamage: BarrelMaxDamage,
			})
		}
	}
}
