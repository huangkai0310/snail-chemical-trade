package handler

// ContractsChangedEvent 品种合约列表变更（建立/删除），前端刷新自选交割期
type ContractsChangedEvent struct {
	ProductID      string `json:"product_id"`
	DeliveryPeriod string `json:"delivery_period,omitempty"`
	// created | deleted
	Action string `json:"action,omitempty"`
}
