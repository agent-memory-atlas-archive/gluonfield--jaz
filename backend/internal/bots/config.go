package bots

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/loops"
)

type Config struct {
	Name      string
	Prompt    string
	Agent     string
	Model     string
	Schedules []ScheduleConfig
}

type ScheduleConfig struct {
	Name     string
	Prompt   string
	Schedule loops.Schedule
	Status   string
}

func (s *Service) Declare(ctx context.Context, declared []Config) error {
	if len(declared) == 0 {
		return nil
	}
	declared, err := normalizeConfig(declared)
	if err != nil {
		return err
	}
	bots, err := s.List()
	if err != nil {
		return err
	}
	routines, err := s.routines.List()
	if err != nil {
		return err
	}
	for _, input := range declared {
		bot, err := s.declareBot(ctx, bots, input)
		if err != nil {
			return fmt.Errorf("configured bot %q: %w", input.Name, err)
		}
		for _, schedule := range input.Schedules {
			if err := s.declareSchedule(routines, bot.ID, schedule); err != nil {
				return fmt.Errorf("configured bot %q, schedule %q: %w", input.Name, schedule.Name, err)
			}
		}
	}
	return nil
}

func normalizeConfig(declared []Config) ([]Config, error) {
	result := make([]Config, 0, len(declared))
	names := map[string]bool{}
	for _, input := range declared {
		input.Name = strings.TrimSpace(input.Name)
		input.Prompt = strings.TrimSpace(input.Prompt)
		input.Agent = acp.CanonicalAgentName(input.Agent)
		input.Model = strings.TrimSpace(input.Model)
		key := strings.ToLower(input.Name)
		if key == "" || names[key] {
			return nil, fmt.Errorf("configured bot name %q is empty or repeated", input.Name)
		}
		names[key] = true
		schedules := make([]ScheduleConfig, 0, len(input.Schedules))
		scheduleNames := map[string]bool{}
		for _, schedule := range input.Schedules {
			schedule.Name = strings.TrimSpace(schedule.Name)
			key := strings.ToLower(schedule.Name)
			if key == "" || scheduleNames[key] {
				return nil, fmt.Errorf("configured bot %q: schedule name %q is empty or repeated", input.Name, schedule.Name)
			}
			scheduleNames[key] = true
			prompt := strings.TrimSpace(schedule.Prompt)
			if prompt == "" {
				prompt = input.Prompt
			}
			routine, _, err := loops.NormalizeCreate(loops.CreateLoop{
				Name: schedule.Name, Prompt: prompt, Schedule: schedule.Schedule, Status: schedule.Status,
			}, time.Now())
			if err != nil {
				return nil, fmt.Errorf("configured bot %q, schedule %q: %w", input.Name, schedule.Name, err)
			}
			schedules = append(schedules, ScheduleConfig{
				Name: routine.Name, Prompt: routine.Prompt, Schedule: routine.Schedule, Status: routine.Status,
			})
		}
		input.Schedules = schedules
		result = append(result, input)
	}
	return result, nil
}

func (s *Service) declareBot(ctx context.Context, bots []Bot, input Config) (Bot, error) {
	var current Bot
	for _, bot := range bots {
		if !strings.EqualFold(bot.Name, input.Name) {
			continue
		}
		if current.ID != "" || bot.Kind != KindBot {
			return Bot{}, fmt.Errorf("name matches a group or multiple bots")
		}
		current = bot
	}
	if current.ID == "" {
		return s.Create(ctx, CreateBot{Name: input.Name, Prompt: input.Prompt, Agent: input.Agent, Model: input.Model})
	}
	update := UpdateBot{}
	if current.Prompt != input.Prompt {
		update.Prompt = &input.Prompt
	}
	if input.Agent != "" && current.Agent != input.Agent {
		update.Agent = &input.Agent
	}
	if input.Model != "" && (current.Model != input.Model || update.Agent != nil) {
		update.Model = &input.Model
		if update.Agent == nil {
			update.ReasoningEffort = current.ReasoningEffort
		}
	}
	if update.Prompt != nil || update.Agent != nil || update.Model != nil {
		return s.Update(ctx, current.ID, update)
	}
	return current, nil
}

func (s *Service) declareSchedule(routines []loops.Loop, botID string, input ScheduleConfig) error {
	var current loops.Loop
	for _, routine := range routines {
		if routine.BotID != botID || !strings.EqualFold(routine.Name, input.Name) {
			continue
		}
		if current.ID != "" {
			return fmt.Errorf("name matches multiple routines")
		}
		current = routine
	}
	if current.ID == "" {
		_, err := s.routines.Create(loops.CreateLoop{
			Name: input.Name, Prompt: input.Prompt, Schedule: input.Schedule, Status: input.Status, BotID: botID,
		})
		return err
	}
	update := loops.UpdateLoop{}
	if current.Prompt != input.Prompt {
		update.Prompt = &input.Prompt
	}
	if current.Schedule != input.Schedule {
		update.Schedule = &input.Schedule
	}
	if current.Status != input.Status {
		update.Status = &input.Status
	}
	if update.Prompt != nil || update.Schedule != nil || update.Status != nil {
		_, err := s.routines.Update(current.ID, update)
		return err
	}
	return nil
}
