package main

import (
	"log"
)

// main.go — the run manifest's serve command starts here.
func main() {
	cfg := LoadConfig()
	app := NewApp(cfg)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	if err := app.Run(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
