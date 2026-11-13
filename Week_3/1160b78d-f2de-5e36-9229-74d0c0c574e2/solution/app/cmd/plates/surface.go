package main

import "math"

// surf is what a shader reports for one point of a quad.
type surf struct {
	Alb   RGB
	N     V3
	Emit  RGB
	Alpha float64
	Gloss float64
}

// edge is a soft step: 0 below e, 1 above e, blended over one footprint w.
func edge(x, e, w float64) float64 { return sat((x-e)/w + 0.5) }

// span is 1 inside [a,b] and soft at both ends.
func span(x, a, b, w float64) float64 { return edge(x, a, w) * edge(b, x, w) }

var (
	rustCol   = RGB{0.20, 0.075, 0.03}
	steelDark = RGB{0.045, 0.05, 0.056}
	dirtCol   = RGB{0.02, 0.018, 0.016}
)

// surface evaluates the shader of q at (u,v); foot is the metres one pixel covers across the view
// and footU along the quad's U axis.
func (sc *Scene) surface(q *Quad, u, v, foot, footU float64) surf {
	switch q.Kind {
	case kWagon:
		return wagonSide(q, u, v, foot, footU)
	case kContainer:
		return containerSide(q, u, v, foot, footU)
	case kWagonEnd, kContainerEnd:
		return endFace(q, u, v, foot)
	case kWheels:
		return wheels(q, u, v, foot)
	case kPole:
		return pole(q, u, v, foot)
	case kLattice:
		return lattice(q, u, v, foot)
	case kPanel:
		return panel(q, u, v, foot)
	case kSignal:
		return signalHead(q, u, v, foot)
	case kHousing:
		return surf{Alb: RGB{0.07, 0.075, 0.08}, N: q.N, Alpha: 1, Gloss: 0.3}
	case kVoid:
		return surf{Alb: RGB{0.006, 0.006, 0.007}, N: q.N, Alpha: 1}
	default:
		g := 0.8 + 0.2*v
		return surf{Alb: steelDark.Scale(g), N: q.N, Alpha: 1, Gloss: 0.3}
	}
}

// weather darkens and rusts a painted body; x along the body and y up it, both in metres.
func weather(q *Quad, c RGB, x, y, foot float64) RGB {
	streak := fbm(x*1.6, y*0.11, q.Seed+11, 3)
	c = c.Scale(0.62 + float64(0.5*streak))
	fine := vnoise(x*9, y*9, q.Seed+3)
	c = c.Scale(0.93 + float64(0.14*fine)*(1-smooth(0.02, 0.09, foot)))
	rust := smooth(0.52, 0.8, fbm(x*0.8+9, y*1.1, q.Seed+5, 4)) * smooth(1.4, 0.05, y) * q.P[2]
	c = mixRGB(c, rustCol, rust*0.85)
	grime := smooth(0.7, 0.0, y)
	return mixRGB(c, dirtCol.Add(c.Scale(0.25)), float64(grime*0.5))
}

