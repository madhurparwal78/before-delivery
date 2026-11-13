// Command plates draws the freight yard plates used by the entry screens.
// One seeded procedural script, run during build, writes both views in the same
// light. Nothing is fetched from the network.
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"math/rand"
	"os"
	"path/filepath"
)

const (
	width  = 1280
	height = 768
	seed   = 20270405
)

type rgb struct{ r, g, b float64 }

func mix(a, b rgb, t float64) rgb {
	return rgb{a.r + (b.r-a.r)*t, a.g + (b.g-a.g)*t, a.b + (b.b-a.b)*t}
}

func (c rgb) add(o rgb, w float64) rgb {
	return rgb{c.r + o.r*w, c.g + o.g*w, c.b + o.b*w}
}

func (c rgb) nrgba() color.NRGBA {
	clamp := func(v float64) uint8 {
		if v <= 0 {
			return 0
		}
		if v >= 1 {
			return 255
		}
		return uint8(v*255 + 0.5)
	}
	return color.NRGBA{clamp(c.r), clamp(c.g), clamp(c.b), 255}
}

// view carries the two lights the plates are drawn in.
type view struct {
	name            string
	skyTop, skyLow  rgb
	glow            rgb
	glowStrength    float64
	lamp            rgb
	lampStrength    float64
	ground          rgb
	wagon           rgb
	ambientWagon    float64
	reflectionAlpha float64
}

var views = []view{
	{
		name:   "dusk",
		skyTop: rgb{0.055, 0.082, 0.161}, skyLow: rgb{0.447, 0.278, 0.157},
		glow: rgb{0.98, 0.59, 0.27}, glowStrength: 0.85,
		lamp: rgb{1.0, 0.78, 0.46}, lampStrength: 0.72,
		ground: rgb{0.082, 0.078, 0.098}, wagon: rgb{0.106, 0.102, 0.129},
		ambientWagon: 0.30, reflectionAlpha: 0.42,
	},
	{
		name:   "night",
		skyTop: rgb{0.020, 0.031, 0.075}, skyLow: rgb{0.098, 0.102, 0.173},
		glow: rgb{0.62, 0.45, 0.30}, glowStrength: 0.42,
		lamp: rgb{1.0, 0.72, 0.38}, lampStrength: 0.95,
		ground: rgb{0.035, 0.039, 0.055}, wagon: rgb{0.055, 0.059, 0.078},
		ambientWagon: 0.16, reflectionAlpha: 0.55,
	},
}

type mast struct {
	x, headY, strength float64
}

type wagon struct {
	x, w, h, row float64
}

func main() {
	out := filepath.Join("internal", "web", "static", "plates")
	if err := os.MkdirAll(out, 0o755); err != nil {
		fail(err)
	}
	rng := rand.New(rand.NewSource(seed))
	masts, wagons := layout(rng)
	noise := make([]float64, width*height)
	for i := range noise {
		noise[i] = rng.Float64()
	}
	for _, v := range views {
		img := draw(v, masts, wagons, noise)
		f, err := os.Create(filepath.Join(out, v.name+".png"))
		if err != nil {
			fail(err)
		}
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		if err := enc.Encode(f, img); err != nil {
			fail(err)
		}
		if err := f.Close(); err != nil {
			fail(err)
		}
		fmt.Printf("plate: %s\n", filepath.Join(out, v.name+".png"))
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "plates:", err)
	os.Exit(1)
}

// layout places the lamp masts and the wagon rows once, so both views share a
// single arrangement and the focal cluster sits in the upper two-thirds.
func layout(rng *rand.Rand) ([]mast, []wagon) {
	var masts []mast
	for i := 0; i < 7; i++ {
		x := 56 + float64(i)*196 + rng.Float64()*48
		headY := 150 + rng.Float64()*120
		strength := 0.55 + rng.Float64()*0.35
		masts = append(masts, mast{x: x, headY: headY, strength: strength})
	}
	// The focal mast, brightest and highest, stands left of centre.
	masts[2].strength = 1.0
	masts[2].headY = 132

	var wagons []wagon
	for row := 0.0; row < 4; row++ {
		x := -60 + rng.Float64()*90
		for x < width+60 {
			w := 90 + rng.Float64()*130
			h := 46 + rng.Float64()*34 - row*5
			wagons = append(wagons, wagon{x: x, w: w, h: h, row: row})
			x += w + 6 + rng.Float64()*26
		}
	}
	return masts, wagons
}

