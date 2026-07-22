-- 042: 可商谈条款去掉数量、交割地、规格（沿用原盘，不可商谈）
UPDATE listings
SET negotiable_terms = COALESCE((
  SELECT jsonb_agg(to_jsonb(elem))
  FROM jsonb_array_elements_text(negotiable_terms) AS elem
  WHERE elem NOT IN ('quantity', 'delivery_location', 'specs')
), '[]'::jsonb)
WHERE negotiable_terms IS NOT NULL
  AND negotiable_terms ?| array['quantity', 'delivery_location', 'specs'];

UPDATE swap_listings
SET sell_negotiable_terms = COALESCE((
  SELECT jsonb_agg(to_jsonb(elem))
  FROM jsonb_array_elements_text(sell_negotiable_terms) AS elem
  WHERE elem NOT IN ('quantity', 'delivery_location', 'specs')
), '[]'::jsonb)
WHERE sell_negotiable_terms IS NOT NULL
  AND sell_negotiable_terms ?| array['quantity', 'delivery_location', 'specs'];

UPDATE swap_listings
SET buy_negotiable_terms = COALESCE((
  SELECT jsonb_agg(to_jsonb(elem))
  FROM jsonb_array_elements_text(buy_negotiable_terms) AS elem
  WHERE elem NOT IN ('quantity', 'delivery_location', 'specs')
), '[]'::jsonb)
WHERE buy_negotiable_terms IS NOT NULL
  AND buy_negotiable_terms ?| array['quantity', 'delivery_location', 'specs'];

-- 兼容旧合并字段
UPDATE swap_listings
SET negotiable_terms = COALESCE((
  SELECT jsonb_agg(to_jsonb(elem))
  FROM jsonb_array_elements_text(negotiable_terms) AS elem
  WHERE elem NOT IN ('quantity', 'delivery_location', 'specs')
), '[]'::jsonb)
WHERE negotiable_terms IS NOT NULL
  AND negotiable_terms ?| array['quantity', 'delivery_location', 'specs'];
