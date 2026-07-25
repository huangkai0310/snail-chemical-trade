package scheduler

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

// TaskFunc 定时任务执行函数
// 返回 error 表示执行失败，nil 表示成功
type TaskFunc func(ctx context.Context) error

// Scheduler 动态定时任务调度器
// 从 cron_tasks 表读取任务配置，支持 interval / cron 两种调度方式
// 后台管理界面可动态增删改查、启停任务
type Scheduler struct {
	cronTaskRepo *repo.CronTaskRepo
	tasks        map[string]TaskFunc // 任务名 → 执行函数
	stopCh       chan struct{}
	wg           sync.WaitGroup
	mu           sync.RWMutex
	running      bool
}

// NewScheduler 创建调度器
func NewScheduler(cronTaskRepo *repo.CronTaskRepo) *Scheduler {
	return &Scheduler{
		cronTaskRepo: cronTaskRepo,
		tasks:        make(map[string]TaskFunc),
		stopCh:       make(chan struct{}),
	}
}

// Register 注册任务执行函数
// name 必须与 cron_tasks 表中的 name 一致
func (s *Scheduler) Register(name string, fn TaskFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tasks[name] = fn
	log.Info().Str("task", name).Msg("已注册定时任务")
}

// Start 启动调度器
// 每隔 30 秒重新加载 cron_tasks 配置，动态启停任务
func (s *Scheduler) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()

	s.wg.Add(1)
	go s.run()
	log.Info().Msg("定时任务调度器已启动")
}

// Stop 停止调度器
func (s *Scheduler) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	s.mu.Unlock()

	close(s.stopCh)
	s.wg.Wait()
	log.Info().Msg("定时任务调度器已停止")
}

// run 主循环：每 30 秒重新加载配置并执行到期任务
func (s *Scheduler) run() {
	defer s.wg.Done()

	// 启动后立即执行一次配置加载
	s.reloadAndExecute(context.Background())

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.reloadAndExecute(context.Background())
		case <-s.stopCh:
			return
		}
	}
}

// reloadAndExecute 加载已启用任务并执行到期的
func (s *Scheduler) reloadAndExecute(ctx context.Context) {
	tasks, err := s.cronTaskRepo.ListEnabled(ctx)
	if err != nil {
		log.Error().Err(err).Msg("加载定时任务配置失败")
		return
	}

	for _, task := range tasks {
		if !s.shouldRun(task) {
			continue
		}

		s.mu.RLock()
		fn, ok := s.tasks[task.Name]
		s.mu.RUnlock()

		if !ok {
			log.Warn().Str("task", task.Name).Msg("定时任务未注册执行函数，跳过")
			continue
		}

		// 异步执行，不阻塞主循环
		s.wg.Add(1)
		go s.executeTask(task.Name, fn)
	}
}

// shouldRun 判断任务是否该执行
// interval 类型：距离上次执行超过 interval_seconds
// cron 类型：暂不支持精确 cron 表达式解析，降级为 interval（每天执行一次）
func (s *Scheduler) shouldRun(task repo.CronTask) bool {
	now := time.Now()

	if task.LastRunAt != nil {
		var interval time.Duration
		if task.TaskType == "interval" && task.IntervalSeconds != nil {
			interval = time.Duration(*task.IntervalSeconds) * time.Second
		} else if task.TaskType == "cron" {
			// cron 类型降级为每天执行一次（86400 秒）
			// 后续可引入 cron 表达式解析库实现精确调度
			interval = 86400 * time.Second
		} else {
			// 未知类型默认每小时
			interval = 3600 * time.Second
		}

		if now.Sub(*task.LastRunAt) < interval {
			return false
		}
	}

	return true
}

// executeTask 执行单个任务并更新状态
func (s *Scheduler) executeTask(name string, fn TaskFunc) {
	defer s.wg.Done()

	ctx := context.Background()
	log.Info().Str("task", name).Msg("开始执行定时任务")

	start := time.Now()
	err := fn(ctx)
	duration := time.Since(start)

	if err != nil {
		msg := err.Error()
		log.Error().Err(err).Str("task", name).Dur("duration", duration).Msg("定时任务执行失败")
		if updateErr := s.cronTaskRepo.UpdateRunStatus(ctx, name, "failed", msg); updateErr != nil {
			log.Error().Err(updateErr).Str("task", name).Msg("更新任务状态失败")
		}
	} else {
		log.Info().Str("task", name).Dur("duration", duration).Msg("定时任务执行成功")
		if updateErr := s.cronTaskRepo.UpdateRunStatus(ctx, name, "success", ""); updateErr != nil {
			log.Error().Err(updateErr).Str("task", name).Msg("更新任务状态失败")
		}
	}
}
