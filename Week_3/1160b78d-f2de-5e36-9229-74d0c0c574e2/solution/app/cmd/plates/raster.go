package main

import (
	"math"
)

func mirrorY(v V3) V3 { return V3{v.X, -v.Y, v.Z} }

// drawQuad paints q into rows [y0,y1) of t. With mir set the quad is drawn as its
// mirror image below the ground, lit as the real quad is.
func (sc *Scene) drawQuad(m *Mood, t *Target, q *Quad, mir bool, y0, y1 int) {
	o, u, v, n := q.O, q.U, q.V, q.N
	cam, litCam := sc.Pos, sc.Pos
	if mir {
		o, u, v, n = mirrorY(o), mirrorY(u), mirrorY(v), mirrorY(n)
		litCam = mirrorY(sc.Pos)
	}
	if n.Dot(cam.Sub(o)) <= 0 {
		return
	}
	var cx, cy [4]float64
	corners := [4]V3{o, o.Add(u), o.Add(u).Add(v), o.Add(v)}
	minY, maxY := math.Inf(1), math.Inf(-1)
	for i, c := range corners {
		x, y, zc := t.project(c)
		if zc < 0.5 {
			return
		}
		cx[i], cy[i] = x, y
		minY, maxY = math.Min(minY, y), math.Max(maxY, y)
	}
	ys, ye := int(math.Floor(minY-1)), int(math.Ceil(maxY+1))
	if ys < y0 {
		ys = y0
	}
	if ye > y1 {
		ye = y1
	}
	if ys >= ye {
		return
	}
	area := 0.0
	for i := 0; i < 4; i++ {
		j := (i + 1) % 4
		area += float64(cx[i]*cy[j]) - float64(cx[j]*cy[i])
	}
	if math.Abs(area) < 0.02 {
		return
	}
	sgn := 1.0
	if area < 0 {
		sgn = -1
	}
	var ea, eb, ec [4]float64 // edge distance = ea*x + eb*y + ec, positive inside
	for i := 0; i < 4; i++ {
		j := (i + 1) % 4
		ex, ey := cx[j]-cx[i], cy[j]-cy[i]
		l := math.Hypot(ex, ey)
		if l < 1e-9 {
			return
		}
		ea[i] = -sgn * ey / l
		eb[i] = sgn * ex / l
		ec[i] = sgn * (float64(ey*cx[i]) - float64(ex*cy[i])) / l
	}
	snum := n.Dot(o.Sub(cam))
	orig := q
	for y := ys; y < ye; y++ {
		yc := float64(y) + 0.5
		lo, hi := 0.0, float64(t.W)
		for i := 0; i < 4; i++ {
			rhs := -0.5 - float64(eb[i]*yc) - ec[i]
			switch {
			case ea[i] > 1e-12:
				lo = math.Max(lo, rhs/ea[i])
			case ea[i] < -1e-12:
				hi = math.Min(hi, rhs/ea[i])
			case rhs > 0:
				hi = -1
			}
		}
		xs, xe := int(math.Floor(lo-0.5)), int(math.Ceil(hi+0.5))
		if xs < 0 {
			xs = 0
		}
		if xe > t.W {
			xe = t.W
		}
		if xs >= xe {
			continue
		}
		base, step := t.rayRow(yc)
		dyp := yc - t.CY
		for x := xs; x < xe; x++ {
			xc := float64(x) + 0.5
			cov := 1.0
			for i := 0; i < 4; i++ {
				if d := float64(ea[i]*xc) + float64(eb[i]*yc) + ec[i]; d < 0.5 {
					cov = math.Min(cov, d+0.5)
				}
			}
			if cov <= 0 {
				continue
			}
			dr := base.madd(step, float64(x))
			nd := n.Dot(dr)
			s := snum / nd
			if s <= 0 {
				continue
			}
			idx := y*t.W + x
			if float32(s) >= t.Depth[idx] {
				continue
			}
			w := dr.Scale(s).Add(cam).Sub(o)
			qu, qv := sat(w.Dot(u)*orig.uu), sat(w.Dot(v)*orig.vv)
			dxp := xc - t.CX
			lenD := math.Sqrt(float64(dxp*dxp) + float64(dyp*dyp) + float64(t.Fpx*t.Fpx))
			dist := float64(s * lenD)
			foot := dist / t.Fpx
			ndir := math.Abs(n.Dot(dr)) / lenD
			footU := foot / math.Max(0.1, ndir)
			sf := sc.surface(orig, qu, qv, foot, footU)
			a := cov * sf.Alpha
			if a <= 0.004 {
				continue
			}
			pw := orig.O.madd(orig.U, qu).madd(orig.V, qv)
			toCam := litCam.Sub(pw).Norm()
			lr := sc.light(m, pw, sf.N, toCam, sf.Gloss)
			col := sf.Alb.Mul(lr.Diff).Add(lr.Spec)
			fogF := 1 - expNeg(float64(m.Kappa*dist))
			col = mixRGB(col, m.fog(dr.Scale(1/lenD)), fogF).Add(sf.Emit.Scale(1 - float64(0.5*fogF)))
			o3 := idx * 3
			t.Pix[o3] = float32(mix(float64(t.Pix[o3]), col.R, a))
			t.Pix[o3+1] = float32(mix(float64(t.Pix[o3+1]), col.G, a))
			t.Pix[o3+2] = float32(mix(float64(t.Pix[o3+2]), col.B, a))
			if t.Alpha != nil {
				t.Alpha[idx] = float32(a + float64(t.Alpha[idx])*(1-a))
			}
			if a > 0.5 {
				t.Depth[idx] = float32(s)
			}
		}
	}
}

