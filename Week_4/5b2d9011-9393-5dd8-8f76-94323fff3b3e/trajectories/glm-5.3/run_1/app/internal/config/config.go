// Package config reads every service URL and credential from the environment
// at start.
package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds every runtime setting, read once at start.
type Config struct {
	DatabaseURL   string
	ValkeyURL     string
	SMTPHost      string
	SMTPPort      int
	MailFrom      string
	PublicPort    string
	ClockControl  bool
	Build         string
	EmbedDir      string
}

const defaultMailFrom = "Holdfast Nights <nights@cinderlatch.example>"

// Load reads the environment. It errors only on a malformed SMTP_PORT.
func Load() (Config, error) {
	cfg := Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		ValkeyURL:   os.Getenv("VALKEY_URL"),
		SMTPHost:    os.Getenv("SMTP_HOST"),
		MailFrom:    os.Getenv("MAIL_FROM"),
		PublicPort:  os.Getenv("APP_PUBLIC_PORT"),
		Build:       os.Getenv("HOLDFAST_BUILD"),
		EmbedDir:    os.Getenv("HOLDFAST_WEB_DIR"),
	}
	if cfg.SMTPHost == "" {
		cfg.SMTPHost = "mailpit"
	}
	if cfg.MailFrom == "" {
		cfg.MailFrom = defaultMailFrom
	}
	if cfg.PublicPort == "" {
		cfg.PublicPort = "4173"
	}
	if cfg.EmbedDir == "" {
		cfg.EmbedDir = "frontend/dist"
	}
	if cfg.Build == "" {
		cfg.Build = "dev"
	}
	cfg.ClockControl = os.Getenv("HOLDFAST_CLOCK_CONTROL") == "on"

	portStr := os.Getenv("SMTP_PORT")
	if portStr == "" {
		portStr = "1025"
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return cfg, fmt.Errorf("SMTP_PORT: %w", err)
	}
	cfg.SMTPPort = port
	return cfg, nil
}
