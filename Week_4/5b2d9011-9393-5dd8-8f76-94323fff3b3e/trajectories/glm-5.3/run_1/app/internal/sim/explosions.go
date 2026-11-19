package sim

import (
	"strconv"
	"math"
	"sort"
)

// explosion is one pending explosion in the current tick's queue.
type explosion struct {
	source  string // "grenade:<id>" or "barrel:<id>"
	owner   string
	x, z    float64
	isBarrel bool
}

// explosionQueue holds the explosions yet to resolve in this tick. Explosions
// resolve first in, first out within the tick that caused them.
var explosionQueue []explosion

// ThrowGrenade accepts a grenade report.
func (r *Room) ThrowGrenade(playerID, reportID string, targetX, targetZ float64, nowMono int64) ReportResult {
	p := r.Players[playerID]
	reject := func(reason string) ReportResult {
		return ReportResult{ReportID: reportID, Type: "grenade", Accepted: false, Reason: reason, Tick: r.Tick, Outcome: nil,
			Body: "grenade:" + strconvFormatFloat(targetX) + "," + strconvFormatFloat(targetZ)}
	}
	if r.Phase != PhaseWave && r.Phase != PhaseBossWave {
		return reject("not_in_wave")
	}
	if p == nil || p.Status != Up {
		return reject("not_up")
	}
	if p.Grenades <= 0 {
		return reject("no_grenades")
	}
	d := math.Hypot(targetX-p.X, targetZ-p.Z)
	if d > GrenadeRange {
		return reject("out_of_range")
	}
	p.Grenades--
	id := "g" + r.Code + "-" + strconvFormatInt(r.Tick) + "-" + strconvFormatInt(int64(len(r.Grenades))+int64(p.Grenades))
	detonateAt := nowMono + GrenadeFuseMs
	r.Grenades[id] = &Grenade{ID: id, Owner: playerID, X: targetX, Z: targetZ, DetonateAt: detonateAt}
	return ReportResult{
		ReportID: reportID,
		Type:     "grenade",
		Accepted: true,
		Reason:   nil,
		Tick:     r.Tick,
		Outcome: map[string]any{"grenade_id": id, "detonates_in_ms": GrenadeFuseMs},
		Body:     "grenade:" + strconvFormatFloat(targetX) + "," + strconvFormatFloat(targetZ),
	}
}

// Reload starts a reload.
func (r *Room) Reload(playerID, reportID string, nowMono int64) ReportResult {
	p := r.Players[playerID]
	reject := func(reason string) ReportResult {
		return ReportResult{ReportID: reportID, Type: "reload", Accepted: false, Reason: reason, Tick: r.Tick, Outcome: nil, Body: "reload"}
	}
	if p == nil || p.Status != Up {
		return reject("not_up")
	}
	if p.ReloadUntil != nil {
		return reject("reloading")
	}
	if p.Mag >= MagSize || p.Reserve <= 0 {
		return reject("nothing_to_reload")
	}
	until := nowMono + ReloadMs
	p.ReloadUntil = &until
	return ReportResult{
		ReportID: reportID,
		Type:     "reload",
		Accepted: true,
		Reason:   nil,
		Tick:     r.Tick,
		Outcome: map[string]any{"reload_ms": ReloadMs},
		Body:     "reload",
	}
}

// completeReloads finishes reloads whose duration has passed.
func (r *Room) completeReloads(nowMono int64) {
	for _, p := range r.Players {
		if p.ReloadUntil != nil && nowMono >= *p.ReloadUntil {
			p.ReloadUntil = nil
			missing := MagSize - p.Mag
			move := missing
			if move > p.Reserve {
				move = p.Reserve
			}
			p.Mag += move
			p.Reserve -= move
			r.Log(r.Tick, "reload", map[string]any{"player": p.ID, "callsign": p.Callsign})
		}
	}
}

// detonateGrenades resolves grenades whose server fuse has ended.
func (r *Room) detonateGrenades(nowMono int64) {
	var toDetonate []*Grenade
	for _, g := range r.Grenades {
		if nowMono >= g.DetonateAt {
			toDetonate = append(toDetonate, g)
		}
	}
	sort.Slice(toDetonate, func(i, j int) bool { return toDetonate[i].DetonateAt < toDetonate[j].DetonateAt })
	for _, g := range toDetonate {
		delete(r.Grenades, g.ID)
		explosionQueue = append(explosionQueue, explosion{
			source: "grenade:" + g.ID, owner: g.Owner, x: g.X, z: g.Z, isBarrel: false,
		})
	}
}

