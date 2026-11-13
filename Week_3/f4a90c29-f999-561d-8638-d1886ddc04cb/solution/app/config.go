package main

import (
	"log"
	"os"
	"strconv"
	"time"
)

// Config holds every setting the server reads from its environment at start.
type Config struct {
	Port           string
	DatabaseURL    string
	GotenbergURL   string
	S3Endpoint     string
	S3Region       string
	S3Bucket       string
	S3PathStyle    bool
	S3KeyID        string
	S3Secret       string
	TrashRetention time.Duration
	ShareLinkTTL   time.Duration
	ClockStart     time.Time
	ClockRate      float64
}

func loadConfig() Config {
	return Config{
		Port:           envOr("APP_PUBLIC_PORT", "4173"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		GotenbergURL:   os.Getenv("GOTENBERG_URL"),
		S3Endpoint:     os.Getenv("S3_ENDPOINT"),
		S3Region:       os.Getenv("S3_REGION"),
		S3Bucket:       os.Getenv("S3_BUCKET"),
		S3PathStyle:    os.Getenv("S3_FORCE_PATH_STYLE") != "false",
		S3KeyID:        os.Getenv("S3_ACCESS_KEY_ID"),
		S3Secret:       os.Getenv("S3_SECRET_ACCESS_KEY"),
		TrashRetention: seconds("TRASH_RETENTION_SECONDS", 2592000),
		ShareLinkTTL:   seconds("SHARE_LINK_TTL_SECONDS", 2592000),
		ClockStart:     instantEnv("CLOCK_START"),
		ClockRate:      floatEnv("CLOCK_RATE", 1),
	}
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func seconds(name string, fallback int) time.Duration {
	n := fallback
	if v := os.Getenv(name); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil || parsed <= 0 {
			log.Fatalf("%s must be a positive whole number of seconds", name)
		}
		n = parsed
	}
	return time.Duration(n) * time.Second
}

func floatEnv(name string, fallback float64) float64 {
	v := os.Getenv(name)
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(v, 64)
	if err != nil || parsed <= 0 {
		log.Fatalf("%s must be a positive number", name)
	}
	return parsed
}

func instantEnv(name string) time.Time {
	v := os.Getenv(name)
	if v == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		log.Fatalf("%s must be an RFC 3339 instant", name)
	}
	return t.UTC()
}
