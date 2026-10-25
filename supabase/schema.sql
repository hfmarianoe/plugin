create table if not exists public.notes (
  id         bigint generated always as identity primary key,
  author     text not null default 'anónimo' check (char_length(author) <= 40),
  body       text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);

-- Solo el backend (service role) accede; el navegador nunca toca la tabla.
alter table public.notes enable row level security;
