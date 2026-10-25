-- Pruebas SQL de la tabla public.notes: RLS, restricciones check y trigger de tope (30 notas/minuto).
--
-- Cómo ejecutarlas: pegar el archivo completo en el SQL Editor de Supabase (o con `psql -f`).
-- Es seguro correrlo contra la base real: todo ocurre dentro de una sola transacción que siempre
-- termina con un error a propósito, así que se revierte y no deja datos ni objetos.
--
-- Resultado: el mensaje del error final empieza con
--   PASS: N pruebas        -> todo bien
--   FAIL: X de N pruebas: ... -> lista los nombres de las pruebas que fallaron
-- Cualquier otro error significa que el propio script falló.

-- Resultados y ayudantes temporales (desaparecen con el rollback).
create temp table t_results (name text, ok boolean);

create function pg_temp.t(test_name text, passed boolean) returns void
language sql as $$ insert into t_results values (test_name, coalesce(passed, false)) $$;

-- Ejecuta stmt con el rol dado y devuelve el SQLSTATE del error, o null si no hubo error.
create function pg_temp.sql_state(as_role text, stmt text) returns text
language plpgsql as $$
declare state text;
begin
  begin
    execute format('set local role %I', as_role);
    execute stmt;
  exception when others then
    get stacked diagnostics state = returned_sqlstate;
  end;
  reset role;
  return state;
end $$;

-- Ejecuta stmt con el rol dado y devuelve las filas afectadas (0 si se deniega por privilegios).
create function pg_temp.rows_affected(as_role text, stmt text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute format('set local role %I', as_role);
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;
  reset role;
  return n;
end $$;

do $$
declare
  insert_ok constant text := $q$insert into public.notes (author, body) values ('t', 'nota de prueba')$q$;
  c bigint;
begin
  -- Aislamiento: "envejecer" las notas recientes para que el tope de 30/min parta de cero (se revierte).
  update public.notes set created_at = now() - interval '2 minutes' where created_at > now() - interval '1 minute';

  ----------------------------------------------------------------- RLS y políticas
  perform pg_temp.t('RLS activado en notes',
    (select relrowsecurity from pg_class where oid = 'public.notes'::regclass));

  perform pg_temp.t('solo existen las políticas SELECT e INSERT',
    (select coalesce(array_agg(cmd order by cmd), '{}') = array['INSERT', 'SELECT']
       from pg_policies where schemaname = 'public' and tablename = 'notes'));

  perform pg_temp.t('las políticas son solo para anon',
    (select coalesce(bool_and(roles = '{anon}'), false)
       from pg_policies where schemaname = 'public' and tablename = 'notes'));

  perform pg_temp.t('anon puede insertar', pg_temp.sql_state('anon', insert_ok) is null);

  perform pg_temp.t('anon puede leer las notas',
    pg_temp.rows_affected('anon', 'select * from public.notes') >= 1);

  perform pg_temp.t('anon no puede actualizar notas',
    pg_temp.rows_affected('anon', $q$update public.notes set body = 'hack'$q$) = 0
    and not exists (select 1 from public.notes where body = 'hack'));

  perform pg_temp.t('anon no puede borrar notas',
    pg_temp.rows_affected('anon', 'delete from public.notes') = 0
    and exists (select 1 from public.notes where body = 'nota de prueba'));

  ----------------------------------------------------------------- Restricciones check / not null
  perform pg_temp.t('author de 40 caracteres es válido',
    pg_temp.sql_state('anon', format('insert into public.notes (author, body) values (%L, %L)', repeat('a', 40), 'x')) is null);
  perform pg_temp.t('author de 41 caracteres se rechaza (check_violation)',
    pg_temp.sql_state('anon', format('insert into public.notes (author, body) values (%L, %L)', repeat('a', 41), 'x')) = '23514');
  perform pg_temp.t('body de 280 caracteres es válido',
    pg_temp.sql_state('anon', format('insert into public.notes (body) values (%L)', repeat('b', 280))) is null);
  perform pg_temp.t('body de 281 caracteres se rechaza (check_violation)',
    pg_temp.sql_state('anon', format('insert into public.notes (body) values (%L)', repeat('b', 281))) = '23514');
  perform pg_temp.t('body vacío se rechaza (check_violation)',
    pg_temp.sql_state('anon', $q$insert into public.notes (body) values ('')$q$) = '23514');
  perform pg_temp.t('body nulo se rechaza (not_null_violation)',
    pg_temp.sql_state('anon', 'insert into public.notes (body) values (null)') = '23502');
  perform pg_temp.t('author por defecto es "anónimo"',
    (select author from public.notes where body = repeat('b', 280)) = 'anónimo');
  perform pg_temp.t('los límites cuentan caracteres, no bytes (280 emojis válidos)',
    pg_temp.sql_state('anon', format('insert into public.notes (body) values (%L)', repeat('😀', 280))) is null);

  ----------------------------------------------------------------- Trigger de tope por minuto
  perform pg_temp.t('existe el trigger notes_rate_limit en notes',
    exists (select 1 from pg_trigger
             where tgrelid = 'public.notes'::regclass and tgname = 'notes_rate_limit' and not tgisinternal));

  perform pg_temp.t('la función del trigger es security definer con search_path fijo',
    (select prosecdef and coalesce(proconfig::text like '%search_path=public%', false)
       from pg_proc where oid = 'public.notes_rate_limit'::regproc));

  -- Partir de cero otra vez (las inserciones de arriba cuentan para el tope).
  update public.notes set created_at = now() - interval '2 minutes' where created_at > now() - interval '1 minute';

  perform pg_temp.t('anon puede insertar las primeras 30 notas del minuto',
    (select count(*) from generate_series(1, 30) i
      where pg_temp.sql_state('anon', format('insert into public.notes (body) values (%L)', 'tope ' || i)) is null) = 30);

  perform pg_temp.t('la nota 31 del minuto se rechaza con PT429',
    pg_temp.sql_state('anon', insert_ok) = 'PT429');

  perform pg_temp.t('la nota rechazada no se guarda (siguen 30)',
    (select count(*) from public.notes where created_at > now() - interval '1 minute') = 30);

  -- Ventana deslizante: si las notas tienen más de un minuto, se vuelve a permitir.
  update public.notes set created_at = now() - interval '2 minutes'
   where created_at >= now() - interval '1 minute';

  perform pg_temp.t('pasado el minuto se permite insertar otra vez',
    pg_temp.sql_state('anon', insert_ok) is null);

  ----------------------------------------------------------------- Resultado (siempre revierte)
  select count(*) filter (where not ok) into c from t_results;
  if c = 0 then
    raise exception 'PASS: % pruebas', (select count(*) from t_results);
  else
    raise exception 'FAIL: % de % pruebas: %', c, (select count(*) from t_results),
      (select string_agg(name, '; ') from t_results where not ok);
  end if;
end $$;