func wagonSide(q *Quad, u, v, foot, footU float64) surf {
	x, y := u*q.Len, v*q.Hgt
	h := q.Hgt
	door0, door1 := q.P[0]-q.P[1]/2, q.P[0]+q.P[1]/2
	inDoor := span(x, door0, door1, footU) * span(y, 0.28, h-0.4, foot)
	period := 0.3
	fade := 1 - smooth(period*0.2, period*0.65, footU)
	ph := 2 * math.Pi * x / period
	ribs := span(y, 0.14, h-0.18, foot) * (1 - inDoor)
	tilt := float64(math.Sin(ph)*fade) * ribs
	n := V3{q.N.X, q.N.Y, q.N.Z}.Add(V3{0, 0, 1}.Scale(float64(tilt * 0.45))).Norm()
	groove := float64(0.5*(1+math.Cos(ph))) * fade * ribs
	col := weather(q, q.Col, x, y, foot)
	col = col.Scale(1 - float64(0.22*groove))

	// colour band along the top
	band := edge(y, h-0.42, foot) * edge(h-0.18, y, foot) * q.P[3]
	col = mixRGB(col, q.Col.Scale(1.8).Add(RGB{0.05, 0.05, 0.045}), band*0.7)

	// door panel: frame, braces, rail and handle
	frame := inDoor * (1 - span(x, door0+0.09, door1-0.09, footU)*span(y, 0.37, h-0.49, foot))
	col = mixRGB(col, col.Scale(0.55), frame)
	col = mixRGB(col, col.Scale(1.18), inDoor*(1-frame)*0.6)
	brace := inDoor * span(y, h*0.5-0.05, h*0.5+0.05, foot)
	col = mixRGB(col, col.Scale(0.6), brace*0.7)
	rail := span(x, door0-0.15, door1+1.6, footU) * span(y, h-0.34, h-0.27, foot)
	col = mixRGB(col, steelDark, rail*q.P[1]/(q.P[1]+1e-9))
	handle := span(x, door0+0.2, door0+0.25, footU) * span(y, 0.95, 1.55, foot)
	col = mixRGB(col, steelDark, handle*inDoor)

	// top rim, bottom sill, rivet line
	rim := edge(y, h-0.1, foot)
	col = mixRGB(col, col.Scale(1.35), rim*0.8)
	sill := 1 - edge(y, 0.12, foot)
	col = mixRGB(col, steelDark, sill*0.85)
	riv := 1 - smooth(0.012, 0.03, float64(math.Abs(fract(x/0.22)-0.5)*0.22))
	col = col.Scale(1 + float64(0.35*riv*span(y, h-0.2, h-0.14, foot)*fade))
	for i, px := range []float64{q.P[0] + q.P[1]/2 + 0.7, q.Len * 0.12, q.Len * 0.88} {
		pl := span(x, px, px+0.5, footU) * span(y, 1.3+0.3*float64(i%2), 1.75+0.3*float64(i%2), foot)
		col = mixRGB(col, mixRGB(RGB{0.12, 0.11, 0.1}, q.Col, 0.4), pl*0.9*q.P[3])
	}
	return surf{Alb: col, N: n, Alpha: 1, Gloss: 0.35}
}

func containerSide(q *Quad, u, v, foot, footU float64) surf {
	x, y := u*q.Len, v*q.Hgt
	h := q.Hgt
	period := 0.24
	fade := 1 - smooth(period*0.2, period*0.65, footU)
	ph := 2 * math.Pi * x / period
	ribs := span(y, 0.16, h-0.16, foot) * span(x, 0.22, q.Len-0.22, footU)
	tilt := float64(math.Sin(ph)*fade) * ribs
	n := q.N.Add(V3{0, 0, 1}.Scale(float64(tilt * 0.25))).Norm()
	groove := float64(0.5*(1+math.Cos(ph))) * fade * ribs
	col := weather(q, q.Col, x, y, foot)
	col = col.Scale(1 - float64(0.24*groove))
	rail := (1 - edge(y, 0.16, foot)) + edge(y, h-0.16, foot)
	col = mixRGB(col, col.Scale(0.55), sat(rail)*0.8)
	post := (1 - edge(x, 0.22, footU)) + edge(x, q.Len-0.22, footU)
	col = mixRGB(col, col.Scale(0.7), sat(post)*0.7)
	cast := span(x, 0, 0.3, footU)*span(y, 0, 0.2, foot) + span(x, q.Len-0.3, q.Len, footU)*span(y, 0, 0.2, foot)
	col = mixRGB(col, steelDark, sat(cast))
	return surf{Alb: col, N: n, Alpha: 1, Gloss: 0.3}
}