func draw(v view, masts []mast, wagons []wagon, noise []float64) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	horizon := height * 0.60

	rowBase := func(row float64) float64 { return horizon - 18 + row*26 }

	for y := 0; y < height; y++ {
		fy := float64(y)
		for x := 0; x < width; x++ {
			fx := float64(x)
			var c rgb
			if fy < horizon {
				t := math.Pow(fy/horizon, 1.7)
				c = mix(v.skyTop, v.skyLow, t)
				band := math.Exp(-math.Pow((horizon-fy)/150, 2))
				c = c.add(v.glow, band*v.glowStrength*0.35)
			} else {
				t := (fy - horizon) / (height - horizon)
				c = mix(v.ground.add(v.glow, 0.10), v.ground, math.Pow(t, 0.6))
			}
			// Lamp haloes, and their reflections down the wet asphalt.
			for _, m := range masts {
				dx := fx - m.x
				dy := fy - m.headY
				d := math.Sqrt(dx*dx+dy*dy*1.45) / 240
				c = c.add(v.lamp, v.lampStrength*m.strength*math.Exp(-d*d*2.4)*0.55)
				if fy > horizon {
					rd := math.Abs(dx) / 26
					fall := (fy - horizon) / (height - horizon)
					streak := math.Exp(-rd*rd) * (1 - fall) * v.reflectionAlpha * m.strength
					c = c.add(v.lamp, streak*0.5)
				}
			}
			img.SetNRGBA(x, y, c.nrgba())
		}
	}

	// Wagon rows, far rows first so near rows overlap them.
	for _, w := range wagons {
		base := rowBase(w.row)
		shade := v.wagon.add(v.glow, v.ambientWagon*(1-w.row*0.22)*0.25)
		top := int(base - w.h)
		for y := top; y < int(base); y++ {
			if y < 0 || y >= height {
				continue
			}
			for x := int(w.x); x < int(w.x+w.w); x++ {
				if x < 0 || x >= width {
					continue
				}
				c := shade
				if y == top || y == top+1 {
					c = shade.add(v.lamp, 0.22)
				}
				img.SetNRGBA(x, y, c.nrgba())
			}
		}
		// Bogies under each wagon.
		for _, off := range []float64{0.2, 0.78} {
			cx := w.x + w.w*off
			for y := int(base); y < int(base+5); y++ {
				for x := int(cx - 12); x < int(cx+12); x++ {
					if x >= 0 && x < width && y >= 0 && y < height {
						img.SetNRGBA(x, y, v.ground.nrgba())
					}
				}
			}
		}
	}

	// Lamp masts: pole, crossarm, lamp head.
	for _, m := range masts {
		poleTop := int(m.headY)
		poleBottom := int(horizon + 30)
		for y := poleTop; y < poleBottom; y++ {
			for x := int(m.x - 3); x <= int(m.x+3); x++ {
				if x >= 0 && x < width && y >= 0 && y < height {
					img.SetNRGBA(x, y, v.wagon.add(v.lamp, 0.10).nrgba())
				}
			}
		}
		for x := int(m.x - 34); x <= int(m.x+34); x++ {
			for y := poleTop - 10; y < poleTop-4; y++ {
				if x >= 0 && x < width && y >= 0 && y < height {
					img.SetNRGBA(x, y, v.wagon.add(v.lamp, 0.16).nrgba())
				}
			}
		}
		for _, hx := range []float64{m.x - 26, m.x + 26} {
			for y := poleTop - 6; y < poleTop+6; y++ {
				for x := int(hx - 11); x <= int(hx+11); x++ {
					if x >= 0 && x < width && y >= 0 && y < height {
						img.SetNRGBA(x, y, v.lamp.nrgba())
					}
				}
			}
		}
	}

	// Grain, so the plates read as one photographic surface.
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			n := (noise[y*width+x] - 0.5) * 0.02
			p := img.NRGBAAt(x, y)
			c := rgb{float64(p.R) / 255, float64(p.G) / 255, float64(p.B) / 255}
			img.SetNRGBA(x, y, c.add(rgb{1, 1, 1}, n).nrgba())
		}
	}
	return img
}