// queueBarrelExplosion queues a barrel that has just been brought to zero.
func (r *Room) queueBarrelExplosion(b *Barrel, ownerID string, nowMono int64) {
	explosionQueue = append(explosionQueue, explosion{
		source: "barrel:" + b.ID, owner: ownerID, x: b.X, z: b.Z, isBarrel: true,
	})
}

// resolveExplosions drains the explosion queue in published order: first in,
// first out, with chained barrels joining in order of increasing distance from
// the explosion that destroyed them, ties by barrel id ascending.
func (r *Room) resolveExplosions(nowMono int64) {
	defer func() {
		explosionQueue = nil
	}()
	for len(explosionQueue) > 0 {
		ex := explosionQueue[0]
		explosionQueue = explosionQueue[1:]

		radius := GrenadeBlastRadius
		maxDmg := GrenadeMaxDamage
		if ex.isBarrel {
			radius = BarrelBlastRadius
			maxDmg = BarrelMaxDamage
		}
		hits := []map[string]any{}
		blocked := []string{}
		var chained []*Barrel

		// Collect candidates.
		type cand struct {
			kind string
			id   string
			x, z float64
			dist float64
		}
		var cands []cand
		for _, e := range r.Enemies {
			if e.State == "dead" {
				continue
			}
			d := math.Hypot(e.X-ex.x, e.Z-ex.z)
			if d < radius {
				cands = append(cands, cand{kind: e.Kind, id: e.ID, x: e.X, z: e.Z, dist: d})
			}
		}
		for _, b := range r.Barrels {
			if b.Destroyed {
				continue
			}
			d := math.Hypot(b.X-ex.x, b.Z-ex.z)
			if d < radius {
				cands = append(cands, cand{kind: "barrel", id: b.ID, x: b.X, z: b.Z, dist: d})
			}
		}

		// Damage within one explosion applies to every entity at once.
		for _, c := range cands {
			if r.Map.SegmentBlocked(ex.x, ex.z, c.x, c.z) {
				blocked = append(blocked, c.id)
				continue
			}
			dmg := falloff(c.dist, radius, maxDmg)
			if dmg <= 0 {
				continue
			}
			applied := r.applyDamage(c.kind, c.id, dmg, ex.owner, nowMono)
			hits = append(hits, map[string]any{
				"id": c.id, "damage": applied.damage, "distance": round2(c.dist),
			})
			if c.kind == "barrel" && applied.killed {
				if b := r.Barrels[c.id]; b != nil {
					chained = append(chained, b)
				}
			}
		}

		// Chained barrels join the queue in order of increasing distance from
		// this explosion, ties by id ascending.
		sort.Slice(chained, func(i, j int) bool {
			if chained[i].X != chained[j].X || chained[i].Z != chained[j].Z {
				di := math.Hypot(chained[i].X-ex.x, chained[i].Z-ex.z)
				dj := math.Hypot(chained[j].X-ex.x, chained[j].Z-ex.z)
				if di != dj {
					return di < dj
				}
			}
			return chained[i].ID < chained[j].ID
		})
		for _, b := range chained {
			explosionQueue = append(explosionQueue, explosion{
				source: "barrel:" + b.ID, owner: ex.owner, x: b.X, z: b.Z, isBarrel: true,
			})
		}

		r.Log(r.Tick, "explosion", map[string]any{
			"source": ex.source, "owner": ex.owner, "x": round2(ex.x), "z": round2(ex.z),
			"hits": hits, "blocked": blocked,
		})
	}
}

// falloff computes the published explosion damage at distance d.
func falloff(d, radius float64, maxDmg int) int {
	if d >= radius {
		return 0
	}
	if d <= 1.0 {
		return maxDmg
	}
	spread := radius - 1.0
	v := float64(maxDmg) * (radius - d) / spread
	return roundHalfUp(v)
}

// roundHalfUp rounds half up.
func roundHalfUp(v float64) int {
	if v < 0 {
		return -int(math.Floor(-v + 0.5))
	}
	return int(math.Floor(v + 0.5))
}

// round2 rounds to two decimals.
func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func strconvFormatInt(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [24]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

func strconvFormatFloat(f float64) string {
	return strconvFmtFloat(f)
}

func strconvFmtFloat(f float64) string {
return strconv.FormatFloat(f, 'g', -1, 64)
}
