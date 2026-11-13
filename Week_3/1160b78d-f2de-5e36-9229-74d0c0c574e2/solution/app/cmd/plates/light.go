package main

import "math"

// lightResult is the light arriving at a surface point.
type lightResult struct {
	Diff RGB // diffuse irradiance, to be multiplied by the albedo
	Spec RGB // glossy reflection of the lamps, added as is
}

// occlusion is how much of a lamp the wagon rows hide from point p (0 = visible).
func (sc *Scene) occlusion(lamp, p V3, dist float64) float64 {
	dx := lamp.X - p.X
	if dx > -1e-9 && dx < 1e-9 {
		return 0
	}
	occ := 0.0
	for i := range sc.Rows {
		r := &sc.Rows[i]
		ta, tb := (r.X0-p.X)/dx, (r.X1-p.X)/dx
		if ta > tb {
			ta, tb = tb, ta
		}
		if ta < 0 {
			ta = 0
		}
		if tb > 1 {
			tb = 1
		}
		if float64((tb-ta)*dist) < 0.06 {
			continue
		}
		yIn := p.Y + float64(ta*(lamp.Y-p.Y))
		zMid := p.Z + float64(0.5*(ta+tb)*(lamp.Z-p.Z))
		if zMid < r.Z0 || zMid > r.Z1 {
			continue
		}
		b := smooth(-0.4, 1.4, r.H-yIn)
		if b > occ {
			occ = b
		}
	}
	return occ
}

// lampReach is the distance beyond which a lamp no longer lights a surface.
const lampReach = 110.0

// light gathers lamp light at p with unit normal n, seen along unit v (towards the camera).
func (sc *Scene) light(m *Mood, p, n, v V3, gloss float64) lightResult {
	amb := m.Ambient.Scale(m.Side + float64((1-m.Side)*sat(0.5+0.5*n.Y)))
	res := lightResult{Diff: amb}
	// the lamps are ordered by depth, so only those within reach of p are visited
	lo, hi := 0, len(sc.Lamps)
	for lo < hi {
		mid := (lo + hi) / 2
		if sc.Lamps[mid].Pos.Z < p.Z-lampReach {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	for i := lo; i < len(sc.Lamps) && sc.Lamps[i].Pos.Z <= p.Z+lampReach; i++ {
		l := &sc.Lamps[i]
		d := l.Pos.Sub(p)
		d2 := d.Dot(d)
		if d2 > lampReach*lampReach || d2 < 0.04 {
			continue
		}
		dist := math.Sqrt(d2)
		ld := d.Scale(1 / dist)
		ndl := n.Dot(ld)
		if ndl <= 0 {
			continue
		}
		spot := smooth(l.Cos0, l.Cos1, ld.Y)
		if spot <= 0 {
			continue
		}
		k := float64(l.Power*spot) / (d2 + 4)
		if k < 1e-4 {
			continue
		}
		k *= 1 - sc.occlusion(l.Pos, p, dist)
		res.Diff = res.Diff.Add(l.Col.Scale(float64(k * ndl)))
		if gloss > 0 {
			h := ld.Add(v).Norm()
			nh := sat(n.Dot(h))
			s2 := float64(nh * nh)
			s4 := float64(s2 * s2)
			s8 := float64(s4 * s4)
			s16 := float64(s8 * s8)
			s32 := float64(s16 * s16)
			res.Spec = res.Spec.Add(l.Col.Scale(float64(gloss*k) * s32 * 0.6))
		}
	}
	return res
}

// underWagon is the share of sky light that still reaches ground below a wagon row.
func (sc *Scene) underWagon(p V3) float64 {
	for i := range sc.Rows {
		r := &sc.Rows[i]
		if p.Z >= r.Z0 && p.Z <= r.Z1 {
			w := float64(smooth(r.X0, r.X0+0.5, p.X) * (1 - smooth(r.X1-0.5, r.X1, p.X)))
			if w > 0 {
				return 1 - float64(0.9*w)
			}
		}
	}
	return 1
}
