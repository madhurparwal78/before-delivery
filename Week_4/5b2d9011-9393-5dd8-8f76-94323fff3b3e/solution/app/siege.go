package main

import (
	"math"
	"sort"
	"strconv"
	"time"
)

const (
	startHealth     = 100
	magazineSize    = 30
	startReserve    = 90
	maxReserve      = 270
	startGrenades   = 2
	maxGrenades     = 3
	revivedHealth   = 50
	barrelHealth    = 30
	barrelRadiusHit = 0.4

	playerSpeed  = 4.0
	fireInterval = 100 * time.Millisecond
	shotDamage   = 20
	shotRange    = 40.0
	grenadeRange = 15.0
	reviveRange  = 2.0
	detectRange  = 14.0
	attackRange  = 1.5
	waveBonus    = 100

	detectTicks         = 10
	attackCooldownTicks = 20
	secondsPerTick      = 0.05
	wallEpsilon         = 1e-3
	bossWaveNumber      = 4
)

type enemyKind struct {
	hp     int
	radius float64
	pursue float64
	damage int
	reward int
}

var enemyKinds = map[string]enemyKind{
	"grunt": {hp: 60, radius: 0.5, pursue: 2.5, damage: 10, reward: 50},
	"brute": {hp: 240, radius: 0.7, pursue: 2.0, damage: 20, reward: 150},
	"boss":  {hp: 1000, radius: 1.0, pursue: 1.5, damage: 25, reward: 1000},
}

const patrolSpeed = 1.0
const patrolReach = 2.0

type enemy struct {
	id, kind, state string
	hp              int
	x, z            float64
	spawnX, spawnZ  float64
	dir             float64
	detectEnd       int
	attackReady     int
}

type barrel struct {
	id        string
	x, z      float64
	hp        int
	destroyed bool
}

type grenade struct {
	id      string
	owner   string
	x, z    float64
	fuseEnd time.Duration
}

type ledgerEntry struct {
	id        string
	account   string
	amount    int
	kind      string
	ref       string
	item      string
	unitPrice int
	at        time.Time
}

// inWave reports whether a wave is running (waves 1 to 3 or the boss wave).
func (r *room) inWave() bool { return r.phase == phaseWave || r.phase == phaseBossWave }

func (r *room) liveEnemies() []*enemy {
	var out []*enemy
	for _, e := range r.enemies {
		if e.state != "dead" {
			out = append(out, e)
		}
	}
	return out
}

// ---- phases

func (r *room) startWave(n int) {
	r.wave = n
	phase := phaseWave
	if n == bossWaveNumber {
		phase = phaseBossWave
	}
	r.enemies = r.enemies[:0]
	for _, sp := range r.gmap.waves[n-1] {
		kind := enemyKinds[sp.kind]
		r.enemies = append(r.enemies, &enemy{id: sp.id, kind: sp.kind, state: "patrol", hp: kind.hp,
			x: sp.x, z: sp.z, spawnX: sp.x, spawnZ: sp.z, dir: 1})
	}
	r.setPhase(phase)
	r.emit("phase", map[string]any{"phase": phase, "wave": n})
}

// checkWaveEnd ends the wave the moment its last enemy is dead.
func (r *room) checkWaveEnd() {
	if !r.inWave() || len(r.liveEnemies()) > 0 {
		return
	}
	r.emit("wave_cleared", map[string]any{"wave": r.wave})
	r.wavesCleared++
	for _, s := range r.seats {
		if s.status == statusUp {
			r.pay(s, waveBonus, "wave_bonus", "", 0)
		}
	}
	if r.wave == bossWaveNumber {
		r.finish("victory")
		return
	}
	for _, s := range r.seats {
		if s.status == statusOut && s.connection != connLeft {
			sp := r.gmap.spawn(s.number)
			s.status, s.hp, s.x, s.z, s.aim = statusUp, startHealth, sp.x, sp.z, sp.heading
			s.mag = magazineSize
			r.emit("player_respawned", map[string]any{"player": s.playerID})
		}
	}
	r.phaseEndTick = r.tick + intermissionTicks
	r.setPhase(phaseIntermission)
	r.emit("phase", map[string]any{"phase": phaseIntermission, "wave": r.wave, "remaining_ms": intermissionTicks * int(tickDur.Milliseconds())})
}

