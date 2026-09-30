package bots

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/charmbracelet/log"
	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/loops"
	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
)

type Service struct {
	Repo     Repository
	Store    Store
	Threads  Threads
	Routines Routines
	Events   Publisher
	Log      *log.Logger
	// Workspace is the root bot directories are shown relative to.
	Workspace string

	mu     sync.Mutex
	rounds map[string]*round
}

func NewService(repo Repository, store Store, threads Threads, routines Routines, events Publisher, workspace string, logger *log.Logger) *Service {
	return &Service{Repo: repo, Store: store, Threads: threads, Routines: routines, Events: events, Workspace: workspace, Log: logger.WithPrefix("bots")}
}

func (s *Service) List() ([]Bot, error) {
	records, err := s.Repo.ListBots()
	if err != nil {
		return nil, err
	}
	sessions, err := s.Store.ListSessions(storage.SessionFilter{SourceType: storage.SourceBot, IncludeSourced: true})
	if err != nil {
		return nil, err
	}
	routines, err := s.routineCounts()
	if err != nil {
		return nil, err
	}
	byThread := make(map[string]storage.BotRecord, len(records))
	for _, record := range records {
		byThread[record.ThreadID] = record
	}
	out := make([]Bot, 0, len(sessions))
	for _, session := range sessions {
		if record, ok := byThread[session.ID]; ok {
			out = append(out, s.view(record, session, routines[session.ID]))
		}
	}
	return out, nil
}

func (s *Service) Load(id string) (Bot, error) {
	record, session, err := s.load(id)
	if err != nil {
		return Bot{}, err
	}
	routines, err := s.routineCounts()
	if err != nil {
		return Bot{}, err
	}
	return s.view(record, session, routines[id]), nil
}

func (s *Service) Create(ctx context.Context, input CreateBot) (Bot, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Bot{}, errors.New("name is required")
	}
	avatar, err := normalizeAvatar(input.Avatar)
	if err != nil {
		return Bot{}, err
	}
	slug := slugify(name)
	directory := strings.TrimSpace(input.Directory)
	if directory == "" {
		directory = path.Join("bots", slug)
	}
	session, err := s.Threads.CreateSession(ctx, acp.SpawnRequest{
		ACPAgent:   strings.TrimSpace(input.Agent),
		Slug:       "bot-" + slug,
		Title:      name,
		Directory:  directory,
		Model:      strings.TrimSpace(input.Model),
		SourceType: storage.SourceBot,
	})
	if err != nil {
		return Bot{}, err
	}
	if err := s.Store.UpdateSessionTitle(session.ID, name); err != nil {
		return Bot{}, err
	}
	if err := s.Repo.SaveBot(storage.BotRecord{ThreadID: session.ID, Kind: KindBot, Shape: avatar.Shape, Color: avatar.Color}); err != nil {
		return Bot{}, err
	}
	return s.Load(session.ID)
}

func (s *Service) CreateGroup(name string, members []string) (Bot, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Bot{}, errors.New("name is required")
	}
	members, err := s.memberBots(members)
	if err != nil {
		return Bot{}, err
	}
	session, err := s.Store.CreateSession(storage.CreateSession{
		Slug:       "group-" + slugify(name),
		Title:      name,
		Runtime:    storage.RuntimeACP,
		SourceType: storage.SourceBot,
	})
	if err != nil {
		return Bot{}, err
	}
	if err := s.Store.UpdateSessionTitle(session.ID, name); err != nil {
		return Bot{}, err
	}
	avatar, _ := normalizeAvatar(nil)
	if err := s.Repo.SaveBot(storage.BotRecord{ThreadID: session.ID, Kind: KindGroup, Shape: avatar.Shape, Color: avatar.Color, Members: members}); err != nil {
		return Bot{}, err
	}
	return s.Load(session.ID)
}

func (s *Service) Update(id string, input UpdateBot) (Bot, error) {
	record, _, err := s.load(id)
	if err != nil {
		return Bot{}, err
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return Bot{}, errors.New("name is required")
		}
		if err := s.Store.UpdateSessionTitle(id, name); err != nil {
			return Bot{}, err
		}
	}
	if input.Avatar != nil {
		avatar, err := normalizeAvatar(input.Avatar)
		if err != nil {
			return Bot{}, err
		}
		record.Shape = avatar.Shape
		record.Color = avatar.Color
	}
	if input.Members != nil {
		if record.Kind != KindGroup {
			return Bot{}, errors.New("only a group has members")
		}
		if record.Members, err = s.memberBots(*input.Members); err != nil {
			return Bot{}, err
		}
	}
	if err := s.Repo.SaveBot(record); err != nil {
		return Bot{}, err
	}
	return s.Load(id)
}

// Delete archives the bot's thread, deletes the routines it owns and takes
// it out of its groups.
func (s *Service) Delete(id string) error {
	if _, _, err := s.load(id); err != nil {
		return err
	}
	records, err := s.Repo.ListBots()
	if err != nil {
		return err
	}
	for _, group := range records {
		if !slices.Contains(group.Members, id) {
			continue
		}
		group.Members = slices.DeleteFunc(group.Members, func(member string) bool { return member == id })
		if err := s.Repo.SaveBot(group); err != nil {
			return err
		}
	}
	routines, err := s.Routines.List()
	if err != nil {
		return err
	}
	for _, routine := range routines {
		if routine.BotID != id {
			continue
		}
		if err := s.Routines.Delete(routine.ID); err != nil {
			return err
		}
	}
	return s.Store.SetArchived(id, true)
}

