package handler

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/huangkai0310/snail-chemical-trade/api-gateway/calendar"
	"github.com/huangkai0310/snail-chemical-trade/api-gateway/repo"
	engine "github.com/huangkai0310/snail-chemical-trade/matching-engine"
)

// ContractHandler 品种交割期合约（公开读 + 定时清理）
type ContractHandler struct {
	repo              *repo.ProductContractRepo
	preferencesRepo   *repo.PreferencesRepo
	listingRepo       *repo.ListingRepo
	contractBroadcast chan<- ContractsChangedEvent
	listingBroadcast  chan<- engine.ListingEvent
}

func NewContractHandler(r *repo.ProductContractRepo) *ContractHandler {
	return &ContractHandler{repo: r}
}

func (h *ContractHandler) SetPreferencesRepo(r *repo.PreferencesRepo) {
	h.preferencesRepo = r
}

func (h *ContractHandler) SetListingRepo(r *repo.ListingRepo) {
	h.listingRepo = r
}

func (h *ContractHandler) SetContractBroadcast(ch chan<- ContractsChangedEvent) {
	h.contractBroadcast = ch
}

func (h *ContractHandler) SetListingBroadcast(ch chan<- engine.ListingEvent) {
	h.listingBroadcast = ch
}

func (h *ContractHandler) emitContractsChanged(productID, deliveryPeriod, action string) {
	if h.contractBroadcast == nil || productID == "" {
		return
	}
	select {
	case h.contractBroadcast <- ContractsChangedEvent{
		ProductID:      productID,
		DeliveryPeriod: repo.NormalizeContractPeriod(deliveryPeriod),
		Action:         action,
	}:
	default:
		log.Warn().Str("product_id", productID).Msg("contractBroadcast 通道已满")
	}
}

func (h *ContractHandler) onContractDeleted(ctx context.Context, productID, deliveryPeriod string) {
	dp := repo.NormalizeContractPeriod(deliveryPeriod)
	if h.preferencesRepo != nil {
		key := repo.FavoriteContractKey(productID, dp)
		if n, err := h.preferencesRepo.RemoveFavoriteKeyFromAll(ctx, key); err != nil {
			log.Warn().Err(err).Str("key", key).Msg("清理合约自选失败")
		} else if n > 0 {
			log.Info().Str("key", key).Int64("users", n).Msg("已从用户自选中移除已过期合约")
		}
	}
	h.emitContractsChanged(productID, dp, "deleted")
}

// ListByProduct GET /api/v1/products/:id/contracts
func (h *ContractHandler) ListByProduct(c *gin.Context) {
	productID := c.Param("id")
	if productID == "" {
		c.JSON(400, gin.H{"error": "缺少品种"})
		return
	}
	items, err := h.repo.ListByProduct(c.Request.Context(), productID)
	if err != nil {
		log.Error().Err(err).Str("product_id", productID).Msg("查询合约失败")
		c.JSON(500, gin.H{"error": "查询失败"})
		return
	}
	if items == nil {
		items = []repo.ProductContract{}
	}
	// 兜底现货
	hasSpot := false
	for _, it := range items {
		if it.DeliveryPeriod == "现货" {
			hasSpot = true
			break
		}
	}
	if !hasSpot {
		items = append([]repo.ProductContract{{
			ProductID:      productID,
			DeliveryPeriod: "现货",
		}}, items...)
	}
	c.JSON(200, gin.H{"data": items})
}

// ListAll GET /api/v1/contracts
func (h *ContractHandler) ListAll(c *gin.Context) {
	items, err := h.repo.ListAll(c.Request.Context())
	if err != nil {
		log.Error().Err(err).Msg("查询全部合约失败")
		c.JSON(500, gin.H{"error": "查询失败"})
		return
	}
	if items == nil {
		items = []repo.ProductContract{}
	}
	c.JSON(200, gin.H{"data": items})
}

// PurgePastContracts 定时任务：清除交割日已过的非现货合约（并清自选、广播）
func (h *ContractHandler) PurgePastContracts() {
	ctx := context.Background()
	now := time.Now().In(calendar.Shanghai)
	items, err := h.repo.ListNonSpot(ctx)
	if err != nil {
		log.Error().Err(err).Msg("列出非现货合约失败")
		return
	}

	deleted := 0
	skippedUnparsed := 0
	for _, c := range items {
		if !calendar.IsDeliveryPast(c.DeliveryPeriod, now) {
			if _, ok := calendar.ParseDeliveryPeriodDate(c.DeliveryPeriod); !ok {
				skippedUnparsed++
			}
			continue
		}

		// 先强制过期该合约下仍活跃的挂盘/换盘，避免幽灵盘
		if h.listingRepo != nil {
			if n, err := h.listingRepo.ForceExpireByContract(ctx, c.ProductID, c.DeliveryPeriod); err != nil {
				log.Warn().Err(err).Str("product_id", c.ProductID).Str("dp", c.DeliveryPeriod).Msg("过期活跃挂盘失败")
			} else if n > 0 {
				log.Info().Int64("count", n).Str("product_id", c.ProductID).Str("dp", c.DeliveryPeriod).Msg("交割已过：已强制过期挂盘")
			}
		}
		if n, err := h.repo.ForceExpireSwapsByContract(ctx, c.ProductID, c.DeliveryPeriod); err != nil {
			log.Warn().Err(err).Str("product_id", c.ProductID).Str("dp", c.DeliveryPeriod).Msg("过期活跃换盘失败")
		} else if n > 0 {
			log.Info().Int64("count", n).Str("product_id", c.ProductID).Str("dp", c.DeliveryPeriod).Msg("交割已过：已强制过期换盘")
		}

		ok, err := h.repo.Delete(ctx, c.ProductID, c.DeliveryPeriod)
		if err != nil {
			log.Warn().Err(err).Str("product_id", c.ProductID).Str("dp", c.DeliveryPeriod).Msg("删除过期合约失败")
			continue
		}
		if !ok {
			continue
		}
		deleted++
		h.onContractDeleted(ctx, c.ProductID, c.DeliveryPeriod)
		if h.listingBroadcast != nil {
			select {
			case h.listingBroadcast <- engine.ListingEvent{ProductID: c.ProductID}:
			default:
			}
		}
		log.Info().
			Str("product_id", c.ProductID).
			Str("delivery_period", c.DeliveryPeriod).
			Msg("交割已过：合约已清除")
	}

	if deleted > 0 || skippedUnparsed > 0 {
		log.Info().Int("deleted", deleted).Int("unparsed", skippedUnparsed).Msg("交割已过合约定时清理完成")
	}
}
