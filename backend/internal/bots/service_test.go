package bots

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/loops"
	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
)

type fakeWorld struct {
	mu        sync.Mutex
	records   map[string]storage.BotRecord
	sessions  map[string]storage.Session
	events    map[string][]sessionevents.Event
	prompts   map[string][]string
	replies   map[string][]string
	created   []acp.SpawnRequest
	loops     []loops.Loop
	published []sessionevents.Event
	service   *Service
}

func newFakeWorld() *fakeWorld {
	return &fakeWorld{
		records:  map[string]storage.BotRecord{},
		sessions: map[string]storage.Session{},
		events:   map[string][]sessionevents.Event{},
		prompts:  map[string][]string{},
		replies:  map[string][]string{},
	}
}

func (w *fakeWorld) SaveBot(record storage.BotRecord) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.records[record.ThreadID] = record
	return nil
}

func (w *fakeWorld) LoadBot(id string) (storage.BotRecord, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	record, ok := w.records[id]
	if !ok {
		return storage.BotRecord{}, storage.ErrBotNotFound
	}
	return record, nil
}

func (w *fakeWorld) ListBots() ([]storage.BotRecord, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]storage.BotRecord, 0, len(w.records))
	for _, record := range w.records {
		out = append(out, record)
	}
	return out, nil
}

func (w *fakeWorld) CreateSession(input storage.CreateSession) (storage.Session, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	session := storage.Session{ID: "thread-" + input.Slug, Title: input.Title, SourceType: input.SourceType}
	w.sessions[session.ID] = session
	return session, nil
}

func (w *fakeWorld) LoadSession(id string) (storage.Session, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	session, ok := w.sessions[id]
	if !ok {
		return storage.Session{}, storage.ErrBotNotFound
	}
	return session, nil
}

func (w *fakeWorld) ListSessions(storage.SessionFilter) ([]storage.Session, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]storage.Session, 0, len(w.sessions))
	for _, session := range w.sessions {
		out = append(out, session)
	}
	return out, nil
}

func (w *fakeWorld) UpdateSessionTitle(id, title string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	session := w.sessions[id]
	session.Title = title
	w.sessions[id] = session
	return nil
}

func (w *fakeWorld) SetArchived(id string, archived bool) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	session := w.sessions[id]
	session.Archived = archived
	w.sessions[id] = session
	return nil
}

func (w *fakeWorld) LoadSessionEvents(id string) ([]sessionevents.Event, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]sessionevents.Event(nil), w.events[id]...), nil
}

func (w *fakeWorld) AppendSessionEvents(id string, events ...sessionevents.Event) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	for i := range events {
		events[i].Seq = int64(len(w.events[id]) + 1)
		w.events[id] = append(w.events[id], events[i])
	}
	return nil
}

func (w *fakeWorld) LoadLatestSessionEvent(id, eventType string) (sessionevents.Event, bool, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for i := len(w.events[id]) - 1; i >= 0; i-- {
		if w.events[id][i].Type == eventType {
			return w.events[id][i], true, nil
		}
	}
	return sessionevents.Event{}, false, nil
}

func (w *fakeWorld) Publish(event sessionevents.Event) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.published = append(w.published, event)
}

func (w *fakeWorld) List() ([]loops.Loop, error) {
	return w.loops, nil
}

func (w *fakeWorld) Update(id string, input loops.UpdateLoop) (loops.Loop, error) {
	for i := range w.loops {
		if w.loops[i].ID == id && input.BotID != nil {
			w.loops[i].BotID = *input.BotID
			return w.loops[i], nil
		}
	}
	return loops.Loop{}, nil
}

func (w *fakeWorld) Delete(string) error {
	return nil
}

func (w *fakeWorld) OnBoard(loop loops.Loop) bool {
	return strings.HasPrefix(loop.ID, "widget-")
}

type fakeThreads struct {
	world *fakeWorld
}

func (t fakeThreads) CreateSession(_ context.Context, req acp.SpawnRequest) (storage.Session, error) {
	t.world.mu.Lock()
	t.world.created = append(t.world.created, req)
	t.world.mu.Unlock()
	return t.world.CreateSession(storage.CreateSession{Slug: req.Slug, Title: req.Title, SourceType: req.SourceType})
}

