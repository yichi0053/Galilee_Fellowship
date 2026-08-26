-- ============================================================================
-- Migration 008：配額索引改為只看 counts_toward_quota
--
-- 架構書 §9.1 / ADR-0010。
-- 規則（§12.6）：已推上雲端的 migration 不得修改，故在此重建索引而非改寫 002。
-- ============================================================================

-- 002 的部分索引條件是 `counts_toward_quota and deleted_at is null`，
-- 對應當時配額查詢的寫法。但那個寫法讓 ADR-0010 的回補期完全失去作用：
-- 只要 deleted_at 有值就被排除在計數之外，不管 counts_toward_quota 是什麼，
-- 於是逾期刪除也等於回補，每週配額形同虛設。
--
-- 查詢已改為只看 counts_toward_quota（見 src/modules/quota/index.ts 的說明），
-- 索引條件必須跟著改，否則 Postgres 無法使用這個部分索引。
drop index if exists posts_quota_idx;

create index posts_quota_idx
  on posts (author_id, week_start_date, type)
  where counts_toward_quota;

comment on index posts_quota_idx is
  '§9.1 的配額查詢。刻意不含 deleted_at：'
  '「有沒有用掉配額」完全由 counts_toward_quota 表達（ADR-0010）。';
