package core

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// broker carries monitoring events on a durable queue. A publisher confirm is
// what makes an event accepted.
type broker struct {
	url   string
	queue string
	dead  string

	mu      sync.Mutex
	conn    *amqp.Connection
	pubChan *amqp.Channel

	handler func(ctx context.Context, body []byte)
}

var errQueueUnavailable = errors.New("queue unavailable")

func newBroker(url, instance string) *broker {
	return &broker{
		url:   url,
		queue: "switchlamp." + instance + ".events",
		dead:  "switchlamp." + instance + ".events.dead",
	}
}

func (b *broker) run(ctx context.Context, a *App) {
	for {
		if err := b.connect(ctx, a); err != nil {
			a.queueUp.Store(false)
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
				continue
			}
		}
		a.queueUp.Store(true)
		closed := make(chan *amqp.Error, 1)
		b.mu.Lock()
		conn := b.conn
		b.mu.Unlock()
		conn.NotifyClose(closed)
		select {
		case <-ctx.Done():
			_ = conn.Close()
			return
		case <-closed:
			a.queueUp.Store(false)
		}
	}
}

func (b *broker) connect(ctx context.Context, a *App) error {
	conn, err := amqp.DialConfig(b.url, amqp.Config{Dial: amqp.DefaultDial(3 * time.Second)})
	if err != nil {
		return fmt.Errorf("dial broker: %w", err)
	}
	pub, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("open publish channel: %w", err)
	}
	if err := pub.Confirm(false); err != nil {
		_ = conn.Close()
		return fmt.Errorf("confirm mode: %w", err)
	}
	for _, q := range []string{b.queue, b.dead} {
		if _, err := pub.QueueDeclare(q, true, false, false, false, nil); err != nil {
			_ = conn.Close()
			return fmt.Errorf("declare %s: %w", q, err)
		}
	}
	b.mu.Lock()
	b.conn = conn
	b.pubChan = pub
	handler := b.handler
	b.mu.Unlock()

	if handler != nil {
		consumeChan, err := conn.Channel()
		if err != nil {
			_ = conn.Close()
			return fmt.Errorf("open consume channel: %w", err)
		}
		if err := consumeChan.Qos(8, 0, false); err != nil {
			_ = conn.Close()
			return fmt.Errorf("qos: %w", err)
		}
		deliveries, err := consumeChan.Consume(b.queue, "", false, false, false, false, nil)
		if err != nil {
			_ = conn.Close()
			return fmt.Errorf("consume: %w", err)
		}
		go func() {
			for d := range deliveries {
				handler(ctx, d.Body)
				if err := d.Ack(false); err != nil {
					log.Printf("ack event: %v", err)
				}
			}
		}()
	}
	return nil
}

// publish holds an event on the durable queue and waits for the broker to
// confirm it. Without a confirm inside five real seconds the event is refused.
func (b *broker) publish(ctx context.Context, body []byte) error {
	b.mu.Lock()
	ch := b.pubChan
	b.mu.Unlock()
	if ch == nil {
		return errQueueUnavailable
	}
	wait, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conf, err := ch.PublishWithDeferredConfirmWithContext(wait, "", b.queue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	})
	if err != nil {
		return errQueueUnavailable
	}
	ok, err := conf.WaitContext(wait)
	if err != nil || !ok {
		return errQueueUnavailable
	}
	return nil
}

func (b *broker) publishDead(ctx context.Context, body []byte) error {
	b.mu.Lock()
	ch := b.pubChan
	b.mu.Unlock()
	if ch == nil {
		return errQueueUnavailable
	}
	wait, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conf, err := ch.PublishWithDeferredConfirmWithContext(wait, "", b.dead, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	})
	if err != nil {
		return fmt.Errorf("publish dead letter: %w", err)
	}
	if _, err := conf.WaitContext(wait); err != nil {
		return fmt.Errorf("confirm dead letter: %w", err)
	}
	return nil
}

// removeDead takes one message off the dead-letter queue, leaving the rest.
func (b *broker) removeDead(eventID string) error {
	b.mu.Lock()
	conn := b.conn
	b.mu.Unlock()
	if conn == nil {
		return errQueueUnavailable
	}
	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open dead channel: %w", err)
	}
	defer func() { _ = ch.Close() }()
	var held []amqp.Delivery
	for i := 0; i < 500; i++ {
		msg, ok, err := ch.Get(b.dead, false)
		if err != nil {
			return fmt.Errorf("get dead letter: %w", err)
		}
		if !ok {
			break
		}
		if deadLetterEventID(msg.Body) == eventID {
			if err := msg.Ack(false); err != nil {
				return fmt.Errorf("ack dead letter: %w", err)
			}
			break
		}
		held = append(held, msg)
	}
	for _, msg := range held {
		if err := msg.Nack(false, true); err != nil {
			return fmt.Errorf("requeue dead letter: %w", err)
		}
	}
	return nil
}
