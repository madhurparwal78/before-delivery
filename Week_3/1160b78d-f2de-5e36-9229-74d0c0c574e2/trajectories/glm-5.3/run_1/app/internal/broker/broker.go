// Package broker publishes and consumes monitoring events over RabbitMQ.
package broker

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Broker keeps a connection with one publisher channel that waits for confirms.
type Broker struct {
	url       string
	queues    string
	deadQueue string

	mu             sync.Mutex
	conn           *amqp.Connection
	pubCh          *amqp.Channel
	notifyConnClose chan *amqp.Error

	consumeMu sync.Mutex
	consumers map[string]func([]byte)
}

// New prepares a broker for one instance.
func New(url, instance string) *Broker {
	return &Broker{
		url:       url,
		queues:    "switchlamp." + instance + ".events",
		deadQueue: "switchlamp." + instance + ".events.dead",
		consumers: map[string]func([]byte){},
	}
}

var ErrDown = errors.New("broker unavailable")

// Connect opens the connection and declares the durable queues.
func (b *Broker) Connect() error {
	conn, err := amqp.Dial(b.url)
	if err != nil {
		return err
	}
	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return err
	}
	if _, err := ch.QueueDeclare(b.queues, true, false, false, false, nil); err != nil {
		conn.Close()
		return fmt.Errorf("declaring events queue: %w", err)
	}
	if _, err := ch.QueueDeclare(b.deadQueue, true, false, false, false, nil); err != nil {
		conn.Close()
		return fmt.Errorf("declaring dead-letter queue: %w", err)
	}
	if err := ch.Confirm(false); err != nil {
		conn.Close()
		return fmt.Errorf("enabling confirms: %w", err)
	}
	b.mu.Lock()
	old := b.conn
	oldNotify := b.notifyConnClose
	b.conn = conn
	b.pubCh = ch
	b.notifyConnClose = conn.NotifyClose(make(chan *amqp.Error, 1))
	notify := b.notifyConnClose
	b.mu.Unlock()
	if old != nil {
		old.Close()
	}
	// Drain the old channel so a stale close does not wake the new watcher.
	if oldNotify != nil {
		go func() {
			for range oldNotify {
			}
		}()
	}
	go b.watch(notify)
	return nil
}

// watch reconnects on connection loss and resumes the events consumer.
func (b *Broker) watch(notify chan *amqp.Error) {
	_, ok := <-notify
	if !ok {
		return
	}
	b.mu.Lock()
	b.conn = nil
	b.pubCh = nil
	b.mu.Unlock()
	for {
		if b.Connect() == nil {
			break
		}
		time.Sleep(5 * time.Second)
	}
	b.consumeMu.Lock()
	fn := b.consumers["events"]
	b.consumeMu.Unlock()
	if fn != nil {
		fn(nil)
	}
}

// Up reports whether the broker currently answers.
func (b *Broker) Up() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.conn != nil && !b.conn.IsClosed()
}

// PublishConfirm publishes a persistent message and waits up to 5 real seconds
// for the broker's confirm. The confirm is what makes an event accepted.
func (b *Broker) PublishConfirm(ctx context.Context, body []byte) error {
	b.mu.Lock()
	ch := b.pubCh
	b.mu.Unlock()
	if ch == nil {
		return ErrDown
	}
	confirm, err := ch.PublishWithDeferredConfirm("", b.queues, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	})
	if err != nil {
		b.dropConn()
		return ErrDown
	}
	select {
	case <-ctx.Done():
		return ErrDown
	case <-confirm.Done():
		if confirm.Acked() {
			return nil
		}
		return ErrDown
	case <-time.After(5 * time.Second):
		return ErrDown
	}
}

// PublishDead places a dead letter on the durable dead-letter queue.
func (b *Broker) PublishDead(ctx context.Context, body []byte) error {
	b.mu.Lock()
	ch := b.pubCh
	b.mu.Unlock()
	if ch == nil {
		return ErrDown
	}
	confirm, err := ch.PublishWithDeferredConfirm("", b.deadQueue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	})
	if err != nil {
		b.dropConn()
		return ErrDown
	}
	select {
	case <-ctx.Done():
		return ErrDown
	case <-confirm.Done():
		if confirm.Acked() {
			return nil
		}
		return ErrDown
	case <-time.After(3 * time.Second):
		return ErrDown
	}
}

func (b *Broker) dropConn() {
	b.mu.Lock()
	if b.conn != nil {
		b.conn.Close()
	}
	b.conn = nil
	b.pubCh = nil
	b.mu.Unlock()
}

// ConsumeEvents registers the handler for the events queue. Calling it with a
// nil body makes the consumer resubscribe after a reconnection.
func (b *Broker) ConsumeEvents(ctx context.Context, handle func(body []byte)) {
	b.consumeMu.Lock()
	b.consumers["events"] = handle
	b.consumeMu.Unlock()
	b.runConsume(ctx, b.queues, handle)
}

// ConsumeDead registers the handler that stores dead letters.
func (b *Broker) ConsumeDead(ctx context.Context, handle func([]byte)) {
	b.runConsume(ctx, b.deadQueue, handle)
}

func (b *Broker) runConsume(ctx context.Context, queue string, handle func([]byte)) {
	go func() {
		for {
			if ctx.Err() != nil {
				return
			}
			b.mu.Lock()
			conn := b.conn
			b.mu.Unlock()
			if conn == nil || conn.IsClosed() {
				select {
				case <-ctx.Done():
					return
				case <-time.After(2 * time.Second):
				}
				continue
			}
			ch, err := conn.Channel()
			if err != nil {
				select {
				case <-ctx.Done():
					return
				case <-time.After(2 * time.Second):
				}
				continue
			}
			if err := ch.Qos(1, 0, false); err != nil {
				ch.Close()
				continue
			}
			deliveries, err := ch.Consume(queue, "", false, false, false, false, nil)
			if err != nil {
				ch.Close()
				continue
			}
			closed := ch.NotifyClose(make(chan *amqp.Error, 1))
		loop:
			for {
				select {
				case <-ctx.Done():
					ch.Close()
					return
				case <-closed:
					break loop
				case d, ok := <-deliveries:
					if !ok {
						break loop
					}
					handle(d.Body)
					d.Ack(false)
				}
			}
			ch.Close()
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
		}
	}()
}