// RoutineOwner keeps a routine created from a bot's thread with that bot and
// gives a routine created anywhere else a bot of its own.
func (s *Service) RoutineOwner(threadID string, in loops.CreateLoop) (string, error) {
	if record, err := s.Repo.LoadBot(threadID); err == nil && record.Kind == KindBot {
		return threadID, nil
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = "Routine bot"
	}
	bot, err := s.Create(context.Background(), CreateBot{Name: name, Agent: in.ACPAgent, Model: in.Model, Directory: in.Directory})
	return bot.ID, err
}

// AdoptLoops gives every loop without an owner a bot of its own, so all
// routines live with a bot.
func (s *Service) AdoptLoops(ctx context.Context) error {
	routines, err := s.Routines.List()
	if err != nil {
		return err
	}
	for _, routine := range routines {
		if routine.BotID != "" {
			continue
		}
		bot, err := s.Create(ctx, CreateBot{Name: routine.Name, Agent: routine.ACPAgent, Model: routine.Model, Directory: routine.Directory})
		if err != nil {
			return fmt.Errorf("adopt loop %s: %w", routine.ID, err)
		}
		if _, err := s.Routines.Update(routine.ID, loops.UpdateLoop{BotID: &bot.ID}); err != nil {
			return fmt.Errorf("adopt loop %s: %w", routine.ID, err)
		}
	}
	return nil
}

func (s *Service) load(id string) (storage.BotRecord, storage.Session, error) {
	record, err := s.Repo.LoadBot(id)
	if err != nil {
		return storage.BotRecord{}, storage.Session{}, err
	}
	session, err := s.Store.LoadSession(id)
	if err != nil {
		return storage.BotRecord{}, storage.Session{}, err
	}
	if session.Archived {
		return storage.BotRecord{}, storage.Session{}, storage.ErrBotNotFound
	}
	return record, session, nil
}

func (s *Service) view(record storage.BotRecord, session storage.Session, routines int) Bot {
	bot := Bot{
		ID:        session.ID,
		Kind:      record.Kind,
		Name:      session.Title,
		Avatar:    Avatar{Shape: record.Shape, Color: record.Color},
		Pinned:    session.Pinned,
		Unread:    session.Unread,
		Status:    session.Status,
		UpdatedAt: session.UpdatedAt,
		Members:   record.Members,
		Routines:  routines,
	}
	if record.Kind == KindGroup {
		bot.Preview = s.groupPreview(session.ID)
		return bot
	}
	bot.Model = session.Model
	if ref := session.RuntimeRef; ref != nil {
		bot.Agent = ref.Agent
		bot.Directory = ref.ProjectPath
		if rel, err := filepath.Rel(s.Workspace, ref.ProjectPath); err == nil && !strings.HasPrefix(rel, "..") {
			bot.Directory = rel
		}
	}
	bot.Preview = s.botPreview(session.ID)
	return bot
}

func (s *Service) botPreview(threadID string) string {
	events, err := s.Store.LoadLatestACPTurn(context.Background(), threadID)
	if err != nil {
		return ""
	}
	var text strings.Builder
	for _, event := range events {
		if event.Type == sessionevents.TypeACPMessage {
			text.WriteString(event.Content)
		}
	}
	return preview(text.String())
}

func (s *Service) groupPreview(threadID string) string {
	events, err := s.Store.LoadSessionEvents(threadID)
	if err != nil {
		return ""
	}
	for _, event := range slices.Backward(events) {
		if message := event.RoomMessage; message != nil {
			return preview(message.Name + ": " + message.Text)
		}
	}
	return ""
}

func (s *Service) routineCounts() (map[string]int, error) {
	routines, err := s.Routines.List()
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	for _, routine := range routines {
		counts[routine.BotID]++
	}
	return counts, nil
}

func (s *Service) memberBots(ids []string) ([]string, error) {
	members := make([]string, 0, len(ids))
	for _, id := range ids {
		record, err := s.Repo.LoadBot(id)
		if err != nil || record.Kind != KindBot {
			return nil, fmt.Errorf("member %s is not a bot", id)
		}
		if !slices.Contains(members, id) {
			members = append(members, id)
		}
	}
	if len(members) < 2 {
		return nil, errors.New("a group needs at least two bots")
	}
	return members, nil
}

func normalizeAvatar(avatar *Avatar) (Avatar, error) {
	if avatar == nil {
		return Avatar{Shape: Shapes[rand.IntN(len(Shapes))], Color: Colors[1+rand.IntN(len(Colors)-2)]}, nil
	}
	if !slices.Contains(Shapes, avatar.Shape) || !slices.Contains(Colors, avatar.Color) {
		return Avatar{}, fmt.Errorf("unsupported avatar %s/%s", avatar.Shape, avatar.Color)
	}
	return *avatar, nil
}

func preview(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if runes := []rune(text); len(runes) > 140 {
		return string(runes[:140]) + "…"
	}
	return text
}

func slugify(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(name) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
			dash = false
			continue
		}
		if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	slug := strings.TrimSuffix(b.String(), "-")
	if slug == "" {
		return "bot"
	}
	return slug
}
