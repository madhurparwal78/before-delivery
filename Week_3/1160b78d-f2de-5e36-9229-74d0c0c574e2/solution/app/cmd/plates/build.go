package main

import (
	"math"
	"math/rand/v2"
	"sort"
)

// builder places the parts of a yard. All choices come from one seeded generator,
// so a layout is the same every time it is built.
type builder struct {
	sc            *Scene
	rng           *rand.Rand
	nx            V3 // horizontal unit vector facing the camera
	hx            V3 // horizontal unit vector across the view
	last          int
	wagons, boxes []uint32
}

var (
	wagonColours = []uint32{0x6e2f25, 0x5a2a22, 0x7a3b2a, 0x3c4a43, 0x44525a, 0x7d7357, 0x8a8478, 0x2c3446, 0xa24a22, 0x57493b, 0x3f5148}
	boxColours   = []uint32{0x1f4d7a, 0x9a2a22, 0xc58b2b, 0x2f6a4f, 0xd8d6cf, 0x6d7378, 0x2d3a63, 0xb35a2a, 0x4f6b5a, 0xcfae3a}
	lampWarm     = hex(0xffc27a)
)

const lampPower = 1100.0

func newBuilder(v View, seed uint64) *builder {
	sy, cy := math.Sin(math.Atan2(v.F.X, v.F.Z)), math.Cos(math.Atan2(v.F.X, v.F.Z))
	return &builder{
		sc:     &Scene{View: v, Seed: uint32(seed), Wet: 0.95},
		rng:    rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)),
		nx:     V3{-sy, 0, -cy},
		hx:     V3{cy, 0, -sy},
		wagons: wagonColours,
		boxes:  boxColours,
	}
}

// stack builds a block of containers three high; n is how many stand side by side in the depth.
func (b *builder) stack(cx, z0, face float64, n int) {
	z := z0
	for i := 0; i < n; i++ {
		length := 6.06
		if b.rng.IntN(2) == 0 {
			length = 12.19
		}
		levels := 1 + b.rng.IntN(3)
		for y := 0; y < levels; y++ {
			b.container(cx, z, length, 0.05+2.64*float64(y), face, b.pick(b.boxes))
		}
		b.sc.Rows = append(b.sc.Rows, Row{cx - 1.5, cx + 1.5, z, z + length, 0.05 + 2.64*float64(levels)})
		z += length + 0.4
	}
}

// pick chooses a colour from list, never the one chosen just before it.
func (b *builder) pick(list []uint32) RGB {
	b.last = (b.last + 1 + b.rng.IntN(len(list)-1)) % len(list)
	return hex(list[b.last])
}

func (b *builder) between(lo, hi float64) float64 { return lo + (hi-lo)*b.rng.Float64() }

func (b *builder) add(q *Quad) *Quad {
	b.sc.Quads = append(b.sc.Quads, q)
	return q
}

func (b *builder) lamp(l Lamp) {
	if l.Cos0 == 0 {
		l.Cos0, l.Cos1 = 0.55, 0.86
	}
	b.sc.Lamps = append(b.sc.Lamps, l)
}

// wagonRow lines wagons up on the track at x = cx from z0 to z1. face is -1 when the
// visible side looks towards -x and +1 when it looks towards +x.
func (b *builder) wagonRow(cx, z0, z1 float64, face float64, gapChance float64, stack bool) {
	z := z0
	runStart := z0
	flush := func(end float64) {
		if end-runStart > 4 {
			b.sc.Rows = append(b.sc.Rows, Row{cx - 1.5, cx + 1.5, runStart, end, 3.9})
		}
	}
	for z < z1 {
		if b.rng.Float64() < gapChance {
			flush(z - 0.9)
			z += b.between(9, 30)
			runStart = z
			continue
		}
		length := []float64{12.4, 13.6, 14.5}[b.rng.IntN(3)]
		switch r := b.rng.Float64(); {
		case r < 0.5:
			b.boxcar(cx, z, length, face)
		case r < 0.62:
			b.gondola(cx, z, length, face)
		default:
			b.flatWagon(cx, z, length, face, stack && b.rng.Float64() < 0.25)
		}
		z += length + 0.9
	}
	flush(z - 0.9)
}

