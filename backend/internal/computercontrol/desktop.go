package computercontrol

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type DesktopBackend struct {
	mu          sync.Mutex
	connections map[string]*desktopConn
}

func NewDesktopBackend() *DesktopBackend {
	return &DesktopBackend{connections: map[string]*desktopConn{}}
}

func (b *DesktopBackend) Connect(ctx context.Context, session string, ws *websocket.Conn) {
	connection := newDesktopConn(ws)
	b.mu.Lock()
	if b.connections[session] != nil {
		b.mu.Unlock()
		connection.Close()
		return
	}
	b.connections[session] = connection
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		if b.connections[session] == connection {
			delete(b.connections, session)
		}
		b.mu.Unlock()
		connection.Close()
	}()
	select {
	case <-ctx.Done():
	case <-connection.Done():
	}
}

func (b *DesktopBackend) Call(ctx context.Context, input ActionInput) (ActionOutput, error) {
	input, err := normalizeInput(input)
	if err != nil {
		return ActionOutput{}, err
	}
	b.mu.Lock()
	connection := b.connections[input.Session]
	b.mu.Unlock()
	if connection == nil {
		if input.Action == ActionStatus {
			return ActionOutput{Status: "disconnected", Text: "Computer use is disconnected. Open this conversation in the Jaz desktop app."}, nil
		}
		return ActionOutput{}, errors.New("open this conversation in the Jaz desktop app to connect computer use")
	}
	callCtx, cancel := context.WithTimeout(ctx, 70*time.Second)
	defer cancel()
	var output wireOutput
	method := "Jaz.status"
	params := any(nil)
	if input.Action == ActionScript {
		method = "Jaz.run"
		params = map[string]any{"code": input.Code}
	}
	if err := connection.Call(callCtx, method, params, &output); err != nil {
		return ActionOutput{}, err
	}
	return decodeOutput(output)
}

func (b *DesktopBackend) Close() error {
	b.mu.Lock()
	connections := b.connections
	b.connections = map[string]*desktopConn{}
	b.mu.Unlock()
	for _, connection := range connections {
		connection.Close()
	}
	return nil
}