func (t fakeThreads) StartInternalTurnWhenIdle(_ context.Context, req acp.InternalTurnRequest) (acp.Job, error) {
	t.world.mu.Lock()
	defer t.world.mu.Unlock()
	t.world.prompts[req.Session] = append(t.world.prompts[req.Session], req.Message)
	return acp.Job{ID: req.Session}, nil
}

// Wait runs the turn: the bot sends its scripted message, if any, the way it
// would call send_message.
func (t fakeThreads) Wait(_ context.Context, req acp.WaitRequest) (acp.Job, error) {
	t.world.mu.Lock()
	reply := ""
	if queue := t.world.replies[req.Session]; len(queue) > 0 {
		reply = queue[0]
		t.world.replies[req.Session] = queue[1:]
	}
	t.world.mu.Unlock()
	if reply != "" {
		if err := t.world.service.Say(req.Session, reply); err != nil {
			return acp.Job{}, err
		}
	}
	return acp.Job{ID: req.Session, State: acp.StateIdle, Assistant: "private notes"}, nil
}

func (fakeThreads) SwitchAgent(context.Context, string, string) error {
	return nil
}

func newTestService(world *fakeWorld) *Service {
	world.service = NewService(world, fakeThreads{world: world}, world, world, log.New(nil))
	return world.service
}

func (w *fakeWorld) addBot(id, name string) {
	w.sessions[id] = storage.Session{ID: id, Title: name}
	w.records[id] = storage.BotRecord{ThreadID: id, Kind: KindBot}
}

func (w *fakeWorld) roomMessages(id string) []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []string
	for _, event := range w.events[id] {
		if event.RoomMessage != nil {
			out = append(out, event.RoomMessage.Name+": "+event.RoomMessage.Text)
		}
	}
	return out
}

func (w *fakeWorld) promptCount(id string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.prompts[id])
}

