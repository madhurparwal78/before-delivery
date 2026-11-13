package main

import "math"

// reflection holds the mirrored yard seen in the wet ground, in two sharpness levels.
type reflection struct {
	sharp, soft *Target
}

// sample reads premultiplied colour and coverage at screen position (x,y) given in
// coordinates of a target of scale `scale`.
func (t *Target) sample(x, y float64, scale int) (RGB, float64) {
	k := float64(t.Scale) / float64(scale)
	fx, fy := x*k-0.5, y*k-0.5
	x0, y0 := math.Floor(fx), math.Floor(fy)
	tx, ty := fx-x0, fy-y0
	ix, iy := int(x0), int(y0)
	var c RGB
	a := 0.0
	for j := 0; j < 2; j++ {
		for i := 0; i < 2; i++ {
			px, py := ix+i, iy+j
			if px < 0 {
				px = 0
			}
			if py < 0 {
				py = 0
			}
			if px >= t.W {
				px = t.W - 1
			}
			if py >= t.H {
				py = t.H - 1
			}
			w := mix(1-tx, tx, float64(i)) * mix(1-ty, ty, float64(j))
			o := py*t.W + px
			c.R += float64(w * float64(t.Pix[o*3]))
			c.G += float64(w * float64(t.Pix[o*3+1]))
			c.B += float64(w * float64(t.Pix[o*3+2]))
			a += float64(w * float64(t.Alpha[o]))
		}
	}
	return c, a
}

// groundAlbedo is the colour of the surface at p and how rough it is (0 smooth, 1 rough).
func (sc *Scene) groundAlbedo(p V3, foot float64) (RGB, float64) {
	asph := fbm(p.X*0.9, p.Z*0.5, sc.Seed+21, 4)
	patch := smooth(0.35, 0.65, fbm(p.X*0.15, p.Z*0.09, sc.Seed+22, 3))
	col := RGB{0.034, 0.036, 0.042}.Scale(0.75 + float64(0.55*asph))
	col = mixRGB(col, RGB{0.03, 0.032, 0.038}, patch*0.7)
	grain := vnoise(p.X*22, p.Z*22, sc.Seed+23)
	col = col.Scale(1 + float64(0.45*(grain-0.5))*(1-smooth(0.02, 0.07, foot)))
	crack := 1 - smooth(0.0, 0.02, math.Abs(fbm(p.X*0.7, p.Z*0.7, sc.Seed+24, 3)-0.5)) // thin dark seams
	col = col.Scale(1 - float64(0.5*crack)*(1-smooth(0.03, 0.12, foot)))
	rough := 0.0
	for _, tx := range sc.Tracks {
		dx := math.Abs(p.X - tx)
		if dx > 2.7 {
			continue
		}
		// painted safety line beside the ballast
		line := span(dx, 2.15, 2.32, foot)
		wear := smooth(0.42, 0.62, fbm(p.X*1.5, p.Z*0.4, sc.Seed+25, 3))
		col = mixRGB(col, RGB{0.2, 0.16, 0.035}, float64(line*wear)*0.8)
		if dx > 1.95 {
			continue
		}
		ball := RGB{0.06, 0.058, 0.056}
		stones := vnoise(p.X*17, p.Z*17, sc.Seed+26)*0.6 + vnoise(p.X*41, p.Z*41, sc.Seed+27)*0.4
		ball = ball.Scale(0.55 + float64(0.9*stones)*(1-smooth(0.03, 0.09, foot)) + float64(0.5*smooth(0.03, 0.09, foot)))
		inBed := 1 - edge(dx, 1.85, math.Max(foot, 0.05))
		col = mixRGB(col, ball, inBed)
		rough = math.Max(rough, inBed)
		// sleepers
		sl := span(fract(p.Z/0.62), 0.12, 0.54, math.Max(foot/0.62, 0.001))
		slAcross := 1 - edge(dx, 1.3, math.Max(foot, 0.02))
		contrast := 1 - smooth(0.12, 0.4, foot)
		sleeper := RGB{0.07, 0.066, 0.062}.Scale(0.8 + float64(0.4*vnoise(p.X*6, p.Z*6, sc.Seed+28)))
		stripe := mixRGB(mixRGB(ball, sleeper, 0.4), mixRGB(ball, sleeper, sl), contrast)
		col = mixRGB(col, stripe, inBed*slAcross)
		// rails
		rail := span(dx, 0.68, 0.755, math.Max(foot, 0.03))
		if rail > 0 {
			col = mixRGB(col, RGB{0.2, 0.2, 0.21}, rail)
		}
	}
	return col, rough
}

// ground shades the wet ground seen along unit direction dir at p.
func (sc *Scene) ground(m *Mood, t *Target, rf *reflection, dir, p V3, dist, sx, sy float64) RGB {
	foot := dist / t.Fpx
	cosT := math.Max(0.02, -dir.Y)
	footG := foot / cosT
	alb, rough := sc.groundAlbedo(p, footG)

	pm := smooth(0.44, 0.58, fbm(p.X*0.33+4, p.Z*0.16, sc.Seed+31, 4))
	wet := mix(sc.Wet, 1, pm)
	alb = alb.Scale(1 - float64(0.35*wet))

	up := V3{0, 1, 0}
	lr := sc.light(m, p, up, dir.Scale(-1), 0)
	uw := sc.underWagon(p)
	lit := alb.Mul(lr.Diff)

	f1 := 1 - cosT
	f2 := float64(f1 * f1)
	fres := 0.04 + float64(0.96*float64(f2*f2)*f1)
	refl := float64(fres*mix(0.5, 1, pm)*sc.Wet) * (1 - float64(0.7*rough))

	// reflection lookup, disturbed a little where the puddles ripple
	rx := vnoise(p.X*5, p.Z*1.3, sc.Seed+41) - 0.5
	ry := vnoise(p.X*3.1+8, p.Z*0.9, sc.Seed+42) - 0.5
	cs, as := rf.sharp.sample(sx+float64(rx*3*pm)*float64(t.Scale), sy+float64(ry*1.5*pm)*float64(t.Scale), t.Scale)
	cb, ab := rf.soft.sample(sx, sy, t.Scale)
	cr := mixRGB(cb, cs, pm)
	ar := mix(ab, as, pm)
	skyRef := m.sky(V3{dir.X, -dir.Y, dir.Z})
	reflected := cr.Add(skyRef.Scale(1 - ar))

	fogF := 1 - expNeg(float64(m.Kappa*dist))
	fogC := m.fog(dir)
	body := mixRGB(lit, fogC, fogF)
	col := mixRGB(body, reflected, sat(refl))
	return col.Scale(uw)
}

// skyline is the colour behind the horizon: sky, far buildings and the lights on them.
func (sc *Scene) horizon(m *Mood, t *Target, dir V3) RGB {
	c := m.sky(dir)
	if dir.Y > 0.1 {
		return c
	}
	az := math.Atan2(dir.X, dir.Z)
	w := 1 / t.Fpx
	cov := 0.0
	for i := range sc.Sil {
		s := &sc.Sil[i]
		a := span(az, s.Az0, s.Az1, w) * edge(s.Top, dir.Y, w)
		if a > cov {
			cov = a
		}
	}
	if cov > 0 {
		c = mixRGB(c, mixRGB(m.fog(dir), m.Skyline, 0.82), cov)
	}
	return c
}
