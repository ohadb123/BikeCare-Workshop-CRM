-- Run this in Supabase SQL Editor to get the actual tickets table schema
-- This will help identify which columns exist and their types

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tickets'
ORDER BY ordinal_position;
