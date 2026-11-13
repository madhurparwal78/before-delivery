package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

// Deterministic procedural freight-yard plates: one seeded script, same light,
// rendered at build time into static/img; nothing is fetched at runtime.
func main() {
	out := flag.String("out", "static/img", "output directory")
	flag.Parse()
	if err := os.MkdirAll(*out, 0o755); err != nil {
		panic(err)
	}
	w, h := 1600, 1040
	for _, name := range []string{"plate-dusk.png", "plate-night.png", "plate-mobile-dusk.png", "plate-mobile-night.png"} {
		mobile := strings.Contains(name, "mobile")
		dark := strings.Contains(name, "night")
		seed := uint32(7)
		if mobile {
			seed = 11
		}
		rnd := newRng(seed*2654435761 + 1)
		img := render(w, h, mobile, dark, rnd)
		f := filepath.Join(*out, name)
		fo, err := os.Create(f)
		if err != nil {
			panic(err)
		}
		err = png.Encode(fo, img)
		fo.Close()
		if err != nil {
			panic(err)
		}
		fmt.Println("wrote", f)
	}
}

type rng struct{ s uint32 }

func newRng(seed uint32) *rng {
	return &rng{s: seed | 1}
}

func (r *rng) next() uint32 {
	x := r.s
	x ^= x << 13
	x ^= x >> 17
	x ^= x << 5
	r.s = x
	return x
}

func clamp(v float64) uint8 {
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	return uint8(v*255 + 0.5)
}

type rgb struct{ r, g, b float64 }

func (c rgb) at(v float64) color.RGBA {
	return color.RGBA{clamp(c.r * v), clamp(c.g * v), clamp(c.b * v), 255}
}

var duskSky = rgb{0.29, 0.22, 0.30}
var nightSky = rgb{0.05, 0.06, 0.12}

func render(w, h int, mobile, dark bool, r *rng) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	sky := duskSky
	if dark {
		sky = nightSky
	}
	horizon := h * 58 / 100
	for y := 0; y < horizon; y++ {
		t := float64(y) / float64(horizon)
		c := sky.at(1.0 - t*0.55)
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	for y := horizon; y < h; y++ {
		t := float64(y-horizon) / float64(h-horizon)
		c := color.RGBA{clamp(0.08 + t*0.05), clamp(0.085 + t*0.05), clamp(0.10 + t*0.05), 255}
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	// Lamp masts with sodium glow, focal point in the upper two thirds.
	masts := 6
	if mobile {
		masts = 4
	}
	for i := 0; i < masts; i++ {
		mx := w*(i+1)/(masts+1) - w/14
		my := h * 40 / 100
		mh := h * 20 / 100
		for x := mx - w/24; x < mx+w/24; x++ {
			if x < 0 || x >= w {
				continue
			}
			for y := my - h/14; y < my; y++ {
				if y < 0 || y >= h {
					continue
				}
				dx := float64(x-mx) / float64(w/24)
				dy := float64(y-my) / float64(h/14)
				d := dx*dx + dy*dy
				if d < 1 {
					a := (1 - d) * 0.5
					px := img.RGBAAt(x, y)
					glow := color.RGBA{140, 112, 56, 255}
					img.SetRGBA(x, y, color.RGBA{
						uint8(float64(px.R)*(1-a) + float64(glow.R)*a),
						uint8(float64(px.G)*(1-a) + float64(glow.G)*a),
						uint8(float64(px.B)*(1-a) + float64(glow.B)*a), 255})
				}
			}
		}
		for y := my; y < my+mh && y < h; y++ {
			for x := mx - 3; x < mx+3; x++ {
				if x >= 0 && x < w {
					img.SetRGBA(x, y, color.RGBA{26, 28, 38, 255})
				}
			}
		}
		lamp := color.RGBA{255, 196, 110, 255}
		for y := my - 6; y < my+6; y++ {
			for x := mx - 6; x < mx+6; x++ {
				if x < 0 || x >= w || y < 0 || y >= h {
					continue
				}
				dx := float64(x-mx) / 6
				dy := float64(y-my) / 6
				if dx*dx+dy*dy < 1 {
					img.SetRGBA(x, y, lamp)
				}
			}
		}
	}
	// Wagon rows receding on the wet asphalt.
	rows := 5
	if mobile {
		rows = 4
	}
	for i := 0; i < rows; i++ {
		ry := h*62/100 + i*h*7/100
		rh := h*6/100 + i*h*2/100
		x0 := w * (2 + i) / 16
		x1 := w - w*(2+i)/16
		sh := uint8(20 + i*7)
		for y := ry; y < ry+rh && y < h; y++ {
			for x := x0; x < x1; x++ {
				p := color.RGBA{sh, sh + 3, sh + 10, 255}
				if (x/40+y/12)%2 == 0 {
					p.R += 6
					p.G += 5
					p.B += 2
				}
				img.SetRGBA(x, y, p)
			}
		}
		for x := x0 + w/40; x < x1; x += w / 16 {
			for y := ry + rh - 3; y < ry+rh && y < h; y++ {
				if x < w {
					img.SetRGBA(x, y, color.RGBA{12, 12, 16, 255})
				}
			}
		}
	}
	// Faint rails and speckle.
	for i := 0; i < 3; i++ {
		ry := h*60/100 + i*h*12/100
		for x := 0; x < w; x += 3 {
			for y := ry; y < ry+2 && y < h; y++ {
				p := img.RGBAAt(x, y)
				img.SetRGBA(x, y, color.RGBA{p.R + 10, p.G + 9, p.B + 12, 255})
			}
		}
	}
	for i := 0; i < w*h/50; i++ {
		x := int(r.next()) % w
		y := int(r.next()) % h
		p := img.RGBAAt(x, y)
		d := uint8(r.next() % 9)
		img.SetRGBA(x, y, color.RGBA{p.R + d, p.G + d, p.B + d, 255})
	}
	return img
}
