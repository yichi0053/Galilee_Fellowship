# ADR-0012：本機開發採 Supabase CLI 而非 XAMPP

**Status**: Accepted

## Context

開發者手上有 XAMPP（Apache + MariaDB + PHP）環境，是否可用於本機開發？

## Decision

不可。本機開發採 Supabase CLI。

## Consequences

**代價**：需安裝 Docker，這是額外的環境負擔與磁碟空間。

XAMPP 不適用的理由——本專案使用的下列元素在 MariaDB 中不存在或語意不同：
Row Level Security（**完全不存在**）、`auth.users` schema、`gen_random_uuid()`、
`create type ... as enum`、`timestamptz`、`inet`、`date_trunc(... at time zone ...)`、
`security definer` 函式、Storage 物件儲存。

核心問題：本系統的安全核心是 RLS，而 MariaDB 沒有 RLS。在 XAMPP 上通過的測試對線上環境不構成任何保證。這是最糟的一種測試——給你信心卻沒有保障。

唯一合理的 XAMPP 使用情境是想累積 PHP 後端實作經驗，但那應該是另一個專案，不應與這學期的活動綁在一起。
