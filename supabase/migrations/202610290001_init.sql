create extension if not exists pgcrypto;

create table if not exists public.ai_private_entries (
  id uuid primary key default gen_random_uuid(),
  source_tag text not null unique,
  envelope jsonb not null,
  key_version integer not null default 1,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_tag_length check (char_length(source_tag) between 6 and 200),
  constraint envelope_version check ((envelope->>'version')::integer = 1),
  constraint envelope_algorithm check (envelope->>'alg' = 'RSA-OAEP-256+A256GCM')
);

alter table public.ai_private_entries enable row level security;

revoke all on table public.ai_private_entries from anon, authenticated;

create index if not exists ai_private_entries_created_at_idx
  on public.ai_private_entries (created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_private_entries_updated_at on public.ai_private_entries;
create trigger ai_private_entries_updated_at
before update on public.ai_private_entries
for each row execute function public.set_updated_at();

