package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/middleware"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
)

type AccountHandler struct {
	accountRepo *repo.AccountRepo
}

func NewAccountHandler(accountRepo *repo.AccountRepo) *AccountHandler {
	return &AccountHandler{accountRepo: accountRepo}
}

// GetAccount 获取当前用户资金账户信息
// GET /api/v1/account
func (h *AccountHandler) GetAccount(c *gin.Context) {
	userID := middleware.GetUserID(c)

	acc, err := h.accountRepo.GetOrCreate(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取账户信息失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         acc.ID,
		"user_id":    acc.UserID,
		"balance":    acc.Balance,
		"frozen":     acc.Frozen,
		"total_in":   acc.TotalIn,
		"total_out":  acc.TotalOut,
		"created_at": acc.CreatedAt,
		"updated_at": acc.UpdatedAt,
	})
}

// Deposit 充值
// POST /api/v1/account/deposit  body: {"amount": 10000, "remark": "银行转账充值"}
func (h *AccountHandler) Deposit(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req struct {
		Amount float64 `json:"amount" binding:"required,gt=0"`
		Remark string  `json:"remark"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "充值金额必须大于 0"})
		return
	}

	remark := req.Remark
	if remark == "" {
		remark = "在线充值"
	}

	acc, tx, err := h.accountRepo.Deposit(c.Request.Context(), userID, req.Amount, remark)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "充值成功",
		"account":     acc,
		"transaction": tx,
	})
}

// Withdraw 提现
// POST /api/v1/account/withdraw  body: {"amount": 5000, "remark": "提现到银行卡"}
func (h *AccountHandler) Withdraw(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req struct {
		Amount float64 `json:"amount" binding:"required,gt=0"`
		Remark string  `json:"remark"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "提现金额必须大于 0"})
		return
	}

	remark := req.Remark
	if remark == "" {
		remark = "用户提现"
	}

	acc, tx, err := h.accountRepo.Withdraw(c.Request.Context(), userID, req.Amount, remark)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "提现成功",
		"account":     acc,
		"transaction": tx,
	})
}

// ListTransactions 资金流水
// GET /api/v1/account/transactions?page=1&page_size=20
func (h *AccountHandler) ListTransactions(c *gin.Context) {
	userID := middleware.GetUserID(c)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	txs, total, err := h.accountRepo.ListTransactions(c.Request.Context(), userID, pageSize, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询流水失败: " + err.Error()})
		return
	}

	totalPage := 0
	if total > 0 {
		totalPage = (total + pageSize - 1) / pageSize
	}

	c.JSON(http.StatusOK, gin.H{
		"data":        txs,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_page":  totalPage,
	})
}