func (r *room) checkDefeat() {
	for _, s := range r.seats {
		if s.status == statusUp {
			return
		}
	}
	r.finish("defeat")
}

func (r *room) simulateSiege() {
	r.finishReloads()
	r.movePlayers()
	r.stepGrenades()
	if r.phase == phaseOver {
		return
	}
	r.stepEnemies()
	r.expireRevives()
	r.checkDefeat()
}

func (r *room) finishReloads() {
	for _, s := range r.seats {
		if s.reloading && r.tickTime() >= s.reloadEnd {
			fill := min(magazineSize-s.mag, s.reserve)
			s.mag += fill
			s.reserve -= fill
			s.reloading = false
		}
	}
}

func (r *room) expireRevives() {
	for _, s := range r.seats {
		if s.status == statusDowned && r.tickTime() >= s.reviveEnd {
			s.status = statusOut
			r.emit("player_out", map[string]any{"player": s.playerID})
		}
	}
}

// ---- movement

func (r *room) movePlayers() {
	for _, s := range r.seats {
		if s.status != statusUp || (s.moveX == 0 && s.moveZ == 0) {
			continue
		}
		mx, mz := s.moveX, s.moveZ
		if length := math.Hypot(mx, mz); length > 1 {
			mx, mz = mx/length, mz/length
		}
		step := playerSpeed * secondsPerTick
		s.x = r.slide(s.x, s.z, mx*step, true)
		s.z = r.slide(s.x, s.z, mz*step, false)
	}
}

// slide moves along one axis, stopping at a solid block cell or the map edge.
func (r *room) slide(x, z, delta float64, alongX bool) float64 {
	pos, other, limit := x, z, r.gmap.width
	if !alongX {
		pos, other, limit = z, x, r.gmap.depth
	}
	next := pos + delta
	if next < 0 {
		return 0
	}
	if next > limit {
		return limit
	}
	probeX, probeZ := next, other
	if !alongX {
		probeX, probeZ = other, next
	}
	if !r.gmap.solidAt(probeX, probeZ) {
		return next
	}
	if delta > 0 {
		return math.Floor(next) - wallEpsilon
	}
	return math.Floor(next) + 1 + wallEpsilon
}

// ---- enemies

func nearestUp(seats []*seat, x, z float64) (*seat, float64) {
	var best *seat
	bestD := math.Inf(1)
	for _, s := range seats {
		if s.status != statusUp {
			continue
		}
		if d := math.Hypot(s.x-x, s.z-z); d < bestD {
			best, bestD = s, d
		}
	}
	return best, bestD
}

func (r *room) stepEnemies() {
	for _, e := range r.enemies {
		if e.state == "dead" {
			continue
		}
		target, dist := nearestUp(r.seats, e.x, e.z)
		inRange := target != nil && dist <= detectRange
		kind := enemyKinds[e.kind]
		switch e.state {
		case "patrol":
			if inRange && !r.gmap.segmentBlocked(e.x, e.z, target.x, target.z) {
				e.state, e.detectEnd = "detect", r.tick+detectTicks
				continue
			}
			r.patrol(e)
		case "detect":
			if !inRange {
				e.state = "patrol"
			} else if r.tick >= e.detectEnd {
				e.state = "pursue"
			}
		case "pursue", "attack":
			if !inRange {
				e.state = "patrol"
				continue
			}
			if dist <= attackRange {
				e.state = "attack"
				if r.tick >= e.attackReady {
					e.attackReady = r.tick + attackCooldownTicks
					r.hurtPlayer(target, kind.damage)
				}
				continue
			}
			e.state = "pursue"
			r.walkToward(e, target.x, target.z, kind.pursue)
		}
	}
}

