package handler

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"time"

	"github.com/rs/zerolog/log"
)

// CollectMarketData 定时采集任务：调用 Python 爬虫脚本采集平台行情数据
// scriptPath: 爬虫入口脚本的绝对路径
// pythonBin: Python 解释器（如 python3）
// 返回 error，nil 表示成功
func CollectMarketData(ctx context.Context, scriptPath, pythonBin string) error {
	if scriptPath == "" {
		log.Warn().Msg("CRAWLER_SCRIPT_PATH 未配置，跳过数据采集任务")
		return nil
	}

	start := time.Now()
	log.Info().
		Str("script", scriptPath).
		Str("python", pythonBin).
		Msg("开始执行数据采集任务")

	// 构造命令行：python3 cron_collect.py --source platform --interval 1h --period 现货
	cmd := exec.CommandContext(ctx, pythonBin, scriptPath,
		"--source", "platform",
		"--interval", "1h",
		"--period", "现货",
		"--log-dir", "/var/log/crawler",
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		outStr := stdout.String()
		errStr := stderr.String()
		log.Error().
			Err(err).
			Str("stdout", outStr).
			Str("stderr", errStr).
			Dur("duration", time.Since(start)).
			Msg("数据采集任务执行失败")
		return fmt.Errorf("crawler failed: %w\nstdout: %s\nstderr: %s", err, outStr, errStr)
	}

	log.Info().
		Str("output", stdout.String()).
		Dur("duration", time.Since(start)).
		Msg("数据采集任务执行成功")
	return nil
}