func endFace(q *Quad, u, v, foot float64) surf {
	x, y := u*q.Len, v*q.Hgt
	col := weather(q, q.Col.Scale(0.6), x, y+0.8, foot)
	// dirt runs down the end wall, thicker towards the bottom and the corners
	run := fbm(x*3.2, y*0.35, q.Seed+61, 3)
	col = col.Scale(0.55 + float64(0.7*run))
	col = col.Scale(1 - float64(0.35*smooth(0.15, 0.0, math.Min(x, q.Len-x))))
	scratch := 1 - smooth(0.0, 0.012, math.Abs(fbm(x*5, y*0.5, q.Seed+62, 2)-0.5))
	col = col.Scale(1 + float64(0.35*scratch)*(1-smooth(0.02, 0.08, foot)))
	if q.Kind == kContainerEnd {
		rods := 0.5 + 0.5*math.Cos(2*math.Pi*x/0.42)
		col = col.Scale(1 - float64(0.2*rods)*span(y, 0.2, q.Hgt-0.2, foot)*(1-smooth(0.1, 0.3, foot)))
		return surf{Alb: col, N: q.N, Alpha: 1, Gloss: 0.2}
	}
	mid := q.Len / 2
	// stiffening bands up the end wall
	for _, by := range []float64{1.5, 2.3} {
		col = mixRGB(col, col.Scale(0.6), span(y, by, by+0.08, foot)*0.8)
	}
	// headstock beam with the buffers and the coupling
	beam := span(y, 0.0, 0.3, foot)
	col = mixRGB(col, steelDark, beam)
	for _, bx := range []float64{mid - 0.85, mid + 0.85} {
		d := math.Hypot(x-bx, y-0.17)
		col = mixRGB(col, RGB{0.1, 0.1, 0.105}, 1-edge(d, 0.15, foot))
		col = mixRGB(col, RGB{0.04, 0.04, 0.045}, 1-edge(d, 0.08, foot))
	}
	hook := span(x, mid-0.05, mid+0.05, foot) * span(y, -0.12, 0.2, foot)
	col = mixRGB(col, RGB{0.07, 0.07, 0.075}, hook)
	// ladder up the left corner and a handbrake wheel
	rails := span(x, 0.18, 0.23, foot) + span(x, 0.5, 0.55, foot)
	rung := span(fract(y/0.3), 0.42, 0.58, foot/0.3)
	col = mixRGB(col, RGB{0.05, 0.05, 0.055}, sat(sat(rails)*span(y, 0.3, q.Hgt-0.2, foot)+rung*span(x, 0.2, 0.53, foot)*span(y, 0.4, q.Hgt-0.3, foot)))
	wd := math.Hypot(x-q.Len+0.5, y-q.Hgt+0.55)
	col = mixRGB(col, RGB{0.05, 0.05, 0.055}, sat(span(wd, 0.2, 0.25, foot)+span(wd, 0.0, 0.04, foot)))
	return surf{Alb: col, N: q.N, Alpha: 1, Gloss: 0.2}
}

func wheels(q *Quad, u, v, foot float64) surf {
	x, y := u*q.Len, v*q.Hgt
	a := 0.0
	var col RGB
	for _, b := range []float64{2.1, q.Len - 2.1} {
		frame := span(x, b-1.55, b+1.55, foot) * span(y, 0.6, 0.84, foot)
		col = mixRGB(col, RGB{0.05, 0.052, 0.055}, frame)
		a = math.Max(a, frame)
		rig := span(x, b-0.95, b+0.95, foot) * span(y, 0.24, 0.3, foot)
		a = math.Max(a, rig)
		for _, ax := range []float64{-0.95, 0.95} {
			d := math.Hypot(x-b-ax, y-0.46)
			disc := 1 - edge(d, 0.46, foot)
			tread := span(d, 0.38, 0.46, foot)
			hub := 1 - edge(d, 0.13, foot)
			wc := mixRGB(RGB{0.01, 0.01, 0.011}, RGB{0.028, 0.028, 0.03}, tread)
			wc = mixRGB(wc, RGB{0.02, 0.02, 0.022}, hub)
			col = mixRGB(col, wc, disc)
			a = math.Max(a, disc)
			box := span(x, b+ax-0.14, b+ax+0.14, foot) * span(y, 0.38, 0.54, foot)
			col = mixRGB(col, RGB{0.04, 0.04, 0.045}, box)
			a = math.Max(a, box)
		}
	}
	return surf{Alb: col, N: q.N, Alpha: a, Gloss: 0.15}
}

