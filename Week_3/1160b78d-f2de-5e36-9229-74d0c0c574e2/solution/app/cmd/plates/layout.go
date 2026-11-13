package main

const (
	outW = 1920
	outH = 1080
)

// yardMain is the yard seen down the corridor between two wagon rows. It is the
// scene of the dusk and night plates.
func yardMain() *Scene {
	v := newView(V3{0.0, 1.75, 0}, 0, 0.04, 1480, outW, outH)
	b := newBuilder(v, 20260412)
	sc := b.sc
	sc.Tracks = []float64{-24, -18, -12, -6, 0, 5.2, 10.4, 15.6, 20.8, 26}

	b.wagonRow(5.2, 14, 340, -1, 0.04, false)
	b.wagonRow(10.4, 12, 340, -1, 0.12, true)
	b.wagonRow(15.6, 10, 340, -1, 0.15, true)
	b.wagonRow(20.8, 8, 340, -1, 0.1, true)
	b.wagonRow(26, 8, 340, -1, 0.1, false)
	b.wagonRow(-6, 62, 340, 1, 0.05, false)
	b.wagonRow(-12, 34, 330, 1, 0.1, true)
	b.wagonRow(-18, 12, 330, 1, 0.1, true)
	b.wagonRow(-24, 8, 330, 1, 0.1, false)

	for i := 0; i < 16; i++ {
		b.mast(7.8, 20+float64(i)*40, 13, -4.4, 1)
	}
	for i := 0; i < 15; i++ {
		b.mast(-9, 40+float64(i)*40, 12, 5.6, 1)
	}
	b.mast(0.6, 700, 26, 0, 4)
	b.fill(V3{3.5, 9, -7}, 90)
	b.fill(V3{-3.5, 9, -7}, 90)
	b.gantry(124, -9, 7.8, 7.4)
	for i, x := range []float64{-6, 0, 5.2} {
		lit := []int{0, 0, 2}[i]
		col := []RGB{hex(0xff3a2a), hex(0xff3a2a), hex(0x35ff8a)}[i]
		b.signalHead(x, 5.2, 123.6, 3, lit, col)
	}
	b.silhouettes()
	return b.finish()
}

// yardSignin is the same yard at night seen from the side of the tracks: a long wagon
// row on the right, container stacks on the left and the masts running off to the left of centre.
func yardSignin() *Scene {
	v := newView(V3{-1.4, 1.45, 0}, 0.13, 0.032, 1700, outW, outH)
	b := newBuilder(v, 20260413)
	b.wagons = []uint32{0x3a4656, 0x4a5560, 0x5a3a38, 0x2c3446, 0x4c5a52, 0x6a6558, 0x3d3f49, 0x4e3f36}
	b.boxes = []uint32{0x2d4a68, 0x5c2a2a, 0x8a7a5a, 0x3a5a4c, 0xb8b6ad, 0x4a5a6a, 0x384264, 0x6a4a2a}
	sc := b.sc
	sc.Tracks = []float64{-1.4, 4.1, 9.6, -6.9, -12.4}

	b.wagonRow(4.1, 10, 420, -1, 0.03, false)
	b.wagonRow(9.6, 24, 420, -1, 0.1, true)
	b.wagonRow(-12.4, 40, 300, 1, 0.12, true)
	b.stack(-19, 70, 1, 12)
	for i := 1; i < 14; i++ {
		b.mast(-4.6, 22+float64(i)*46, 12, 3.2, 1)
	}
	for i := 0; i < 14; i++ {
		b.wash(V3{-0.2, 5.5, 18 + float64(i)*23}, 260)
	}
	b.mast(-1.4, 780, 26, 0, 4)
	b.fill(V3{0.5, 9, -7}, 90)
	b.gantry(170, -4.6, 6.85, 7.4)
	b.signalHead(-1.4, 5.2, 169.6, 3, 2, hex(0x35ff8a))
	b.signalHead(4.1, 5.2, 169.6, 3, 0, hex(0xff3a2a))
	b.silhouettes()
	return b.finish()
}

func duskMood() *Mood {
	return &Mood{
		Stops: []skyStop{
			{0, hex(0xf6a361)}, {0.12, hex(0xdc7e5c)}, {0.26, hex(0x8a5a78)},
			{0.42, hex(0x3e4a80)}, {0.65, hex(0x182656)}, {1, hex(0x090f2e)},
		},
		Glow: hex(0xff8a3c).Scale(0.5), GlowAz: 0.14, GlowW: 0.55, GlowH: 0.05,
		Cloud: 0.8, CloudLit: hex(0xe88a5a),
		Ambient: RGB{0.5, 0.6, 1.0}.Scale(0.95), Side: 0.5,
		Kappa: 0.0042, Exposure: 0.8, Skyline: hex(0x1a2036),
		Beam: 0.06, Bloom: 0.8,
	}
}

func nightMood() *Mood {
	return &Mood{
		Stops: []skyStop{
			{0, hex(0x2c3248)}, {0.1, hex(0x1c2338)}, {0.3, hex(0x10172a)},
			{0.6, hex(0x0a0f1e)}, {1, hex(0x060913)},
		},
		Glow: hex(0xff8a3c).Scale(0.07), GlowAz: 0.05, GlowW: 0.7, GlowH: 0.06,
		Cloud: 0.35, CloudLit: hex(0x6a4a3c).Scale(0.4),
		Ambient: RGB{0.5, 0.58, 1.0}.Scale(0.12), Side: 0.55,
		Kappa: 0.0052, Exposure: 0.95, Skyline: hex(0x0a0d18), Lift: RGB{0.003, 0.006, 0.016},
		Beam: 0.1, Bloom: 1.0,
	}
}

func signinMood() *Mood {
	m := nightMood()
	m.Stops = []skyStop{
		{0, hex(0x2a3550)}, {0.1, hex(0x1a2440)}, {0.3, hex(0x101a34)},
		{0.6, hex(0x0b1226)}, {1, hex(0x070b1a)},
	}
	m.Ambient = RGB{0.5, 0.6, 1.0}.Scale(0.14)
	m.Kappa = 0.0046
	m.Exposure = 1.02
	m.Lift = RGB{0.003, 0.007, 0.02}
	m.Beam = 0.07
	return m
}
