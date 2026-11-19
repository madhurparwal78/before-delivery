package main

import "os"

// config holds every value read from the process environment at start.
type config struct {
	databaseURL  string
	valkeyURL    string
	smtpHost     string
	smtpPort     string
	mailFrom     string
	port         string
	clockControl bool
}

const defaultMailFrom = "Holdfast Nights <nights@cinderlatch.example>"

func loadConfig() config {
	return config{
		databaseURL:  os.Getenv("DATABASE_URL"),
		valkeyURL:    os.Getenv("VALKEY_URL"),
		smtpHost:     os.Getenv("SMTP_HOST"),
		smtpPort:     os.Getenv("SMTP_PORT"),
		mailFrom:     envOr("MAIL_FROM", defaultMailFrom),
		port:         envOr("APP_PUBLIC_PORT", "4173"),
		clockControl: os.Getenv("HOLDFAST_CLOCK_CONTROL") == "on",
	}
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
