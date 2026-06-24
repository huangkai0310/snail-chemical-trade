package handler

import (
	"time"

	"github.com/google/uuid"
)

// parseUUID 解析 UUID 字符串
func parseUUID(s string) (uuid.UUID, error) {
	return uuid.Parse(s)
}

// nowPtr 返回当前时间指针
func nowPtr() *time.Time {
	t := time.Now()
	return &t
}
