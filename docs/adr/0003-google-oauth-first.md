# ADR-0003：第一期採 Google OAuth，LINE Login 延後

**Status**: Accepted

## Context

目標使用者為台灣大學生團契，LINE 為主要通訊工具，但 LINE Login 需申請 channel、通過審核，且 Supabase 需以 custom OAuth provider 接入。

## Decision

第一期僅提供 Google OAuth。LINE Login 列為第五至六週可追加的第二登入選項。

## Consequences

**代價**：
- 部分成員登入摩擦上升。習慣 LINE 的使用者需另外想起 Google 帳號密碼。
- 手機上若未登入 Google，OAuth 流程會多出數個步驟，可能造成加入流程流失。
- 日後追加 LINE Login 時，同一人可能產生兩個 auth user，需處理帳號合併或明確禁止。