func waitUntil(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !check() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestRoutineOwnerChecksNamedBotsKeepsBotThreadAndGivesOtherThreadsANewBot(t *testing.T) {
	world := newFakeWorld()
	world.addBot("gimli", "Gimli")
	service := newTestService(world)

	owner, err := service.RoutineOwner("gimli", loops.CreateLoop{Name: "Digest"})
	if err != nil || owner != "gimli" {
		t.Fatalf("owner from a bot thread = %q, %v", owner, err)
	}
	owner, err = service.RoutineOwner("chat-thread", loops.CreateLoop{Name: "Morning triage", ACPAgent: "claude"})
	if err != nil {
		t.Fatal(err)
	}
	record, err := world.LoadBot(owner)
	if err != nil || record.Kind != KindBot {
		t.Fatalf("new owner record = %+v, %v", record, err)
	}
	if len(world.created) != 1 || world.created[0].SourceType != storage.SourceBot || world.created[0].ACPAgent != "claude" || world.created[0].Title != "Morning triage" {
		t.Fatalf("created threads = %+v", world.created)
	}
	if owner, err := service.RoutineOwner("chat-thread", loops.CreateLoop{BotID: "gimli"}); err != nil || owner != "gimli" {
		t.Fatalf("named owner = %q, %v", owner, err)
	}
	world.sessions["crew"] = storage.Session{ID: "crew", Title: "Crew"}
	world.records["crew"] = storage.BotRecord{ThreadID: "crew", Kind: KindGroup}
	for _, named := range []string{"crew", "missing"} {
		if _, err := service.RoutineOwner("gimli", loops.CreateLoop{BotID: named}); err == nil {
			t.Fatalf("routine was given to %q, which is not a bot", named)
		}
	}
}

func TestGroupRoundPostsWhatMembersSendAndStopsOnSilence(t *testing.T) {
	world := newFakeWorld()
	world.addBot("a", "Research")
	world.addBot("b", "Marketing")
	service := newTestService(world)
	group, err := service.CreateGroup("Launch", []string{"a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	world.replies["a"] = []string{"", ""}
	world.replies["b"] = []string{"Draft is in the doc.", ""}

	if err := service.Post(group.ID, "Where is the launch draft?"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return world.promptCount("a") == 2 && world.promptCount("b") == 2 })
	time.Sleep(20 * time.Millisecond)

	got := strings.Join(world.roomMessages(group.ID), "\n")
	if got != "You: Where is the launch draft?\nMarketing: Draft is in the doc." {
		t.Fatalf("room = %q", got)
	}
	world.mu.Lock()
	secondPrompt := world.prompts["a"][1]
	world.mu.Unlock()
	if !strings.Contains(secondPrompt, "Marketing: Draft is in the doc.") {
		t.Fatalf("second round prompt misses what was said since:\n%s", secondPrompt)
	}
}

func TestGroupMentionPicksResponders(t *testing.T) {
	world := newFakeWorld()
	world.addBot("a", "Research")
	world.addBot("b", "Marketing")
	service := newTestService(world)
	group, err := service.CreateGroup("Launch", []string{"a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	world.replies["b"] = []string{"On it.", ""}

	if err := service.Post(group.ID, "[@Marketing](bot:b) draft the post"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return world.promptCount("b") == 2 })
	if world.promptCount("a") != 0 {
		t.Fatal("an unmentioned member took a turn")
	}
}

func TestMessageRelaysReplyToSender(t *testing.T) {
	world := newFakeWorld()
	world.addBot("gimli", "Gimli")
	world.addBot("egg", "dr eggbot")
	service := newTestService(world)
	world.replies["egg"] = []string{"Grok on the temporal harness."}

	if err := service.Message("gimli", "egg", "What model do you run on?"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return world.promptCount("gimli") == 1 })
	world.mu.Lock()
	defer world.mu.Unlock()
	if asked := world.prompts["egg"][0]; !strings.HasPrefix(asked, "[message from Gimli]") || !strings.Contains(asked, "What model do you run on?") {
		t.Fatalf("recipient prompt = %q", asked)
	}
	if relayed := world.prompts["gimli"][0]; !strings.HasPrefix(relayed, "[reply from dr eggbot]") || !strings.Contains(relayed, "temporal harness") {
		t.Fatalf("relayed reply = %q", relayed)
	}
	if len(world.published) == 0 {
		t.Fatal("nothing was published")
	}
	for _, event := range world.published {
		if event.RoomMessage != nil {
			t.Fatalf("an answer to a bot reached a chat: %+v", event.RoomMessage)
		}
		if event.Seq == 0 {
			t.Fatalf("published %s without the seq clients match history by", event.Type)
		}
	}
}

func TestSayOutsideAServiceTurnReachesTheBotsOwnChat(t *testing.T) {
	world := newFakeWorld()
	world.addBot("gimli", "Gimli")
	service := newTestService(world)

	if err := service.Say("gimli", "  Moved it to In Progress.  "); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(world.roomMessages("gimli"), "\n"); got != "Gimli: Moved it to In Progress." {
		t.Fatalf("own chat = %q", got)
	}
	if bot, err := service.Load("gimli"); err != nil || bot.Preview != "Moved it to In Progress." {
		t.Fatalf("preview = %q, %v", bot.Preview, err)
	}
	if err := service.Say("plain-chat", "hi"); err == nil {
		t.Fatal("a thread that is not a bot sent a bot message")
	}
}

func TestAdoptLoopsGivesEachOwnerlessLoopItsOwnBotExceptBoardWidgets(t *testing.T) {
	world := newFakeWorld()
	world.addBot("gimli", "Gimli")
	world.loops = []loops.Loop{
		{ID: "loop-1", Name: "Morning triage", ACPAgent: "codex", Directory: "triage"},
		{ID: "loop-2", Name: "Digest", BotID: "gimli"},
		{ID: "widget-loop", Name: "world-clocks"},
	}
	if err := newTestService(world).AdoptLoops(context.Background()); err != nil {
		t.Fatal(err)
	}
	adopted := world.loops[0].BotID
	record, err := world.LoadBot(adopted)
	if err != nil || record.Kind != KindBot || world.sessions[adopted].Title != "Morning triage" {
		t.Fatalf("adopted by %q: %+v, %v", adopted, record, err)
	}
	if len(world.created) != 1 || world.created[0].ACPAgent != "codex" || world.created[0].Directory != "triage" {
		t.Fatalf("created bots = %+v", world.created)
	}
	if world.loops[1].BotID != "gimli" {
		t.Fatal("an owned loop changed owner")
	}
	if world.loops[2].BotID != "" {
		t.Fatal("a board widget was given a bot")
	}
}
