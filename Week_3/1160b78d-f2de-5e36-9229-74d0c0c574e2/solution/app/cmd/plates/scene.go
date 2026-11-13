package main

import "math"

// Surface kinds understood by the shaders.
const (
	kWagon = iota
	kWagonEnd
	kContainer
	kContainerEnd
	kVoid
	kWheels
	kPole
	kSteel
	kHousing
	kPanel
	kSignal
	kLattice
)

// Quad is a rectangle in the world: O, O+U, O+U+V, O+V. N points out of the lit face.
type Quad struct {
	O, U, V  V3
	N        V3
	Kind     int
	Col      RGB
	P        [4]float64 // kind specific parameters
	Seed     uint32
	Len, Hgt float64 // |U|, |V| in metres
	uu, vv   float64 // 1/(U.U), 1/(V.V)
	Depth    float64 // paint order key: farther first
}

func newQuad(kind int, o, u, v, n V3, col RGB, seed uint32) *Quad {
	q := &Quad{O: o, U: u, V: v, N: n, Kind: kind, Col: col, Seed: seed}
	q.Len, q.Hgt = u.Len(), v.Len()
	q.uu, q.vv = 1/u.Dot(u), 1/v.Dot(v)
	q.Depth = o.Add(u.Scale(0.5)).Z
	return q
}

// Lamp is a light source that also shows as a glowing head.
type Lamp struct {
	Pos        V3
	Col        RGB
	Power      float64 // lighting strength
	Glow       float64 // visible strength of the halo
	Size       float64 // halo radius in metres
	Cone       bool    // draws a visible light cone down to the ground
	Cos0, Cos1 float64 // spot falloff: zero at Cos0, full at Cos1 (cosine of the angle from straight down)
}

// Row is a continuous line of wagons that shadows what lies behind it.
type Row struct {
	X0, X1, Z0, Z1, H float64
}

// Silhouette is a distant block on the horizon, in angle space.
type Silhouette struct {
	Az0, Az1, Top float64
}

// Scene is one yard: its camera, solid parts and lights. The same Scene renders
// as dusk and as night.
type Scene struct {
	View
	Quads  []*Quad
	Lamps  []Lamp
	Rows   []Row
	Tracks []float64
	Sil    []Silhouette
	Seed   uint32
	Wet    float64 // overall wetness of the asphalt, 0..1
}

type skyStop struct {
	T float64
	C RGB
}

// Mood is the sky, ambient light and exposure of one plate.
type Mood struct {
	Stops    []skyStop
	Glow     RGB
	GlowAz   float64
	GlowW    float64
	GlowH    float64
	Cloud    float64
	CloudLit RGB
	Ambient  RGB
	Side     float64
	Kappa    float64
	Exposure float64
	Skyline  RGB
	Beam     float64
	Bloom    float64
	Lift     RGB
}

func (m *Mood) gradient(t float64) RGB {
	s := m.Stops
	if t <= s[0].T {
		return s[0].C
	}
	for i := 1; i < len(s); i++ {
		if t <= s[i].T {
			return mixRGB(s[i-1].C, s[i].C, (t-s[i-1].T)/(s[i].T-s[i-1].T))
		}
	}
	return s[len(s)-1].C
}

// sky is the colour seen along the unit direction d (d.Y >= 0).
func (m *Mood) sky(d V3) RGB {
	h := sat(d.Y)
	c := m.gradient(math.Sqrt(h))
	az := math.Atan2(d.X, d.Z)
	da := (az - m.GlowAz) / m.GlowW
	g := expNeg(float64(0.5*da*da)) * expNeg(h/m.GlowH)
	c = c.Add(m.Glow.Scale(g))
	if m.Cloud > 0 && d.Y > 0.003 {
		k := 1 / (d.Y + 0.035)
		cx, cz := float64(d.X*k)*0.55, float64(d.Z*k)*0.22
		n := fbm(cx+3.1, cz+7.7, 901, 5)
		band := smooth(0.46, 0.78, n)
		fade := smooth(0.0, 0.06, d.Y) * (1 - smooth(0.35, 0.85, d.Y)*0.6)
		lit := expNeg(h/0.16) * (0.35 + 0.65*(1-band))
		cc := c.Scale(0.5).Add(m.CloudLit.Scale(lit))
		c = mixRGB(c, cc, float64(band*fade)*m.Cloud)
	}
	return c
}

// fog is the haze colour along the horizontal direction of d.
func (m *Mood) fog(d V3) RGB {
	n := math.Sqrt(float64(d.X*d.X) + float64(d.Z*d.Z))
	return m.sky(V3{d.X / n, 0, d.Z / n})
}
