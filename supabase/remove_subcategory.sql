-- Remove the obsolete subcategory field from active and legacy topic tables.
ALTER TABLE IF EXISTS public.content_topics
  DROP COLUMN IF EXISTS subcategory;

ALTER TABLE IF EXISTS public.topics2
  DROP COLUMN IF EXISTS subcategory;