func pole(q *Quad, u, v, foot float64) surf {
	w := mix(1, q.P[0], v)
	cx := (2*u - 1) / w
	dist := (w - math.Abs(2*u-1)) * q.Len * 0.5
	a := sat(dist/foot + 0.5)
	s := math.Sqrt(math.Max(0, 1-float64(cx*cx)))
	n := q.N.Scale(s).Add(V3{q.U.X, q.U.Y, q.U.Z}.Scale(cx / q.Len)).Norm()
	col := RGB{0.07, 0.075, 0.08}
	col = col.Scale(0.8 + float64(0.4*vnoise(v*q.Hgt*0.6, u*3, q.Seed)))
	y := v * q.Hgt
	col = mixRGB(col, RGB{0.05, 0.05, 0.055}, 1-edge(y, 0.7, foot))
	ring := span(y, q.Hgt-1.6, q.Hgt-1.5, foot)
	col = mixRGB(col, RGB{0.04, 0.04, 0.045}, ring)
	return surf{Alb: col, N: n, Alpha: a, Gloss: 0.5}
}

func lattice(q *Quad, u, v, foot float64) surf {
	x, y := u*q.Len, v*q.Hgt
	t, cell := q.P[0], q.P[1]
	chord := (1 - edge(y, t, foot)) + edge(y, q.Hgt-t, foot)
	post := (1 - edge(x, t, foot)) + edge(x, q.Len-t, foot)
	i := math.Floor(x / cell)
	p := fract(x / cell)
	if int(i)%2 != 0 {
		p = 1 - p
	}
	d := math.Abs(y-q.Hgt*p) * cell / math.Hypot(cell, q.Hgt)
	diag := 1 - edge(d, t*0.7, foot)
	a := sat(chord + post + diag)
	return surf{Alb: steelDark.Scale(1.2), N: q.N, Alpha: a, Gloss: 0.2}
}

func panel(q *Quad, u, v, foot float64) surf {
	d := math.Max(math.Abs(2*u-1), math.Abs(2*v-1))
	lens := 0.78 + float64(0.22*(1-d))
	seg := 0.88 + float64(0.12*math.Cos(u*q.Len*math.Pi*2/0.18))
	e := q.Col.Scale(float64(q.P[0]*lens) * seg)
	rim := smooth(0.9, 0.99, d)
	return surf{Alb: RGB{0.05, 0.05, 0.055}, N: q.N, Emit: mixRGB(e, RGB{}, rim), Alpha: 1}
}

func signalHead(q *Quad, u, v, foot float64) surf {
	x, y := u*q.Len, v*q.Hgt
	n := int(q.P[0])
	col := RGB{0.03, 0.03, 0.034}
	var emit RGB
	for i := 0; i < n; i++ {
		cy := q.Hgt * (float64(i) + 0.5) / float64(n)
		d := math.Hypot(x-q.Len/2, y-cy)
		r := q.Len * 0.34
		lens := 1 - edge(d, r, foot)
		on := 0.0
		if i == int(q.P[1]) {
			on = 1
		}
		col = mixRGB(col, q.Col.Scale(0.08), lens)
		emit = emit.Add(q.Col.Scale(float64(on*lens) * q.P[2]))
		hood := span(d, r, r*1.35, foot) * span(y-cy, -r*1.5, r*0.2, foot)
		col = mixRGB(col, RGB{0.015, 0.015, 0.017}, hood)
	}
	return surf{Alb: col, N: q.N, Emit: emit, Alpha: 1, Gloss: 0.2}
}
