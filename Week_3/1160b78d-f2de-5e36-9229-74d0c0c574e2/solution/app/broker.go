package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	confirmWait      = 5 * time.Second // the publisher confirm that makes an event accepted
	brokerRetryWait  = 3 * time.Second // between attempts to reach the broker
	brokerDialWait   = 3 * time.Second
	brokerHeartbeat  = 10 * time.Second
	consumerPrefetch = 64
	deadLetterHeader = "dead_letter_id"
)

var errBrokerDown = errors.New("the queue is unreachable")

// Broker is the RabbitMQ connection of this copy: the durable event and dead-letter queues, a publisher with
// confirms, and the consumer of the event queue. It reconnects by itself, so the app starts and recovers with the
// broker down.
type Broker struct {
	url        string
	events     string
	dead       string
	mu         sync.RWMutex
	publisher  *amqp.Channel
	removeLock sync.Mutex
}

func newBroker(cfg Config) *Broker {
	return &Broker{url: cfg.AMQPURL, events: cfg.queueName(), dead: cfg.deadQueueName()}
}

// Up reports whether events can be published right now.
func (b *Broker) Up() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.publisher != nil
}

func (b *Broker) setPublisher(ch *amqp.Channel) {
	b.mu.Lock()
	b.publisher = ch
	b.mu.Unlock()
}

func (b *Broker) channel() (*amqp.Channel, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.publisher == nil {
		return nil, errBrokerDown
	}
	return b.publisher, nil
}

// Run keeps a session open until ctx ends, handing every delivery of the event queue to handle on its own goroutine.
func (b *Broker) Run(ctx context.Context, handle func(context.Context, amqp.Delivery)) {
	for ctx.Err() == nil {
		if err := b.session(ctx, handle); err != nil && ctx.Err() == nil {
			log.Printf("queue: %v", err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(brokerRetryWait):
		}
	}
}

// connect opens a connection whose dial and handshake end with ctx or after the dial wait, whichever comes first.
func (b *Broker) connect(ctx context.Context) (*amqp.Connection, error) {
	openCtx, cancel := context.WithTimeout(ctx, brokerDialWait)
	defer cancel()
	var stopHandshakeWatch func() bool
	dial := func(network, addr string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(openCtx, network, addr)
		if err != nil {
			return nil, fmt.Errorf("dial %s: %w", addr, err)
		}
		stopHandshakeWatch = context.AfterFunc(openCtx, func() { _ = conn.Close() })
		return conn, nil
	}
	conn, err := amqp.DialConfig(b.url, amqp.Config{Heartbeat: brokerHeartbeat, Dial: dial})
	if stopHandshakeWatch != nil {
		stopHandshakeWatch()
	}
	if err != nil {
		return nil, fmt.Errorf("open the connection: %w", err)
	}
	return conn, nil
}

func (b *Broker) session(ctx context.Context, handle func(context.Context, amqp.Delivery)) error {
	conn, err := b.connect(ctx)
	if err != nil {
		return fmt.Errorf("connect to the broker: %w", err)
	}
	defer conn.Close()
	// amqp091 has no context on the channel calls below (open, declare, qos, confirm, get, ack, nack); closing the
	// connection when ctx ends is how the context reaches them.
	stopWatch := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stopWatch()
	connClosed := conn.NotifyClose(make(chan *amqp.Error, 1))

	pub, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open publish channel: %w", err)
	}
	pubClosed := pub.NotifyClose(make(chan *amqp.Error, 1))
	for _, name := range []string{b.events, b.dead} {
		if _, err := pub.QueueDeclare(name, true, false, false, false, nil); err != nil {
			return fmt.Errorf("declare queue %s: %w", name, err)
		}
	}
	if err := pub.Confirm(false); err != nil {
		return fmt.Errorf("enable publisher confirms: %w", err)
	}
	cons, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open consume channel: %w", err)
	}
	consClosed := cons.NotifyClose(make(chan *amqp.Error, 1))
	if err := cons.Qos(consumerPrefetch, 0, false); err != nil {
		return fmt.Errorf("set prefetch: %w", err)
	}
	deliveries, err := cons.ConsumeWithContext(ctx, b.events, "", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume %s: %w", b.events, err)
	}

	b.setPublisher(pub)
	defer b.setPublisher(nil)
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-connClosed:
			return errors.New("the connection closed")
		case <-pubClosed:
			return errors.New("the publish channel closed")
		case <-consClosed:
			return errors.New("the consume channel closed")
		case delivery, open := <-deliveries:
			if !open {
				return errors.New("the consumer was cancelled")
			}
			go handle(ctx, delivery)
		}
	}
}

// publish puts one persistent JSON message on a queue and returns once the broker confirmed it, or after the confirm wait.
func (b *Broker) publish(ctx context.Context, queue string, body []byte, headers amqp.Table) error {
	ch, err := b.channel()
	if err != nil {
		return fmt.Errorf("publish to %s: %w", queue, err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, confirmWait)
	defer cancel()
	pending, err := ch.PublishWithDeferredConfirmWithContext(waitCtx, "", queue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Headers:      headers,
		Body:         body,
	})
	if err != nil {
		return fmt.Errorf("publish to %s: %w", queue, err)
	}
	confirmed, err := pending.WaitContext(waitCtx)
	if err != nil {
		return fmt.Errorf("wait for the confirm from %s: %w", queue, err)
	}
	if !confirmed {
		return fmt.Errorf("the broker refused the message for %s", queue)
	}
	return nil
}

// PublishEvent puts an accepted event on the event queue.
func (b *Broker) PublishEvent(ctx context.Context, body []byte) error {
	if err := b.publish(ctx, b.events, body, nil); err != nil {
		return fmt.Errorf("publish event: %w", err)
	}
	return nil
}

// PublishDead puts a dead letter's original message on the dead-letter queue, tagged with the dead letter's id.
func (b *Broker) PublishDead(ctx context.Context, id string, raw []byte) error {
	if err := b.publish(ctx, b.dead, raw, amqp.Table{deadLetterHeader: id}); err != nil {
		return fmt.Errorf("publish dead letter: %w", err)
	}
	return nil
}

// RemoveDead takes the dead letter with this id off the dead-letter queue. Other messages go back where they were.
func (b *Broker) RemoveDead(ctx context.Context, id string) (err error) {
	b.removeLock.Lock()
	defer b.removeLock.Unlock()
	ch, err := b.channel()
	if err != nil {
		return fmt.Errorf("remove dead letter %s: %w", id, err)
	}
	var lastKept uint64 // delivery tags start at 1
	defer func() {
		if lastKept == 0 {
			return
		}
		if nackErr := ch.Nack(lastKept, true, true); nackErr != nil && err == nil {
			err = fmt.Errorf("return the other dead letters: %w", nackErr)
		}
	}()
	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("remove dead letter %s: %w", id, err)
		}
		delivery, found, err := ch.Get(b.dead, false)
		if err != nil {
			return fmt.Errorf("read %s: %w", b.dead, err)
		}
		if !found {
			return nil
		}
		if delivery.Headers[deadLetterHeader] == id {
			if err := delivery.Ack(false); err != nil {
				return fmt.Errorf("remove dead letter %s: %w", id, err)
			}
			return nil
		}
		lastKept = delivery.DeliveryTag
	}
}
