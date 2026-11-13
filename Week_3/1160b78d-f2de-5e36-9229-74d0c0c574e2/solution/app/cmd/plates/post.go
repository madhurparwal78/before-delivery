package main

import (
	"image"
	"image/color"
	"math"
)

// blurred returns a copy of t with its colour and coverage box-blurred.
func blurred(t *Target, rx, ry, passes int) *Target {
	out := &Target{View: t.View, Scale: t.Scale, W: t.W, H: t.H, CX: t.CX, CY: t.CY, Fpx: t.Fpx}
	out.Pix = append([]float32(nil), t.Pix...)
	out.Alpha = append([]float32(nil), t.Alpha...)
	for i := 0; i < passes; i++ {
		boxBlur(out.Pix, t.W, t.H, 3, rx, ry)
		boxBlur(out.Alpha, t.W, t.H, 1, rx, ry)
	}
	return out
}

// boxBlur blurs an interleaved float image in place with a (2rx+1) x (2ry+1) box.
func boxBlur(pix []float32, w, h, ch, rx, ry int) {
	tmp := make([]float32, len(pix))
	if rx > 0 {
		parallelRows(h, func(y0, y1 int) {
			for y := y0; y < y1; y++ {
				for c := 0; c < ch; c++ {
					var sum float64
					at := func(x int) float64 {
						if x < 0 {
							x = 0
						}
						if x >= w {
							x = w - 1
						}
						return float64(pix[(y*w+x)*ch+c])
					}
					for x := -rx; x <= rx; x++ {
						sum += at(x)
					}
					n := float64(2*rx + 1)
					for x := 0; x < w; x++ {
						tmp[(y*w+x)*ch+c] = float32(sum / n)
						sum += at(x+rx+1) - at(x-rx)
					}
				}
			}
		})
		copy(pix, tmp)
	}
	if ry > 0 {
		parallelRows(w, func(x0, x1 int) {
			for x := x0; x < x1; x++ {
				for c := 0; c < ch; c++ {
					var sum float64
					at := func(y int) float64 {
						if y < 0 {
							y = 0
						}
						if y >= h {
							y = h - 1
						}
						return float64(pix[(y*w+x)*ch+c])
					}
					for y := -ry; y <= ry; y++ {
						sum += at(y)
					}
					n := float64(2*ry + 1)
					for y := 0; y < h; y++ {
						tmp[(y*w+x)*ch+c] = float32(sum / n)
						sum += at(y+ry+1) - at(y-ry)
					}
				}
			}
		})
		copy(pix, tmp)
	}
}

// plane is a float RGB image.
type plane struct {
	w, h int
	pix  []float32
}

// halve averages 2x2 blocks.
func (p plane) halve() plane {
	o := plane{p.w / 2, p.h / 2, nil}
	o.pix = make([]float32, o.w*o.h*3)
	parallelRows(o.h, func(y0, y1 int) {
		for y := y0; y < y1; y++ {
			for x := 0; x < o.w; x++ {
				for c := 0; c < 3; c++ {
					s := p.pix[((2*y)*p.w+2*x)*3+c] + p.pix[((2*y)*p.w+2*x+1)*3+c] +
						p.pix[((2*y+1)*p.w+2*x)*3+c] + p.pix[((2*y+1)*p.w+2*x+1)*3+c]
					o.pix[(y*o.w+x)*3+c] = s / 4
				}
			}
		}
	})
	return o
}

// addScaled adds src, enlarged bilinearly to p's size, times k.
func (p plane) addScaled(src plane, k float32) {
	parallelRows(p.h, func(y0, y1 int) {
		for y := y0; y < y1; y++ {
			fy := (float64(y)+0.5)*float64(src.h)/float64(p.h) - 0.5
			iy := int(math.Floor(fy))
			ty := float32(fy - float64(iy))
			for x := 0; x < p.w; x++ {
				fx := (float64(x)+0.5)*float64(src.w)/float64(p.w) - 0.5
				ix := int(math.Floor(fx))
				tx := float32(fx - float64(ix))
				for c := 0; c < 3; c++ {
					g := func(xx, yy int) float32 {
						xx = min(max(xx, 0), src.w-1)
						yy = min(max(yy, 0), src.h-1)
						return src.pix[(yy*src.w+xx)*3+c]
					}
					a := g(ix, iy)*(1-tx) + g(ix+1, iy)*tx
					b := g(ix, iy+1)*(1-tx) + g(ix+1, iy+1)*tx
					p.pix[(y*p.w+x)*3+c] += k * (a*(1-ty) + b*ty)
				}
			}
		}
	})
}

// finish turns the supersampled HDR target into the 8-bit picture: downsample, bloom,
// exposure, tone curve, vignette, grain.
func finish(t *Target, m *Mood, seed uint32) *image.RGBA {
	p := plane{t.W, t.H, t.Pix}
	for s := t.Scale; s > 1; s /= 2 {
		p = p.halve()
	}
	// bloom from the bright parts only
	bright := plane{p.w, p.h, make([]float32, len(p.pix))}
	for i, v := range p.pix {
		if v > 0.9 {
			bright.pix[i] = v - 0.9
		}
	}
	levels := []plane{bright.halve()}
	for i := 0; i < 3; i++ {
		levels = append(levels, levels[i].halve())
	}
	weights := []float32{0.22, 0.3, 0.38, 0.5}
	for i, lv := range levels {
		boxBlur(lv.pix, lv.w, lv.h, 3, 3, 3)
		boxBlur(lv.pix, lv.w, lv.h, 3, 3, 3)
		p.addScaled(lv, weights[i]*float32(m.Bloom))
	}
	img := image.NewRGBA(image.Rect(0, 0, p.w, p.h))
	parallelRows(p.h, func(y0, y1 int) {
		for y := y0; y < y1; y++ {
			ny := (float64(y) + 0.5) / float64(p.h)
			for x := 0; x < p.w; x++ {
				nx := (float64(x) + 0.5) / float64(p.w)
				dx, dy := (nx-0.5)*1.78, ny-0.5
				r := math.Sqrt(float64(dx*dx) + float64(dy*dy))
				vig := 1 - float64(0.5*smooth(0.3, 1.2, r))
				vig *= 1 - float64(0.55*smooth(0.88, 1.0, ny))
				var out [3]float64
				for c := 0; c < 3; c++ {
					v := float64(p.pix[(y*p.w+x)*3+c])*m.Exposure*vig + m.Lift.at(c)
					v = float64(v*(2.51*v+0.03)) / (float64(v*(2.43*v+0.59)) + 0.14)
					out[c] = srgbEncode(sat(v))
				}
				lum := float64(0.3*out[0]) + float64(0.6*out[1]) + float64(0.1*out[2])
				amp := 0.011 + float64(0.014*(1-lum))
				n := unit(hash32(int32(x), int32(y), seed)) + unit(hash32(int32(x), int32(y), seed+1)) - 1
				var px [3]uint8
				for c := 0; c < 3; c++ {
					v := float64(out[c]*255) + float64(n*amp*255) + 0.5
					px[c] = uint8(clamp(v, 0, 255))
				}
				img.SetRGBA(x, y, color.RGBA{px[0], px[1], px[2], 255})
			}
		}
	})
	return img
}

// blurFrame prepares the two sharpness levels of the reflection.
func blurFrame(t *Target) *reflection {
	return &reflection{sharp: blurred(t, 1, 1, 1), soft: blurred(t, 3, 14, 3)}
}
