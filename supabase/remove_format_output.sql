-- Remove the obsolete format output metadata from personas and generated content.
ALTER TABLE public.persona_configs
  DROP COLUMN IF EXISTS format_output;

ALTER TABLE public.content_outputs
  DROP COLUMN IF EXISTS format_output;
