// Package config reads every service address, credential and rehearsal
// setting from the environment at start.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port              string
	DatabaseURL       string
	GotenbergURL      string
	S3Endpoint        string
	S3Region          string
	S3Bucket          string
	S3ForcePathStyle  bool
	S3AccessKeyID     string
	S3SecretAccessKey string
	TrashRetention    time.Duration
	ShareLinkTTL      time.Duration
	ClockStart        time.Time
	ClockStartSet     bool
	ClockRate         float64
}

func Load() (Config, error) {
	c := Config{
		Port:              env("APP_PUBLIC_PORT", "4173"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		GotenbergURL:      os.Getenv("GOTENBERG_URL"),
		S3Endpoint:        os.Getenv("S3_ENDPOINT"),
		S3Region:          env("S3_REGION", "us-east-1"),
		S3Bucket:          os.Getenv("S3_BUCKET"),
		S3AccessKeyID:     os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretAccessKey: os.Getenv("S3_SECRET_ACCESS_KEY"),
		S3ForcePathStyle:  env("S3_FORCE_PATH_STYLE", "true") == "true",
		ClockRate:         1,
	}
	secs, err := envSeconds("TRASH_RETENTION_SECONDS", 2592000)
	if err != nil {
		return c, err
	}
	c.TrashRetention = secs
	secs, err = envSeconds("SHARE_LINK_TTL_SECONDS", 2592000)
	if err != nil {
		return c, err
	}
	c.ShareLinkTTL = secs
	if v := os.Getenv("CLOCK_START"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return c, fmt.Errorf("CLOCK_START: %w", err)
		}
		c.ClockStart = t
		c.ClockStartSet = true
	}
	if v := os.Getenv("CLOCK_RATE"); v != "" {
		r, err := strconv.ParseFloat(v, 64)
		if err != nil || r <= 0 {
			return c, fmt.Errorf("CLOCK_RATE: want a positive number, got %q", v)
		}
		c.ClockRate = r
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	return c, nil
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func envSeconds(name string, fallback int64) (time.Duration, error) {
	v := os.Getenv(name)
	if v == "" {
		return time.Duration(fallback) * time.Second, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s: want whole seconds, got %q", name, v)
	}
	return time.Duration(n) * time.Second, nil
}
