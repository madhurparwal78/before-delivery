package main

import "math"

// Every float product that feeds a sum is wrapped in float64(...) so that no
// architecture may fuse it into a multiply-add: the plates must be byte-identical
// on arm64 and amd64.

type V3 struct{ X, Y, Z float64 }

func (a V3) Add(b V3) V3        { return V3{a.X + b.X, a.Y + b.Y, a.Z + b.Z} }
func (a V3) Sub(b V3) V3        { return V3{a.X - b.X, a.Y - b.Y, a.Z - b.Z} }
func (a V3) Scale(k float64) V3 { return V3{float64(a.X * k), float64(a.Y * k), float64(a.Z * k)} }
func (a V3) Dot(b V3) float64 {
	return float64(a.X*b.X) + float64(a.Y*b.Y) + float64(a.Z*b.Z)
}
func (a V3) Len() float64 { return math.Sqrt(a.Dot(a)) }
func (a V3) Norm() V3     { return a.Scale(1 / a.Len()) }

// madd returns a + b*k.
func (a V3) madd(b V3, k float64) V3 { return a.Add(b.Scale(k)) }

func clamp(x, lo, hi float64) float64 {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}

func sat(x float64) float64 { return clamp(x, 0, 1) }

func mix(a, b, t float64) float64 { return a + float64(b-a)*t }

func smooth(e0, e1, x float64) float64 {
	t := sat((x - e0) / (e1 - e0))
	return float64(t*t) * (3 - 2*t)
}

func fract(x float64) float64 { return x - math.Floor(x) }

// RGB is linear light.
type RGB struct{ R, G, B float64 }

func (a RGB) Add(b RGB) RGB { return RGB{a.R + b.R, a.G + b.G, a.B + b.B} }
func (a RGB) Mul(b RGB) RGB {
	return RGB{float64(a.R * b.R), float64(a.G * b.G), float64(a.B * b.B)}
}
func (a RGB) Scale(k float64) RGB { return RGB{float64(a.R * k), float64(a.G * k), float64(a.B * k)} }
func (a RGB) at(c int) float64 {
	switch c {
	case 0:
		return a.R
	case 1:
		return a.G
	}
	return a.B
}

func mixRGB(a, b RGB, t float64) RGB {
	return RGB{a.R + float64(b.R-a.R)*t, a.G + float64(b.G-a.G)*t, a.B + float64(b.B-a.B)*t}
}

var srgbLinear = func() (t [256]float64) {
	for i := range t {
		c := float64(i) / 255
		if c <= 0.04045 {
			t[i] = c / 12.92
		} else {
			t[i] = math.Pow((c+0.055)/1.055, 2.4)
		}
	}
	return t
}()

// hex converts an sRGB colour such as 0x7a3326 to linear light.
func hex(c uint32) RGB {
	return RGB{srgbLinear[c>>16&255], srgbLinear[c>>8&255], srgbLinear[c&255]}
}

const encodeSteps = 16384

var srgbCurve = func() (t [encodeSteps + 1]float64) {
	for i := range t {
		x := float64(i) / encodeSteps
		if x <= 0.0031308 {
			t[i] = 12.92 * x
		} else {
			t[i] = float64(1.055*math.Pow(x, 1/2.4)) - 0.055
		}
	}
	return t
}()

// srgbEncode turns linear light in [0,1] into an sRGB value in [0,1].
func srgbEncode(x float64) float64 {
	f := float64(x * encodeSteps)
	i := int(f)
	if i >= encodeSteps {
		return srgbCurve[encodeSteps]
	}
	return mix(srgbCurve[i], srgbCurve[i+1], f-float64(i))
}

// hash32 mixes three integers into a well-spread 32-bit value.
func hash32(a, b int32, seed uint32) uint32 {
	h := uint32(a)*0x27d4eb2d ^ uint32(b)*0x165667b1 ^ seed*0x9e3779b1
	h ^= h >> 15
	h *= 0x85ebca6b
	h ^= h >> 13
	h *= 0xc2b2ae35
	h ^= h >> 16
	return h
}

func unit(h uint32) float64 { return float64(h>>8) / 16777216 }

// vnoise is smooth value noise in [0,1).
func vnoise(x, y float64, seed uint32) float64 {
	fx, fy := math.Floor(x), math.Floor(y)
	ix, iy := int32(fx), int32(fy)
	tx, ty := x-fx, y-fy
	tx = float64(tx*tx) * (3 - 2*tx)
	ty = float64(ty*ty) * (3 - 2*ty)
	a := unit(hash32(ix, iy, seed))
	b := unit(hash32(ix+1, iy, seed))
	c := unit(hash32(ix, iy+1, seed))
	d := unit(hash32(ix+1, iy+1, seed))
	return mix(mix(a, b, tx), mix(c, d, tx), ty)
}

// fbm layers octaves of value noise; the result is in [0,1).
func fbm(x, y float64, seed uint32, octaves int) float64 {
	sum, amp, norm := 0.0, 0.5, 0.0
	for i := 0; i < octaves; i++ {
		sum += float64(amp * vnoise(x, y, seed+uint32(i)*131))
		norm += amp
		x, y = float64(x*2.03)+17.3, float64(y*2.03)+9.1
		amp *= 0.5
	}
	return sum / norm
}

// expNeg is exp(-x) for x >= 0 from a fixed polynomial, so that no platform
// assembly version of math.Exp can differ between architectures.
func expNeg(x float64) float64 {
	if x > 40 {
		return 0
	}
	n := math.Floor(x * 1.4426950408889634)
	r := x - float64(n*0.6931471805599453)
	p := 1 + r*(-1+r*(0.5+r*(-1.0/6+r*(1.0/24+r*(-1.0/120+r*(1.0/720))))))
	return math.Ldexp(p, -int(n))
}
