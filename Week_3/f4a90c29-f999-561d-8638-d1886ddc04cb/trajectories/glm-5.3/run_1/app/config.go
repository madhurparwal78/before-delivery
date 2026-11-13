package main

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Config is read once at start from the environment; no credential ever
// reaches the browser.
type Config struct {
	Port           int
	DatabaseURL    string
	GotenbergURL   string
	S3Endpoint     string
	S3Region       string
	S3Bucket       string
	S3ForcePath    bool
	S3AccessKeyID  string
	S3SecretKey    string
	TrashRetention time.Duration
	ShareLinkTTL   time.Duration
	ClockStart     time.Time
	ClockStartSet  bool
	ClockRate      float64
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func LoadConfig() *Config {
	c := &Config{
		DatabaseURL:   env("DATABASE_URL", ""),
		GotenbergURL:  env("GOTENBERG_URL", ""),
		S3Endpoint:    env("S3_ENDPOINT", ""),
		S3Region:      env("S3_REGION", "us-east-1"),
		S3Bucket:      env("S3_BUCKET", ""),
		S3ForcePath:   env("S3_FORCE_PATH_STYLE", "true") == "true",
		S3AccessKeyID: env("S3_ACCESS_KEY_ID", ""),
		S3SecretKey:   env("S3_SECRET_ACCESS_KEY", ""),
	}
	if n, err := strconv.Atoi(env("TRASH_RETENTION_SECONDS", "2592000")); err == nil && n > 0 {
		c.TrashRetention = time.Duration(n) * time.Second
	} else {
		c.TrashRetention = 2592000 * time.Second
	}
	if n, err := strconv.Atoi(env("SHARE_LINK_TTL_SECONDS", "2592000")); err == nil && n > 0 {
		c.ShareLinkTTL = time.Duration(n) * time.Second
	} else {
		c.ShareLinkTTL = 2592000 * time.Second
	}
	if v := env("CLOCK_START", ""); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			c.ClockStart = t
			c.ClockStartSet = true
		} else {
			log.Fatalf("CLOCK_START is not an RFC 3339 instant: %s", v)
		}
	}
	rate := 1.0
	if v := env("CLOCK_RATE", ""); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil || f > 0 {
			rate = f
		} else {
			log.Fatalf("CLOCK_RATE is not a number: %s", v)
		}
	}
	c.ClockRate = rate
	port := 4173
	if v := env("APP_PUBLIC_PORT", ""); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n < 65536 {
			port = n
		}
	}
	c.Port = port
	if c.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	return c
}

// ServerClock is the one clock behind /api/time, the now line, reminders,
// defaults and retention. When CLOCK_START is set it starts there and runs
// forward at CLOCK_RATE.
type ServerClock struct {
	mu    sync.Mutex
	start time.Time
	boot  time.Time
	rate  float64
}

func NewServerClock(cfg *Config) *ServerClock {
	now := time.Now().UTC()
	k := &ServerClock{boot: now, rate: cfg.ClockRate}
	if cfg.ClockStartSet {
		k.start = cfg.ClockStart.UTC()
	} else {
		k.start = now
	}
	return k
}

func (k *ServerClock) Now() time.Time {
	k.mu.Lock()
	defer k.mu.Unlock()
	elapsed := time.Since(k.boot).Seconds()
	adv := time.Duration(elapsed * k.rate * float64(time.Second))
	return k.start.Add(adv).UTC()
}

func (k *ServerClock) RFC3339() string {
	return k.Now().Format("2006-01-02T15:04:05Z07:00")
}

// Offset is what the app must add to a real instant to get the server instant.
func (k *ServerClock) Offset() time.Duration {
	k.mu.Lock()
	defer k.mu.Unlock()
	elapsed := time.Since(k.boot).Seconds()
	adv := time.Duration(elapsed * k.rate * float64(time.Second))
	return k.start.Add(adv).Sub(k.boot)
}

func (k *ServerClock) AdvanceServerTime(t time.Time) time.Duration {
	// duration from now (server) to t, used by reminder scheduling
	return t.Sub(k.Now())
}

func ParseOffsetMinutes(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if len(s) < 3 {
		return 0, false
	}
	sign := 1
	switch s[0] {
	case '+':
		s = s[1:]
	case '-':
		sign = -1
		s = s[1:]
	default:
		return 0, false
	}
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || m < 0 || m > 59 {
		return 0, false
	}
	if m%15 != 0 {
		return 0, false
	}
	total := h*60 + m
	if total < -12*60 || total > 14*60 {
		return 0, false
	}
	return sign * total, true
}

func FormatOffset(minutes int) string {
	sign := "+"
	if minutes < 0 {
		sign = "-"
		minutes = -minutes
	}
	return fmt.Sprintf("%s%02d:%02d", sign, minutes/60, minutes%60)
}
