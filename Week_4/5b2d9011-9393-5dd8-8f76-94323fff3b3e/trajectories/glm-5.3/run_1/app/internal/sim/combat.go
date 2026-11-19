package sim

import (
	"math"
	"sort"
	"strconv"

)

// ShotOutcome is the outcome of an accepted shot.
type ShotOutcome struct {
	Hit     *ShotHit `json:"hit"`
	Mag     int      `json:"mag"`
}

// ShotHit describes what a shot hit.
type ShotHit struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Damage   int    `json:"damage"`
	HPAfter  int    `json:"hp_after"`
	Killed   bool   `json:"killed"`
}

// Shot fires one shot along the aim angle, resolving it against enemies and
// barrels. A rejected shot returns its reason and changes nothing.
func (r *Room) Shot(playerID, reportID string, aim float64, nowMono int64) ReportResult {
	p := r.Players[playerID]
	reject := func(reason string) ReportResult {
		return ReportResult{ReportID: reportID, Type: "shot", Accepted: false, Reason: reason, Tick: r.Tick, Outcome: nil, Body: "shot:" + canonicalAim(aim)}
	}
	if r.Phase != PhaseWave && r.Phase != PhaseBossWave {
		return reject("not_in_wave")
	}
	if p == nil || p.Status != Up {
		return reject("not_up")
	}
	if p.ReloadUntil != nil {
		return reject("reloading")
	}
	if p.Mag <= 0 {
		return reject("empty")
	}
	if p.LastShotAt != nil && nowMono-*p.LastShotAt < FireIntervalMs {
		return reject("fire_interval")
	}

	p.Mag--
	shotAt := nowMono
	p.LastShotAt = &shotAt
	p.Aim = normalizeAngle(aim)

	outcome := ShotOutcome{Mag: p.Mag}
	kind, id := r.resolveRay(p, p.Aim)
	if id != "" {
		applied := r.applyDamage(kind, id, ShotDamage, playerID, nowMono)
		outcome.Hit = &ShotHit{ID: id, Kind: kind, Damage: applied.damage, HPAfter: applied.hpAfter, Killed: applied.killed}
	}
	return ReportResult{
		ReportID: reportID,
		Type:     "shot",
		Accepted: true,
		Reason:   nil,
		Tick:     r.Tick,
		Outcome:  outcome,
		Body:     "shot:" + canonicalAim(aim),
	}
}

func canonicalAim(aim float64) string {
return strconv.FormatFloat(aim, 'g', -1, 64)
}

// resolveRay casts a ray from the shooter along the aim, up to 40 m. It hits
// the first enemy or intact barrel whose circle the ray crosses before it
// enters a solid block cell.
func (r *Room) resolveRay(p *Player, aim float64) (kind, id string) {
	rad := aim * math.Pi / 180
	dx := math.Cos(rad)
	dz := math.Sin(rad)
	px, pz := p.X, p.Z

	type candidate struct {
		id     string
		kind   string
		t      float64
	}
	var cands []candidate
	for _, e := range r.Enemies {
		if e.State == "dead" {
			continue
		}
		t, ok := rayCircle(px, pz, dx, dz, e.X, e.Z, enemyRadius(e.Kind))
		if ok && t <= ShotRange {
			cands = append(cands, candidate{id: e.ID, kind: e.Kind, t: t})
		}
	}
	for _, b := range r.Barrels {
		if b.Destroyed {
			continue
		}
		t, ok := rayCircle(px, pz, dx, dz, b.X, b.Z, BarrelRadius)
		if ok && t <= ShotRange {
			cands = append(cands, candidate{id: b.ID, kind: "barrel", t: t})
		}
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].t < cands[j].t })
	for _, c := range cands {
		// Check for a solid block between the shooter and the hit point.
		hx := px + dx*c.t
		hz := pz + dz*c.t
		if r.Map.SegmentBlocked(px, pz, hx, hz) {
			continue
		}
		return c.kind, c.id
	}
	return "", ""
}

// rayCircle computes the entry distance of a ray into a circle centred at
// (cx, cz), if it crosses.
func rayCircle(px, pz, dx, dz, cx, cz, radius float64) (float64, bool) {
	ox := cx - px
	oz := cz - pz
	proj := ox*dx + oz*dz
	if proj < 0 {
		return 0, false
	}
	perp := math.Abs(ox*dz - oz*dx)
	if perp > radius {
		return 0, false
	}
	t := proj - math.Sqrt(radius*radius-perp*perp)
	if t < 0 {
		t = 0
	}
	return t, true
}

// appliedDamage carries the applied amount and the result.
type appliedDamage struct {
	damage int
	hpAfter int
	killed  bool
}

// applyDamage applies damage to an enemy or barrel, capping at remaining
// health, and resolves kills.
func (r *Room) applyDamage(kind, id string, dmg int, ownerID string, nowMono int64) appliedDamage {
	switch kind {
	case "barrel":
		b := r.Barrels[id]
		if b == nil || b.Destroyed {
			return appliedDamage{}
		}
		applied := dmg
		if applied > b.HP {
			applied = b.HP
		}
		b.HP -= applied
		hpAfter := b.HP
		if b.HP <= 0 {
			b.Destroyed = true
			r.queueBarrelExplosion(b, ownerID, nowMono)
		}
		return appliedDamage{damage: applied, hpAfter: hpAfter, killed: b.Destroyed}
	default:
		e := r.Enemies[id]
		if e == nil || e.State == "dead" {
			return appliedDamage{}
		}
		applied := dmg
		if applied > e.HP {
			applied = e.HP
		}
		e.HP -= applied
		hpAfter := e.HP
		p := r.Players[ownerID]
		if p != nil {
			p.Score += int64(applied)
		}
		if e.HP <= 0 {
			e.State = "dead"
			if p != nil {
				p.Kills++
				p.Credits += int64(enemyKillCredits(e.Kind))
				r.recordCredit(p.ID, int64(enemyKillCredits(e.Kind)), "kill_reward", "kill:"+e.ID)
			}
			r.Log(r.Tick, "kill", map[string]any{"enemy": e.ID, "kind": e.Kind, "owner": ownerID})
		}
		return appliedDamage{damage: applied, hpAfter: hpAfter, killed: e.State == "dead"}
	}
}

func enemyKillCredits(kind string) int {
	switch kind {
	case "grunt":
		return GruntKillCredits
	case "brute":
		return BruteKillCredits
	default:
		return BossKillCredits
	}
}
