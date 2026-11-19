package sim

import "testing"

func TestGrenadeFalloff(t *testing.T) {
	cases := []struct {
		distance float64
		want     int
	}{
		{0, 100},
		{1.0, 100},
		{1.5, 88},
		{3.0, 50},
		{4.5, 13},
		{5.0, 0},
		{6.0, 0},
	}
	for _, c := range cases {
		if got := falloff(c.distance, GrenadeRadius, GrenadeMaxDamage); got != c.want {
			t.Errorf("grenade falloff at %.1f m = %d, want %d", c.distance, got, c.want)
		}
	}
}

func TestBarrelFalloff(t *testing.T) {
	cases := []struct {
		distance float64
		want     int
	}{
		{0.5, 80},
		{1.0, 80},
		{2.0, 53},
		{2.5, 40},
		{4.0, 0},
	}
	for _, c := range cases {
		if got := falloff(c.distance, BarrelRadius, BarrelMaxDamage); got != c.want {
			t.Errorf("barrel falloff at %.1f m = %d, want %d", c.distance, got, c.want)
		}
	}
}

func TestRayCircle(t *testing.T) {
	// A ray east from the origin meets a circle of radius 1 at (10,0) at 9 m.
	if got, ok := rayCircle(0, 0, 1, 0, 10, 0, 1); !ok || got != 9 {
		t.Errorf("head-on hit = %v %v, want 9 true", got, ok)
	}
	// A ray east misses a circle 2 m north of the line.
	if _, ok := rayCircle(0, 0, 1, 0, 10, 2, 1); ok {
		t.Error("a ray 2 m clear of a 1 m circle misses")
	}
	// A ray starting inside the circle hits at once.
	if got, ok := rayCircle(10, 0, 1, 0, 10, 0, 1); !ok || got != 0 {
		t.Errorf("inside the circle = %v %v, want 0 true", got, ok)
	}
	// A circle behind the ray is not hit.
	if _, ok := rayCircle(0, 0, 1, 0, -10, 0, 1); ok {
		t.Error("a circle behind the shooter is not hit")
	}
}

func TestHeadingTowards(t *testing.T) {
	cases := []struct {
		name                   string
		fromX, fromZ, toX, toZ float64
		want                   float64
	}{
		{"east", 0, 0, 10, 0, 0},
		{"north", 0, 0, 0, 10, 90},
		{"west", 0, 0, -10, 0, 180},
		{"south", 0, 0, 0, -10, 270},
	}
	for _, c := range cases {
		if got := headingTowards(c.fromX, c.fromZ, c.toX, c.toZ); got != c.want {
			t.Errorf("%s heading = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestNextCheckpointAfter(t *testing.T) {
	want := map[int]int{1: 2, 2: 3, 3: 4, 4: StartFinishIndex}
	for from, expected := range want {
		if got := nextCheckpointAfter(from); got != expected {
			t.Errorf("after C%d = C%d, want C%d", from, got, expected)
		}
	}
}