// underframe adds the running gear shared by every wagon: a dark void under the body
// and bogies with wheels. The near end gets a headstock with buffers; a box wagon's end
// is also the end of its body.
func (b *builder) underframe(cx, z0, length, face float64, col RGB, bodyHeight float64) {
	n := V3{face, 0, 0}
	b.add(newQuad(kVoid, V3{cx, 0.1, z0}, V3{0, 0, length}, V3{0, 0.95, 0}, n, RGB{}, 0))
	b.add(newQuad(kWheels, V3{cx + face*0.9, 0, z0}, V3{0, 0, length}, V3{0, 1, 0}, n, RGB{}, 0))
	beam := b.add(newQuad(kSteel, V3{cx + face*1.3, 0.78, z0}, V3{0, 0, length}, V3{0, 0.28, 0}, n, RGB{}, 0))
	beam.Depth = z0 + length/2
	end := newQuad(kWagonEnd, V3{cx - 1.5, 0.82, z0}, V3{3, 0, 0}, V3{0, 0.18 + bodyHeight, 0}, V3{0, 0, -1}, col, b.rng.Uint32())
	end.P[2] = b.between(0.3, 1)
	b.add(end)
}

func (b *builder) boxcar(cx, z0, length, face float64) {
	col := b.pick(b.wagons)
	n := V3{face, 0, 0}
	xf := cx + face*1.5
	q := newQuad(kWagon, V3{xf, 1.0, z0}, V3{0, 0, length}, V3{0, 2.9, 0}, n, col, b.rng.Uint32())
	door := b.between(0.38, 0.62) * length
	q.P = [4]float64{door, b.pick2(2.2, 3.1), b.between(0.1, 1), b.flag(0.35)}
	b.add(q)
	b.underframe(cx, z0, length, face, col, 2.9)
}

func (b *builder) gondola(cx, z0, length, face float64) {
	col := b.pick(b.wagons)
	n := V3{face, 0, 0}
	xf := cx + face*1.5
	q := newQuad(kWagon, V3{xf, 1.0, z0}, V3{0, 0, length}, V3{0, 2.1, 0}, n, col, b.rng.Uint32())
	q.P = [4]float64{length / 2, 0, b.between(0.3, 1), 0}
	b.add(q)
	b.underframe(cx, z0, length, face, col, 2.1)
	// the load shows over the rim
	load := newQuad(kWagon, V3{xf - face*0.2, 3.0, z0 + 0.4}, V3{0, 0, length - 0.8}, V3{0, b.between(0.2, 0.7), 0}, n, hex(0x2a2622), b.rng.Uint32())
	load.P = [4]float64{length / 2, 0, 0, 0}
	b.add(load)
}

func (b *builder) flatWagon(cx, z0, length, face float64, double bool) {
	n := V3{face, 0, 0}
	deck := newQuad(kSteel, V3{cx + face*1.45, 0.95, z0}, V3{0, 0, length}, V3{0, 0.2, 0}, n, RGB{}, 0)
	b.add(deck)
	b.underframe(cx, z0, length, face, hex(0x2c2a2a), 0.2)
	forty := b.rng.Float64() < 0.55
	if forty {
		b.container(cx, z0+(length-12.19)/2, 12.19, 1.15, face, b.pick(b.boxes))
		if double {
			b.container(cx, z0+(length-12.19)/2, 12.19, 3.74, face, b.pick(b.boxes))
		}
		return
	}
	for i := 0; i < 2; i++ {
		zc := z0 + (length-12.5)/2 + float64(i)*(6.06+0.38)
		b.container(cx, zc, 6.06, 1.15, face, b.pick(b.boxes))
		if double {
			b.container(cx, zc, 6.06, 3.74, face, b.pick(b.boxes))
		}
	}
}

func (b *builder) container(cx, z0, length, y0, face float64, col RGB) {
	xf := cx + face*1.22
	q := newQuad(kContainer, V3{xf, y0, z0}, V3{0, 0, length}, V3{0, 2.59, 0}, V3{face, 0, 0}, col, b.rng.Uint32())
	q.P[2] = b.between(0.0, 0.8)
	b.add(q)
	b.add(newQuad(kContainerEnd, V3{cx - 1.22, y0, z0}, V3{2.44, 0, 0}, V3{0, 2.59, 0}, V3{0, 0, -1}, col.Scale(0.75), b.rng.Uint32()))
}

func (b *builder) pick2(a, c float64) float64 {
	if b.rng.IntN(2) == 0 {
		return a
	}
	return c
}

func (b *builder) flag(p float64) float64 {
	if b.rng.Float64() < p {
		return 1
	}
	return 0
}

// mast puts up a lamp mast at (x,z); the head hangs headDX to the side of the pole.
func (b *builder) mast(x, z, height, headDX float64, heads int) {
	base := V3{x, 0, z}
	w0, w1 := 0.46, 0.2
	pole := newQuad(kPole, base.madd(b.hx, -w0/2), b.hx.Scale(w0), V3{0, height, 0}, b.nx, RGB{}, b.rng.Uint32())
	pole.P[0] = w1 / w0
	b.add(pole)
	hx := x + headDX
	lo, span := math.Min(x, hx), math.Abs(headDX)
	if span > 0 {
		b.add(newQuad(kSteel, V3{lo, height - 0.3, z}, V3{span, 0, 0}, V3{0, 0.2, 0}, b.nx, RGB{}, 0))
	}
	for i := 0; i < heads; i++ {
		off := (float64(i) - float64(heads-1)/2) * 1.7
		b.head(hx+off, height, z)
	}
}

