package main

import (
	"context"
	"log"
	"sync"
	"time"
)

const persistAttempts = 120

// persister writes match results, laps and ledger entries to Postgres in order, retrying
// through an outage so a match that ends while storage is down is still stored.
type persister struct {
	mu    sync.Mutex
	wake  *sync.Cond
	queue []func(ctx context.Context) error
}

func newPersister() *persister {
	p := &persister{}
	p.wake = sync.NewCond(&p.mu)
	return p
}

func (p *persister) add(job func(ctx context.Context) error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.queue = append(p.queue, job)
	p.wake.Signal()
}

func (p *persister) next(ctx context.Context) func(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	for len(p.queue) == 0 {
		if ctx.Err() != nil {
			return nil
		}
		p.wake.Wait()
	}
	job := p.queue[0]
	p.queue = p.queue[1:]
	return job
}

func (p *persister) run(ctx context.Context) {
	go func() {
		<-ctx.Done()
		p.wake.Broadcast()
	}()
	for ctx.Err() == nil {
		job := p.next(ctx)
		if job == nil {
			return
		}
		for attempt := 1; ctx.Err() == nil; attempt++ {
			jobCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := job(jobCtx)
			cancel()
			if err == nil {
				break
			}
			if attempt >= persistAttempts {
				log.Printf("persist: giving up: %v", err)
				break
			}
			time.Sleep(time.Second)
		}
	}
}
