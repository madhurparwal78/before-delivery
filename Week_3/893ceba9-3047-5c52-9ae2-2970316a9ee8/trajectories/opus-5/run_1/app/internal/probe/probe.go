// Package probe reports whether the repository host, the AI engine and the
// webhook service are answering, caching each answer for at most 15 seconds.
package probe

import (
	"context"
	"sync"
	"time"
)

type Status struct {
	GitHost  string `json:"git_host"`
	AIEngine string `json:"ai_engine"`
	Webhooks string `json:"webhooks"`
}

type check struct {
	call    func(context.Context) error
	mu      sync.Mutex
	state   string
	checked time.Time
}

type Prober struct {
	gitHost  *check
	aiEngine *check
	webhooks *check
}

const cacheFor = 15 * time.Second

func New(gitHost, aiEngine, webhooks func(context.Context) error) *Prober {
	return &Prober{
		gitHost:  &check{call: gitHost},
		aiEngine: &check{call: aiEngine},
		webhooks: &check{call: webhooks},
	}
}

func (p *Prober) Status(ctx context.Context) Status {
	return Status{
		GitHost:  p.gitHost.read(ctx),
		AIEngine: p.aiEngine.read(ctx),
		Webhooks: p.webhooks.read(ctx),
	}
}

// Invalidate drops a cached answer so the next read probes again.
func (p *Prober) Invalidate() {
	for _, c := range []*check{p.gitHost, p.aiEngine, p.webhooks} {
		c.mu.Lock()
		c.checked = time.Time{}
		c.mu.Unlock()
	}
}

func (c *check) read(ctx context.Context) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.checked) < cacheFor && c.state != "" {
		return c.state
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := c.call(probeCtx); err != nil {
		c.state = "down"
	} else {
		c.state = "up"
	}
	c.checked = time.Now()
	return c.state
}
