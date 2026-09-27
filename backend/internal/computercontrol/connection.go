package computercontrol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type desktopConn struct {
	ws      *websocket.Conn
	writeMu sync.Mutex
	mu      sync.Mutex
	nextID  int64
	pending map[int64]chan rpcReply
	done    chan struct{}
	err     error
}

type rpcMessage struct {
	ID     int64           `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params any             `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcReply struct {
	message rpcMessage
	err     error
}

func newDesktopConn(ws *websocket.Conn) *desktopConn {
	ws.SetReadLimit(computerWireReadLimit)
	connection := &desktopConn{
		ws:      ws,
		pending: map[int64]chan rpcReply{},
		done:    make(chan struct{}),
	}
	go connection.readLoop()
	return connection
}

func (c *desktopConn) Done() <-chan struct{} {
	return c.done
}

func (c *desktopConn) Call(ctx context.Context, method string, params any, output any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	id, reply, err := c.reserve()
	if err != nil {
		return err
	}
	if err := c.write(ctx, rpcMessage{ID: id, Method: method, Params: params}); err != nil {
		c.drop(id)
		return err
	}
	select {
	case result := <-reply:
		if result.err != nil {
			return result.err
		}
		if result.message.Error != nil {
			return fmt.Errorf("computer %s failed: %s", method, limitText(result.message.Error.Message, textLimit))
		}
		if output != nil && len(result.message.Result) > 0 {
			return json.Unmarshal(result.message.Result, output)
		}
		return nil
	case <-ctx.Done():
		c.drop(id)
		_ = c.write(context.Background(), rpcMessage{Method: "Jaz.cancel", Params: map[string]any{"id": id}})
		return ctx.Err()
	}
}

func (c *desktopConn) reserve() (int64, chan rpcReply, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err != nil {
		return 0, nil, c.err
	}
	c.nextID++
	reply := make(chan rpcReply, 1)
	c.pending[c.nextID] = reply
	return c.nextID, reply, nil
}

func (c *desktopConn) drop(id int64) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
}

func (c *desktopConn) write(ctx context.Context, message rpcMessage) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := c.ws.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	return c.ws.WriteJSON(message)
}

func (c *desktopConn) readLoop() {
	for {
		var message rpcMessage
		if err := c.ws.ReadJSON(&message); err != nil {
			c.fail(err)
			return
		}
		if message.ID == 0 {
			continue
		}
		c.mu.Lock()
		reply := c.pending[message.ID]
		delete(c.pending, message.ID)
		c.mu.Unlock()
		if reply != nil {
			reply <- rpcReply{message: message}
		}
	}
}

func (c *desktopConn) fail(err error) {
	c.mu.Lock()
	if c.err != nil {
		c.mu.Unlock()
		return
	}
	c.err = err
	close(c.done)
	pending := c.pending
	c.pending = map[int64]chan rpcReply{}
	c.mu.Unlock()
	for _, reply := range pending {
		reply <- rpcReply{err: err}
	}
}

func (c *desktopConn) Close() {
	c.fail(errors.New("computer connection is closed"))
	_ = c.ws.Close()
}
