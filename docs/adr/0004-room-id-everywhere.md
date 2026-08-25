# ADR-0004：Schema 保留 room_id 但 UI 僅暴露單一房間

**Status**: Accepted

## Context

第一期只有一個房間。是否要在每張表帶 `room_id`？

## Decision

所有表皆帶 `room_id` 並建立外鍵，但 UI 與流程第一期只暴露單一房間，房間 uuid 以環境變數 `VITE_ROOM_ID` 固定。

## Consequences

**代價**：
- 每張表多一個欄位、每個查詢多一個 where 條件、每條 RLS policy 多一層判斷。
- 第一期完全用不到這個維度，屬於為未來付出的當下成本。
- 若最終未擴展為 multi-tenant，這些成本即為浪費。

收益：日後擴展不需對每張表做 migration，成本接近零地保留了選項。
