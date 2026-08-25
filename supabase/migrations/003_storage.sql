-- ============================================================================
-- Migration 003：Storage bucket 與其存取政策
--
-- 架構書 §9.3、§9.4。
-- ============================================================================

-- public = true：訪客不登入即可瀏覽照片牆（§10.3），因此圖片必須可匿名取得。
-- 這代表任何知道路徑的人都能取得圖片，但訪客本來就看得到照片牆，
-- 威脅模型並未因此改變（能被外人看到的前提是先取得連結，見 ADR-0005）。
--
-- 若改用 signed URL，每張縮圖都要一次簽章往返，24 人 × 18 週的牆頁
-- 會產生大量額外請求，且簽章 URL 無法被 CDN 快取 —— 直接違反 §9.4 的 egress 控制。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  10485760,                                   -- §9.3：原始檔上限 10 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 路徑慣例：<auth.uid()>/<post_uuid>.jpg 與 <auth.uid()>/<post_uuid>_thumb.jpg
-- 以 uid 作為第一層目錄，讓「只能寫自己的檔案」可以用 policy 直接表達。

create policy post_images_read on storage.objects
  for select using (bucket_id = 'post-images');

create policy post_images_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy post_images_update on storage.objects
  for update to authenticated using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 作者刪除貼文為軟刪除，檔案留到 30 天後由清理函式移除（ADR-0009），
-- 因此一般使用者不需要 DELETE 權限。編輯換圖時舊檔同樣交給清理流程。
