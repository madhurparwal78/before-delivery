// Package config reads every service URL and credential from the environment.
package config

import (
	"os"
	"strconv"
	"strings"
)

const defaultMailFrom = "Holdfast Nights <nights@cinderlatch.example>"

// Config holds the process configuration. Nothing here is ever sent to the browser.
type Config struct {
	DatabaseURL  string
	ValkeyURL    string
	SMTPHost     string
	SMTPPort     int
	MailFrom     string
	Port         int
	ClockControl bool
	Build        string
}

// Load reads the environment once at start.
func Load() Config {
	cfg := Config{
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		ValkeyURL:    os.Getenv("VALKEY_URL"),
		SMTPHost:     os.Getenv("SMTP_HOST"),
		SMTPPort:     intEnv("SMTP_PORT", 1025),
		MailFrom:     os.Getenv("MAIL_FROM"),
		Port:         intEnv("APP_PUBLIC_PORT", 4173),
		ClockControl: strings.EqualFold(os.Getenv("HOLDFAST_CLOCK_CONTROL"), "on"),
		Build:        buildStamp(),
	}
	if strings.TrimSpace(cfg.MailFrom) == "" {
		cfg.MailFrom = defaultMailFrom
	}
	return cfg
}

func intEnv(name string, fallback int) int {
	if v, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name))); err == nil && v > 0 {
		return v
	}
	return fallback
}

func buildStamp() string {
	if v := strings.TrimSpace(os.Getenv("HOLDFAST_BUILD")); v != "" {
		return v
	}
	return "holdfast-1"
}