// paintBackground fills rows [y0,y1) with the ground, the horizon and the sky.
func (sc *Scene) paintBackground(m *Mood, t *Target, rf *reflection, y0, y1 int) {
	for y := y0; y < y1; y++ {
		yc := float64(y) + 0.5
		base, step := t.rayRow(yc)
		for x := 0; x < t.W; x++ {
			d := base.madd(step, float64(x))
			l := d.Len()
			dir := d.Scale(1 / l)
			var c RGB
			idx := y*t.W + x
			if dir.Y < -1e-5 {
				s := -sc.Pos.Y / d.Y
				p := sc.Pos.madd(d, s)
				c = sc.ground(m, t, rf, dir, p, float64(s*l), float64(x)+0.5, yc)
				t.Depth[idx] = float32(s)
			} else {
				c = sc.horizon(m, t, dir)
			}
			t.Pix[idx*3], t.Pix[idx*3+1], t.Pix[idx*3+2] = float32(c.R), float32(c.G), float32(c.B)
		}
	}
}

// paintGlow adds the haze halos and light cones of every lamp to rows [y0,y1).
func (sc *Scene) paintGlow(m *Mood, t *Target, mir bool, y0, y1 int) {
	for i := range sc.Lamps {
		l := &sc.Lamps[i]
		pos := l.Pos
		if mir {
			pos = mirrorY(pos)
		}
		hx, hy, zc := t.project(pos)
		if zc < 1 {
			continue
		}
		sL := zc / t.Fpx
		trans := 0.3 + 0.7*expNeg(float64(m.Kappa*zc))
		r0 := math.Max(1.2*float64(t.Scale), t.Fpx*l.Size/zc)
		inten := float64(l.Glow * trans)
		reach := r0 * 16
		ya, yb := int(hy-reach), int(hy+reach)+1
		if ya < y0 {
			ya = y0
		}
		if yb > y1 {
			yb = y1
		}
		xa, xb := int(hx-reach), int(hx+reach)+1
		if xa < 0 {
			xa = 0
		}
		if xb > t.W {
			xb = t.W
		}
		for y := ya; y < yb; y++ {
			dy := float64(y) + 0.5 - hy
			for x := xa; x < xb; x++ {
				idx := y*t.W + x
				dx := float64(x) + 0.5 - hx
				q := (float64(dx*dx) + float64(dy*dy)) / float64(r0*r0)
				k := 1 / (float64(1+q) * math.Sqrt(1+q))
				k *= occluded(t.Depth[idx], sL)
				addGlow(t, idx, l.Col, float64(inten*k))
			}
		}
		if l.Cone && !mir {
			sc.paintCone(m, t, l, hx, hy, zc, sL, y0, y1)
		}
	}
}

// occluded is 1 where the surface behind a pixel lies beyond the lamp and 0 where it lies in front.
func occluded(depth float32, sL float64) float64 {
	return smooth(sL*0.985, sL*1.015, float64(depth))
}

func addGlow(t *Target, idx int, c RGB, k float64) {
	o := idx * 3
	t.Pix[o] += float32(c.R * k)
	t.Pix[o+1] += float32(c.G * k)
	t.Pix[o+2] += float32(c.B * k)
}

// paintCone adds the faint light cone that stands in the haze under a lamp.
func (sc *Scene) paintCone(m *Mood, t *Target, l *Lamp, hx, hy, zc, sL float64, y0, y1 int) {
	gx, gy, _ := t.project(V3{l.Pos.X, 0, l.Pos.Z})
	ax, ay := gx-hx, gy-hy
	al := math.Hypot(ax, ay)
	if al < 4 {
		return
	}
	ux, uy := ax/al, ay/al
	wg := t.Fpx * l.Pos.Y * 0.62 / zc
	wtop := wg * 0.04
	pad := wg + 4
	ya, yb := int(math.Min(hy, gy)-pad), int(math.Max(hy, gy)+pad)+1
	xa, xb := int(math.Min(hx, gx)-pad), int(math.Max(hx, gx)+pad)+1
	if ya < y0 {
		ya = y0
	}
	if yb > y1 {
		yb = y1
	}
	if xa < 0 {
		xa = 0
	}
	if xb > t.W {
		xb = t.W
	}
	strength := l.Glow * m.Beam * (0.4 + 0.6*expNeg(float64(m.Kappa*zc)))
	for y := ya; y < yb; y++ {
		py := float64(y) + 0.5 - hy
		for x := xa; x < xb; x++ {
			px := float64(x) + 0.5 - hx
			ta := (float64(px*ux) + float64(py*uy)) / al
			if ta < -0.02 || ta > 1.05 {
				continue
			}
			lat := math.Abs(float64(px*uy)-float64(py*ux)) / (wtop + float64(wg*sat(ta)))
			if lat >= 1 {
				continue
			}
			e := 1 - float64(lat*lat)
			prof := float64(e*e) * math.Pow(1-float64(sat(ta)*0.92), 1.4)
			idx := y*t.W + x
			addGlow(t, idx, l.Col, float64(strength*prof)*occluded(t.Depth[idx], sL))
		}
	}
}