func (r *room) patrol(e *enemy) {
	if math.Abs(e.x-e.spawnX) > patrolReach+wallEpsilon || math.Abs(e.z-e.spawnZ) > wallEpsilon {
		r.walkToward(e, e.spawnX, e.spawnZ, patrolSpeed)
		return
	}
	e.x += e.dir * patrolSpeed * secondsPerTick
	if e.x > e.spawnX+patrolReach {
		e.x, e.dir = e.spawnX+patrolReach, -1
	} else if e.x < e.spawnX-patrolReach {
		e.x, e.dir = e.spawnX-patrolReach, 1
	}
}

// walkToward moves an enemy toward a point, routing around solid blocks over the cell grid.
func (r *room) walkToward(e *enemy, tx, tz, speed float64) {
	wx, wz := tx, tz
	if r.gmap.segmentBlocked(e.x, e.z, tx, tz) {
		wx, wz = r.nextWaypoint(e.x, e.z, tx, tz)
	}
	dx, dz := wx-e.x, wz-e.z
	dist := math.Hypot(dx, dz)
	if dist < 1e-9 {
		return
	}
	step := math.Min(speed*secondsPerTick, dist)
	nx, nz := e.x+dx/dist*step, e.z+dz/dist*step
	if !r.gmap.solidAt(nx, nz) {
		e.x, e.z = nx, nz
	}
}

type cell struct{ x, z int }

// nextWaypoint finds the centre of the next free cell on a shortest path to the target cell.
func (r *room) nextWaypoint(fx, fz, tx, tz float64) (float64, float64) {
	w, d := int(r.gmap.width), int(r.gmap.depth)
	start, goal := cell{int(fx), int(fz)}, cell{min(int(tx), w-1), min(int(tz), d-1)}
	prev := map[cell]cell{start: start}
	queue := []cell{start}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur == goal {
			break
		}
		for _, step := range [4]cell{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			next := cell{cur.x + step.x, cur.z + step.z}
			if next.x < 0 || next.z < 0 || next.x >= w || next.z >= d {
				continue
			}
			if _, seen := prev[next]; seen || r.gmap.solidAt(float64(next.x)+0.5, float64(next.z)+0.5) {
				continue
			}
			prev[next] = cur
			queue = append(queue, next)
		}
	}
	if _, found := prev[goal]; !found || goal == start {
		return tx, tz
	}
	at := goal
	for prev[at] != start {
		at = prev[at]
	}
	return float64(at.x) + 0.5, float64(at.z) + 0.5
}

func (r *room) hurtPlayer(s *seat, damage int) {
	s.hp = max(0, s.hp-damage)
	if s.hp > 0 {
		return
	}
	s.status = statusDowned
	s.reviveEnd = ticksFrom(r.tickTime(), reviveTicks)
	s.reloading = false
	s.moveX, s.moveZ = 0, 0
	r.emit("player_down", map[string]any{"player": s.playerID})
}

// ---- damage, kills and explosions

func (r *room) damageEnemy(e *enemy, damage int, owner *seat) (applied int, killed bool) {
	applied = min(damage, e.hp)
	e.hp -= applied
	owner.score += applied
	if e.hp > 0 {
		return applied, false
	}
	e.state = "dead"
	owner.kills++
	r.pay(owner, enemyKinds[e.kind].reward, "kill_reward", "", 0)
	r.emit("kill", map[string]any{"id": e.id, "kind": e.kind, "by": owner.playerID})
	return applied, true
}

type blast struct {
	source string
	owner  *seat
	x, z   float64
	radius float64
	max    int
}

const (
	grenadeRadius = 5.0
	grenadeMax    = 100
	barrelRadius  = 4.0
	barrelMax     = 80
	fullDamage    = 1.0
)

// blastDamage is the one place that decides explosion falloff by distance; rounding is half up.
func blastDamage(b blast, d float64) int {
	switch {
	case d >= b.radius:
		return 0
	case d <= fullDamage:
		return b.max
	}
	return int(math.Floor(float64(b.max)*(b.radius-d)/(b.radius-fullDamage) + 0.5))
}

