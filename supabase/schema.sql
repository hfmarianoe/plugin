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

-- Tope global anti-abuso: máximo 30 notas por minuto, incluso con inserción directa por la clave pública.
-- errcode PT429 hace que PostgREST responda HTTP 429.
create or replace function public.notes_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.notes where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Demasiadas notas, intenta de nuevo en un minuto' using errcode = 'PT429';
  end if;
  return new;
end;
$$;

drop trigger if exists notes_rate_limit on public.notes;
create trigger notes_rate_limit
  before insert on public.notes
  for each row execute function public.notes_rate_limit();
