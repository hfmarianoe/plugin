create table if not exists public.notes (
  id         bigint generated always as identity primary key,
  author     text not null default 'anónimo' check (char_length(author) <= 40),
  body       text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;

-- Con la clave pública (publishable) solo se puede leer y crear; no editar ni borrar.
create policy "notes_read"   on public.notes for select to anon using (true);
create policy "notes_insert" on public.notes for insert to anon with check (true);