// head is one lamp housing with its shining underside.
func (b *builder) head(x, y, z float64) {
	b.add(newQuad(kHousing, V3{x - 0.75, y - 0.02, z - 0.3}, V3{1.5, 0, 0}, V3{0, 0.36, 0}, b.nx, RGB{}, 0))
	sideX := 1.0
	if b.sc.Pos.X < x {
		sideX = -1
	}
	b.add(newQuad(kHousing, V3{x + sideX*0.75, y - 0.02, z - 0.3}, V3{0, 0, 0.6}, V3{0, 0.36, 0}, V3{sideX, 0, 0}, RGB{}, 0))
	p := newQuad(kPanel, V3{x - 0.7, y - 0.02, z - 0.3}, V3{1.4, 0, 0}, V3{0, 0, 0.6}, V3{0, -1, 0}, lampWarm, 0)
	p.P[0] = 14
	b.add(p)
	b.lamp(Lamp{Pos: V3{x, y - 0.3, z}, Col: lampWarm, Power: lampPower, Glow: 0.9, Size: 1.1, Cone: true})
}

// fill is an unseen lamp that lights the near end faces and the ground close to the camera.
func (b *builder) fill(pos V3, power float64) {
	b.lamp(Lamp{Pos: pos, Col: lampWarm, Power: power, Cos0: -1, Cos1: -0.4})
}

// wash is an unseen low lamp that lights the side of a wagon row and the ground beside it.
func (b *builder) wash(pos V3, power float64) {
	b.lamp(Lamp{Pos: pos, Col: lampWarm, Power: power, Cos0: 0.1, Cos1: 0.6})
}

// signalHead is a signal on a post or gantry: lamps count, which one is lit.
func (b *builder) signalHead(x, y, z float64, lamps, lit int, col RGB) {
	q := newQuad(kSignal, V3{x - 0.2, y, z}, V3{0.4, 0, 0}, V3{0, 0.42 * float64(lamps), 0}, b.nx, col, 0)
	q.P = [4]float64{float64(lamps), float64(lit), 10, 0}
	b.add(q)
	cy := y + q.Hgt*(float64(lit)+0.5)/float64(lamps)
	b.lamp(Lamp{Pos: V3{x, cy, z - 0.1}, Col: col, Power: 14, Glow: 0.55, Size: 0.5, Cos0: -1, Cos1: 0})
}

// gantry spans the tracks with a truss and signal heads.
func (b *builder) gantry(z, x0, x1, y float64) {
	for _, x := range []float64{x0, x1} {
		leg := newQuad(kLattice, V3{x - 0.3, 0, z}, b.hx.Scale(0.6), V3{0, y, 0}, b.nx, RGB{}, 0)
		leg.P = [4]float64{0.07, 0.6, 0, 0}
		b.add(leg)
	}
	span := x1 - x0
	truss := newQuad(kLattice, V3{x0 - 0.3, y - 0.9, z}, V3{span + 0.6, 0, 0}, V3{0, 0.9, 0}, b.nx, RGB{}, 0)
	truss.P = [4]float64{0.06, 0.9, 0, 0}
	b.add(truss)
}

func (b *builder) silhouettes() {
	for az := -1.1; az < 1.1; {
		w := b.between(0.004, 0.016)
		b.sc.Sil = append(b.sc.Sil, Silhouette{az, az + w, b.between(0.003, 0.011)})
		az += w * b.between(0.6, 1.0)
	}
	for i := 0; i < 14; i++ {
		az := b.between(-0.95, 0.95)
		w := b.between(0.03, 0.1)
		b.sc.Sil = append(b.sc.Sil, Silhouette{az, az + w, b.between(0.009, 0.02)})
	}
	for i := 0; i < 5; i++ {
		az := b.between(-0.8, 0.8)
		w := b.between(0.003, 0.006)
		b.sc.Sil = append(b.sc.Sil, Silhouette{az, az + w, b.between(0.03, 0.065)})
	}
}

// finish orders the quads far to near and the lamps by depth.
func (b *builder) finish() *Scene {
	sort.SliceStable(b.sc.Lamps, func(i, j int) bool { return b.sc.Lamps[i].Pos.Z < b.sc.Lamps[j].Pos.Z })
	sort.SliceStable(b.sc.Quads, func(i, j int) bool { return b.sc.Quads[i].Depth > b.sc.Quads[j].Depth })
	return b.sc
}
