// Command plates draws the three yard plates of the entry screens: dusk, night and
// sign-in. It is one seeded procedural renderer that uses only the standard library,
// so the same inputs always give the same bytes.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"image/jpeg"
	"os"
	"path/filepath"
)

const jpegQuality = 86

// plate is one picture to draw: a yard in a mood.
type plate struct {
	name  string
	scene *Scene
	mood  *Mood
	seed  uint32 // seeds the film grain
}

func render(sc *Scene, m *Mood, supersample int, seed uint32) ([]byte, error) {
	refl := newTarget(sc.View, 1, true)
	parallelRows(refl.H, func(y0, y1 int) {
		for _, q := range sc.Quads {
			sc.drawQuad(m, refl, q, true, y0, y1)
		}
		sc.paintGlow(m, refl, true, y0, y1)
	})
	rf := blurFrame(refl)
	main := newTarget(sc.View, supersample, false)
	parallelRows(main.H, func(y0, y1 int) {
		sc.paintBackground(m, main, rf, y0, y1)
		for _, q := range sc.Quads {
			sc.drawQuad(m, main, q, false, y0, y1)
		}
		sc.paintGlow(m, main, false, y0, y1)
	})
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, finish(main, m, seed), &jpeg.Options{Quality: jpegQuality}); err != nil {
		return nil, fmt.Errorf("encode plate: %w", err)
	}
	return buf.Bytes(), nil
}

func run(out, only string, supersample int) error {
	if err := os.MkdirAll(out, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", out, err)
	}
	yard := yardMain()
	plates := []plate{
		{"dusk", yard, duskMood(), 101},
		{"night", yard, nightMood(), 102},
		{"signin", yardSignin(), signinMood(), 103},
	}
	for _, p := range plates {
		if only != "" && only != p.name {
			continue
		}
		data, err := render(p.scene, p.mood, supersample, p.seed)
		if err != nil {
			return fmt.Errorf("render %s: %w", p.name, err)
		}
		path := filepath.Join(out, p.name+".jpg")
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", path, err)
		}
		fmt.Printf("%s: %d bytes\n", path, len(data))
	}
	return nil
}

func main() {
	out := flag.String("out", "web/img", "directory the plates are written to")
	only := flag.String("only", "", "draw just this plate (dusk, night or signin)")
	supersample := flag.Int("ss", 2, "supersampling factor")
	flag.Parse()
	if err := run(*out, *only, *supersample); err != nil {
		fmt.Fprintln(os.Stderr, "plates:", err)
		os.Exit(1)
	}
}
