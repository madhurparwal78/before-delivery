package main

import (
	"math"
	"runtime"
	"sync"
)

// View is a pinhole camera looking along +z with a yaw and a downward pitch.
// World axes: x right, y up, z away from the camera.
type View struct {
	Pos     V3
	F, R, U V3
	Focal   float64 // pixels at the 1x output size
	OutW    int     // output size in pixels
	OutH    int
}

func newView(pos V3, yaw, pitch, focal float64, w, h int) View {
	sy, cy := math.Sin(yaw), math.Cos(yaw)
	sp, cp := math.Sin(pitch), math.Cos(pitch)
	return View{
		Pos:   pos,
		F:     V3{float64(sy * cp), -sp, float64(cy * cp)},
		R:     V3{cy, 0, -sy},
		U:     V3{float64(sy * sp), cp, float64(cy * sp)},
		Focal: focal, OutW: w, OutH: h,
	}
}

// Target is a render buffer at an integer multiple of the output size.
type Target struct {
	View
	Scale  int
	W, H   int
	CX, CY float64
	Fpx    float64
	Pix    []float32 // RGB, three floats per pixel
	Depth  []float32 // ray parameter of the nearest surface
	Alpha  []float32 // coverage; only the reflection target keeps it
}

func newTarget(v View, scale int, withAlpha bool) *Target {
	t := &Target{View: v, Scale: scale, W: v.OutW * scale, H: v.OutH * scale}
	t.CX, t.CY = float64(t.W)/2, float64(t.H)/2
	t.Fpx = float64(v.Focal * float64(scale))
	t.Pix = make([]float32, t.W*t.H*3)
	t.Depth = make([]float32, t.W*t.H)
	for i := range t.Depth {
		t.Depth[i] = float32(math.Inf(1))
	}
	if withAlpha {
		t.Alpha = make([]float32, t.W*t.H)
	}
	return t
}

// project returns screen coordinates and camera depth of a world point.
func (t *Target) project(p V3) (x, y, zc float64) {
	d := p.Sub(t.Pos)
	zc = d.Dot(t.F)
	x = t.CX + float64(t.Fpx*d.Dot(t.R))/zc
	y = t.CY - float64(t.Fpx*d.Dot(t.U))/zc
	return
}

// rayRow returns the direction of the ray through pixel column 0 at row centre yc
// and the step to the next column.
func (t *Target) rayRow(yc float64) (base, step V3) {
	base = t.F.Scale(t.Fpx).madd(t.U, -(yc-t.CY)).madd(t.R, -t.CX+0.5)
	return base, t.R
}

// parallelRows splits [0,h) into bands, one goroutine each; each band touches
// only its own rows, so the result does not depend on scheduling.
func parallelRows(h int, fn func(y0, y1 int)) {
	n := runtime.NumCPU()
	bands := n * 4
	var wg sync.WaitGroup
	jobs := make(chan [2]int, bands)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for b := range jobs {
				fn(b[0], b[1])
			}
		}()
	}
	for i := 0; i < bands; i++ {
		jobs <- [2]int{i * h / bands, (i + 1) * h / bands}
	}
	close(jobs)
	wg.Wait()
}