// detonate resolves an explosion and every chained barrel explosion in first-in-first-out order.
func (r *room) detonate(first blast) {
	queue := []blast{first}
	for len(queue) > 0 {
		b := queue[0]
		queue = queue[1:]
		hits := []map[string]any{}
		blocked := []string{}
		var downed []*barrel
		for _, e := range r.enemies {
			if e.state == "dead" {
				continue
			}
			d := math.Hypot(e.x-b.x, e.z-b.z)
			if d >= b.radius {
				continue
			}
			if r.gmap.segmentBlocked(b.x, b.z, e.x, e.z) {
				blocked = append(blocked, e.id)
				continue
			}
			damage := blastDamage(b, d)
			if damage == 0 {
				continue
			}
			applied, _ := r.damageEnemy(e, damage, b.owner)
			hits = append(hits, map[string]any{"id": e.id, "damage": applied, "distance": math.Round(d*100) / 100})
		}
		for _, br := range r.barrels {
			if br.destroyed || "barrel:"+br.id == b.source {
				continue
			}
			d := math.Hypot(br.x-b.x, br.z-b.z)
			if d >= b.radius {
				continue
			}
			if r.gmap.segmentBlocked(b.x, b.z, br.x, br.z) {
				blocked = append(blocked, br.id)
				continue
			}
			damage := blastDamage(b, d)
			if damage == 0 {
				continue
			}
			applied := min(damage, br.hp)
			br.hp -= applied
			hits = append(hits, map[string]any{"id": br.id, "damage": applied, "distance": math.Round(d*100) / 100})
			if br.hp == 0 {
				br.destroyed = true
				downed = append(downed, br)
			}
		}
		r.emit("explosion", map[string]any{"source": b.source, "owner": b.owner.playerID, "x": b.x, "z": b.z, "hits": hits, "blocked": blocked})
		sort.SliceStable(downed, func(i, j int) bool {
			di := math.Hypot(downed[i].x-b.x, downed[i].z-b.z)
			dj := math.Hypot(downed[j].x-b.x, downed[j].z-b.z)
			if di != dj {
				return di < dj
			}
			return downed[i].id < downed[j].id
		})
		for _, br := range downed {
			queue = append(queue, blast{source: "barrel:" + br.id, owner: b.owner, x: br.x, z: br.z, radius: barrelRadius, max: barrelMax})
		}
	}
}

func (r *room) stepGrenades() {
	kept := r.grenades[:0]
	var due []*grenade
	for _, g := range r.grenades {
		if r.tickTime() >= g.fuseEnd {
			due = append(due, g)
		} else {
			kept = append(kept, g)
		}
	}
	r.grenades = kept
	for _, g := range due {
		r.detonate(blast{source: "grenade:" + g.id, owner: r.seatOf(g.owner), x: g.x, z: g.z, radius: grenadeRadius, max: grenadeMax})
	}
	if len(due) > 0 {
		r.checkWaveEnd()
	}
}

// ---- ledger

// pay moves credits between a player and the studio as two opposite ledger entries.
func (r *room) pay(s *seat, amount int, kind, item string, unitPrice int) {
	counterparty := "studio:rewards"
	if kind == "purchase" {
		counterparty = "studio:ammo_station"
	}
	ref := kind + ":" + strconv.Itoa(len(r.ledger)/2+1)
	at := r.srv.clock.Now()
	for _, e := range []ledgerEntry{
		{account: s.playerID, amount: amount},
		{account: counterparty, amount: -amount},
	} {
		e.id = "le_" + strconv.Itoa(len(r.ledger)+1)
		e.kind, e.ref, e.item, e.unitPrice, e.at = kind, ref, item, unitPrice, at
		r.ledger = append(r.ledger, e)
		r.srv.persist.add(ledgerJob(r.srv.store, r.matchID, e))
	}
	s.credits += amount
}
