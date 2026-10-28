-- ============================================================
-- MZ'Recargas — esquema inicial
-- Pega TODO este archivo en el SQL Editor de Supabase (una sola
-- vez, en el proyecto de MZ'Recargas) y dale "Run".
-- ============================================================

-- ---------- PERFILES ----------
-- Un perfil por usuario, se crea solo cuando alguien se registra.
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  celular text,
  saldo numeric(10,2) not null default 0 check (saldo >= 0),
  created_at timestamptz not null default now()
);

alter table public.perfiles enable row level security;

create policy "select_propio_perfil" on public.perfiles
  for select using (auth.uid() = id);

-- La política RLS de arriba no alcanza sola: sin este GRANT, Postgres
-- rechaza la consulta antes de siquiera evaluar RLS ("permission denied
-- for table perfiles"), y el sitio no puede leer el perfil propio al
-- iniciar sesión.
grant select on public.perfiles to authenticated;

-- Nadie puede escribir directo en "perfiles" desde el sitio (ni
-- siquiera el propio dueño de la fila): el saldo solo se mueve a
-- través de los triggers de más abajo, nunca por una petición
-- normal, para que no se pueda inflar el saldo propio.

create function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.manejar_nuevo_usuario();

-- Único camino permitido para editar nickname/celular: nunca toca "saldo",
-- así el usuario no puede tocar su propio saldo aunque intente un UPDATE
-- directo a la tabla (que de por sí está bloqueado por no tener policy).
create function public.actualizar_mi_perfil(nuevo_nickname text, nuevo_celular text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.perfiles
    set nickname = coalesce(nullif(trim(nuevo_nickname), ''), nickname),
        celular = nuevo_celular
    where id = auth.uid();
end;
$$;

grant execute on function public.actualizar_mi_perfil(text, text) to authenticated;

-- Vista de solo lectura para el Table Editor: junta perfiles con el correo
-- real de auth.users, para no tener que ir a Authentication -> Users cada
-- vez. security_invoker=true para que respete los permisos de quien
-- consulta — no se otorga acceso a anon/authenticated, así que solo la ve
-- quien entra al panel de Supabase como dueño del proyecto.
create view public.perfiles_admin
with (security_invoker = true)
as
select
  p.id,
  p.nickname,
  p.celular,
  p.saldo,
  p.created_at,
  u.email,
  u.email_confirmed_at,
  u.last_sign_in_at
from public.perfiles p
join auth.users u on u.id = p.id
order by p.created_at desc;

-- ---------- CATÁLOGO: paquetes de Free Fire ----------
-- Cuatro catálogos, cada uno con sus propios paquetes:
-- "ilimitada" (Recargas Ilimitadas) y "promo" (Promo Primera Vez) — diamantes,
-- mismos tamaños y precios distintos entre sí.
-- "cajas_tokens" (Cajas de Tokens) y "tokens_evolutivos" (Tokens Evolutivos) —
-- pendientes de que el cliente defina sus paquetes y precios reales.
-- "cantidad" es genérico (diamantes, cajas, tokens...); "unidad" es la
-- etiqueta que se muestra junto a esa cantidad en la web.
create table public.paquetes_ff (
  id serial primary key,
  nombre text not null,
  cantidad integer not null,
  precio numeric(10,2) not null,
  categoria text not null default 'ilimitada' check (categoria in ('ilimitada', 'promo', 'cajas_tokens', 'tokens_evolutivos')),
  unidad text not null default 'Diamantes',
  destacado boolean not null default false,
  activo boolean not null default true,
  orden integer not null default 0
);

alter table public.paquetes_ff enable row level security;

create policy "select_paquetes_activos" on public.paquetes_ff
  for select using (activo = true);

grant select on public.paquetes_ff to anon, authenticated;

insert into public.paquetes_ff (nombre, cantidad, precio, categoria, unidad, destacado, orden) values
  ('100 Diamantes',  100,  3.00,   'ilimitada', 'Diamantes', false, 1),
  ('300 Diamantes',  300,  10.00,  'ilimitada', 'Diamantes', false, 2),
  ('500 Diamantes',  500,  15.00,  'ilimitada', 'Diamantes', false, 3),
  ('1000 Diamantes', 1000, 28.00,  'ilimitada', 'Diamantes', true,  4),
  ('2000 Diamantes', 2000, 50.00,  'ilimitada', 'Diamantes', false, 5),
  ('6000 Diamantes', 6000, 130.00, 'ilimitada', 'Diamantes', false, 6),
  ('100 Diamantes',  100,  2.00,   'promo', 'Diamantes', false, 1),
  ('300 Diamantes',  300,  8.00,   'promo', 'Diamantes', false, 2),
  ('500 Diamantes',  500,  12.00,  'promo', 'Diamantes', false, 3),
  ('1000 Diamantes', 1000, 25.00,  'promo', 'Diamantes', true,  4),
  ('2000 Diamantes', 2000, 45.00,  'promo', 'Diamantes', false, 5),
  ('6000 Diamantes', 6000, 110.00, 'promo', 'Diamantes', false, 6),
  ('200 Fragmentos', 200, 22.00, 'tokens_evolutivos', 'Fragmentos', false, 1),
  ('300 Fragmentos', 300, 32.00, 'tokens_evolutivos', 'Fragmentos', false, 2),
  ('400 Fragmentos', 400, 40.00, 'tokens_evolutivos', 'Fragmentos', false, 3),
  ('500 Fragmentos', 500, 48.00, 'tokens_evolutivos', 'Fragmentos', true,  4),
  ('600 Fragmentos', 600, 55.00, 'tokens_evolutivos', 'Fragmentos', false, 5),
  ('700 Fragmentos', 700, 62.00, 'tokens_evolutivos', 'Fragmentos', false, 6),
  ('800 Fragmentos', 800, 68.00, 'tokens_evolutivos', 'Fragmentos', false, 7),
  ('900 Fragmentos', 900, 75.00, 'tokens_evolutivos', 'Fragmentos', false, 8);
  -- 'cajas_tokens': agregar filas aquí (unidad 'Cajas') en cuanto el cliente
  -- mande los tamaños y precios reales.

-- ---------- PEDIDOS (recargas de saldo y compras de diamantes) ----------
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  tipo text not null check (tipo in ('recarga_saldo', 'compra_diamantes')),
  paquete_id integer references public.paquetes_ff(id),
  id_jugador_ff text,
  monto numeric(10,2) not null check (monto > 0),
  metodo_pago text not null default 'yape',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmado', 'completado', 'cancelado')),
  nota_admin text,
  created_at timestamptz not null default now()
);

alter table public.pedidos enable row level security;

create policy "select_mis_pedidos" on public.pedidos
  for select using (auth.uid() = usuario_id);

create policy "insertar_mis_pedidos" on public.pedidos
  for insert with check (auth.uid() = usuario_id);

grant select, insert on public.pedidos to authenticated;

-- Nadie puede actualizar pedidos desde el sitio — los estados los
-- cambia el dueño a mano desde Table Editor (esa conexión sí
-- salta el RLS), y el trigger de abajo reacciona a ese cambio.

-- Al insertar un pedido:
--  - "recarga_saldo": queda pendiente, no toca el saldo todavía
--    (se acredita cuando el dueño confirma el pago, ver trigger
--    de abajo).
--  - "compra_diamantes": se paga al instante con el saldo del
--    usuario (como en la web de referencia). Si no le alcanza,
--    se rechaza. Si alcanza, se descuenta y el pedido queda
--    "confirmado" (pagado), a la espera de que el dueño entregue
--    los diamantes en el juego y lo marque "completado".
create function public.procesar_nuevo_pedido()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  saldo_actual numeric(10,2);
begin
  if new.tipo = 'compra_diamantes' then
    if new.id_jugador_ff is null or length(trim(new.id_jugador_ff)) = 0 then
      raise exception 'Falta el ID del jugador de Free Fire';
    end if;

    select saldo into saldo_actual
      from public.perfiles where id = new.usuario_id for update;

    if saldo_actual < new.monto then
      raise exception 'Saldo insuficiente. Recarga tu saldo antes de comprar.';
    end if;

    update public.perfiles
      set saldo = saldo - new.monto,
          puntos = puntos + floor(new.monto)::integer
      where id = new.usuario_id;
    new.estado := 'confirmado';
  end if;

  return new;
end;
$$;

create trigger before_insert_pedido
  before insert on public.pedidos
  for each row execute function public.procesar_nuevo_pedido();

-- Cuando el dueño marca una "recarga_saldo" como "confirmado"
-- (desde Table Editor, tras revisar el Yape/Plin), se acredita
-- el saldo al usuario. Se fija con "is distinct from" para que
-- no se vuelva a acreditar si el dueño la guarda de nuevo.
create function public.acreditar_recarga_confirmada()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.tipo = 'recarga_saldo'
     and new.estado = 'confirmado'
     and old.estado is distinct from 'confirmado' then
    update public.perfiles
      set saldo = saldo + new.monto,
          puntos = puntos + floor(new.monto)::integer
      where id = new.usuario_id;
  end if;
  return new;
end;
$$;

create trigger after_update_pedido
  after update on public.pedidos
  for each row execute function public.acreditar_recarga_confirmada();

-- ---------- PANEL DE ADMINISTRACIÓN (admin.html) ----------
-- Bandera de administrador en el propio perfil. La política de SELECT
-- ya existente ("select_propio_perfil") deja que cada quien lea su
-- propia fila, así que el sitio puede leer "es_admin" al iniciar
-- sesión sin necesidad de una policy nueva.
alter table public.perfiles add column es_admin boolean not null default false;

-- Marca como admin a la cuenta dueña de la tienda. Cambia el id por
-- el de la cuenta real si hace falta (select id from auth.users
-- where email = '...').
update public.perfiles set es_admin = true where id = 'ffe9a4e3-27e5-46ef-8ce3-f1566401ebff';

-- Chequeo reutilizable de "¿el que está pidiendo esto es admin?".
-- security definer para no chocar con RLS al leer perfiles.
create function public.es_admin_actual()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select es_admin from public.perfiles where id = auth.uid()), false);
$$;

-- Listar pedidos (de todos los usuarios), con filtro opcional por estado.
create function public.admin_listar_pedidos(p_estado text default null)
returns table (
  id uuid,
  created_at timestamptz,
  tipo text,
  estado text,
  monto numeric,
  metodo_pago text,
  id_jugador_ff text,
  nota_admin text,
  usuario_id uuid,
  nickname text,
  correo text,
  paquete_nombre text
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select pe.id, pe.created_at, pe.tipo, pe.estado, pe.monto, pe.metodo_pago,
           pe.id_jugador_ff, pe.nota_admin, pe.usuario_id,
           pf.nickname, u.email::text, pa.nombre
    from public.pedidos pe
    join public.perfiles pf on pf.id = pe.usuario_id
    join auth.users u on u.id = pe.usuario_id
    left join public.paquetes_ff pa on pa.id = pe.paquete_id
    where p_estado is null or pe.estado = p_estado
    order by pe.created_at desc;
end;
$$;

-- Cambiar el estado de un pedido (y opcionalmente la nota) — dispara
-- el mismo trigger de acreditación que ya existía para Table Editor.
create function public.admin_actualizar_pedido(p_id uuid, p_estado text, p_nota text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  update public.pedidos
    set estado = p_estado,
        nota_admin = coalesce(p_nota, nota_admin)
    where id = p_id;
end;
$$;

-- Listar usuarios registrados con su correo (mismo dato que perfiles_admin,
-- pero accesible desde el sitio para quien sea admin).
create function public.admin_listar_usuarios()
returns table (
  id uuid,
  nickname text,
  celular text,
  saldo numeric,
  created_at timestamptz,
  correo text
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select p.id, p.nickname, p.celular, p.saldo, p.created_at, u.email::text
    from public.perfiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

-- Listar TODOS los paquetes (incluye inactivos, a diferencia de la
-- policy pública que solo deja ver "activo = true").
create function public.admin_listar_paquetes()
returns table (
  id integer,
  nombre text,
  cantidad integer,
  precio numeric,
  categoria text,
  unidad text,
  destacado boolean,
  activo boolean,
  orden integer
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select pa.id, pa.nombre, pa.cantidad, pa.precio, pa.categoria, pa.unidad, pa.destacado, pa.activo, pa.orden
    from public.paquetes_ff pa
    order by pa.categoria, pa.orden;
end;
$$;

-- Crear o editar un paquete (p_id null = crear nuevo). Devuelve el id.
create function public.admin_guardar_paquete(
  p_id integer,
  p_nombre text,
  p_cantidad integer,
  p_precio numeric,
  p_categoria text,
  p_unidad text,
  p_destacado boolean,
  p_activo boolean,
  p_orden integer
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  nuevo_id integer;
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  if p_id is null then
    insert into public.paquetes_ff (nombre, cantidad, precio, categoria, unidad, destacado, activo, orden)
    values (p_nombre, p_cantidad, p_precio, p_categoria, p_unidad, p_destacado, p_activo, p_orden)
    returning id into nuevo_id;
  else
    update public.paquetes_ff
      set nombre = p_nombre, cantidad = p_cantidad, precio = p_precio, categoria = p_categoria,
          unidad = p_unidad, destacado = p_destacado, activo = p_activo, orden = p_orden
      where id = p_id;
    nuevo_id := p_id;
  end if;

  return nuevo_id;
end;
$$;

-- Números rápidos para la portada del panel.
create function public.admin_estadisticas()
returns table (
  pedidos_pendientes bigint,
  pedidos_por_entregar bigint,
  total_usuarios bigint,
  saldo_total numeric
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select
      (select count(*) from public.pedidos where tipo = 'recarga_saldo' and estado = 'pendiente'),
      (select count(*) from public.pedidos where tipo = 'compra_diamantes' and estado = 'confirmado'),
      (select count(*) from public.perfiles),
      (select coalesce(sum(saldo), 0) from public.perfiles);
end;
$$;

-- Postgres otorga EXECUTE a PUBLIC (incluye "anon") en toda función
-- nueva por defecto. Cada función de arriba ya se protege sola con
-- es_admin_actual(), pero además nadie sin sesión debería ni poder
-- intentarlo, y es_admin_actual() no necesita ser invocable directo
-- desde el sitio (solo la usan las otras funciones, internamente).
revoke execute on function public.es_admin_actual() from public;
revoke execute on function public.admin_listar_pedidos(text) from public;
revoke execute on function public.admin_actualizar_pedido(uuid, text, text) from public;
revoke execute on function public.admin_listar_usuarios() from public;
revoke execute on function public.admin_listar_paquetes() from public;
revoke execute on function public.admin_guardar_paquete(integer, text, integer, numeric, text, text, boolean, boolean, integer) from public;
revoke execute on function public.admin_estadisticas() from public;

grant execute on function public.admin_listar_pedidos(text) to authenticated;
grant execute on function public.admin_actualizar_pedido(uuid, text, text) to authenticated;
grant execute on function public.admin_listar_usuarios() to authenticated;
grant execute on function public.admin_listar_paquetes() to authenticated;
grant execute on function public.admin_guardar_paquete(integer, text, integer, numeric, text, text, boolean, boolean, integer) to authenticated;
grant execute on function public.admin_estadisticas() to authenticated;

-- ---------- PUNTOS DE FIDELIDAD, RANKING Y COMPRAS EN VIVO ----------
-- 1 punto por cada sol pagado de verdad. Se otorgan dentro de
-- procesar_nuevo_pedido() y acreditar_recarga_confirmada() (ver arriba),
-- en el mismo momento en que se reconoce el pago.
alter table public.perfiles add column puntos integer not null default 0;

-- Ranking público de compradores (nickname + puntos nada más, nunca
-- correo/saldo/celular). security definer porque perfiles solo deja ver
-- la fila propia por RLS.
create function public.obtener_ranking(p_limite integer default 10)
returns table (nickname text, puntos integer)
language sql
security definer set search_path = public
stable
as $$
  select nickname, puntos
  from public.perfiles
  where puntos > 0
  order by puntos desc, created_at asc
  limit greatest(1, least(coalesce(p_limite, 10), 50));
$$;

grant execute on function public.obtener_ranking(integer) to anon, authenticated;

-- Feed público de compras recientes, con el nickname parcialmente oculto
-- (server-side, para no exponer el nickname completo nunca).
create function public.compras_recientes(p_limite integer default 12)
returns table (nickname text, texto text, creado_hace timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select
    left(pf.nickname, 2) || repeat('*', greatest(length(pf.nickname) - 2, 2)),
    case
      when pe.tipo = 'recarga_saldo' then 'recargó S/ ' || to_char(pe.monto, 'FM999999990.00')
      else 'compró ' || coalesce(pa.nombre, 'un paquete')
    end,
    pe.created_at
  from public.pedidos pe
  join public.perfiles pf on pf.id = pe.usuario_id
  left join public.paquetes_ff pa on pa.id = pe.paquete_id
  where pe.estado in ('confirmado', 'completado')
  order by pe.created_at desc
  limit greatest(1, least(coalesce(p_limite, 12), 30));
$$;

grant execute on function public.compras_recientes(integer) to anon, authenticated;

-- ---------- PROMO DEL DÍA (diamantes) ----------
-- Una sola oferta activa a la vez, elegida por el admin sobre un paquete
-- real de "Recargas Ilimitadas" o "Promo Primera Vez" — así el ID del
-- paquete sigue siendo válido para el pedido, solo se cobra el precio
-- especial en vez del precio de lista.
create table public.promo_diamantes (
  id integer primary key default 1 check (id = 1),
  paquete_id integer references public.paquetes_ff(id),
  precio_promo numeric(10,2),
  activo boolean not null default false,
  actualizado_at timestamptz not null default now()
);

insert into public.promo_diamantes (id, activo) values (1, false);

alter table public.promo_diamantes enable row level security;
-- Sin policies ni grants directos a la tabla: todo pasa por las funciones
-- de abajo, para no filtrar la fila cuando está inactiva.

create function public.obtener_promo_del_dia()
returns table (
  paquete_id integer,
  nombre text,
  cantidad integer,
  unidad text,
  categoria text,
  precio_original numeric,
  precio_promo numeric
)
language sql
security definer set search_path = public
stable
as $$
  select pa.id, pa.nombre, pa.cantidad, pa.unidad, pa.categoria, pa.precio, pr.precio_promo
  from public.promo_diamantes pr
  join public.paquetes_ff pa on pa.id = pr.paquete_id
  where pr.id = 1 and pr.activo = true and pa.activo = true;
$$;

grant execute on function public.obtener_promo_del_dia() to anon, authenticated;

create function public.admin_obtener_promo()
returns table (paquete_id integer, precio_promo numeric, activo boolean)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query select pr.paquete_id, pr.precio_promo, pr.activo from public.promo_diamantes pr where pr.id = 1;
end;
$$;

create function public.admin_guardar_promo(p_paquete_id integer, p_precio_promo numeric, p_activo boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  update public.promo_diamantes
    set paquete_id = p_paquete_id,
        precio_promo = p_precio_promo,
        activo = p_activo,
        actualizado_at = now()
    where id = 1;
end;
$$;

revoke execute on function public.admin_obtener_promo() from public;
revoke execute on function public.admin_guardar_promo(integer, numeric, boolean) from public;
grant execute on function public.admin_obtener_promo() to authenticated;
grant execute on function public.admin_guardar_promo(integer, numeric, boolean) to authenticated;

-- ---------- PROGRAMA DE REFERIDOS ----------
-- Código corto propio de cada cuenta (para compartir en el link) y a quién
-- refirió, si vino de un link de invitación (register.html?ref=CODIGO).
alter table public.perfiles add column codigo_referido text unique;
alter table public.perfiles add column referido_por uuid references public.perfiles(id);

-- Reemplaza la versión original de más arriba: ahora también genera el
-- código corto y guarda quién invitó (register.html manda el código como
-- metadata "ref" al registrarse).
create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_codigo text;
  v_referido_por uuid;
begin
  loop
    v_codigo := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.perfiles where codigo_referido = v_codigo);
  end loop;

  select id into v_referido_por from public.perfiles
    where codigo_referido = upper(coalesce(new.raw_user_meta_data->>'ref', ''))
    limit 1;

  insert into public.perfiles (id, nickname, codigo_referido, referido_por)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1)),
    v_codigo,
    v_referido_por
  );
  return new;
end;
$$;

-- Bono de referidos: +20 puntos para el referido y +20 para quien lo invitó,
-- pero solo la PRIMERA vez que el referido tiene un pago de verdad (recarga
-- confirmada o compra) — así no se puede farmear solo creando cuentas.
-- No tiene GRANT a nadie a propósito: solo la deben llamar los triggers de
-- abajo (si un cliente pudiera llamarla directo por la API, cualquiera se
-- podría regalar puntos pasando cualquier usuario_id/pedido_id).
create function public.otorgar_bono_referido(p_usuario_id uuid, p_pedido_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_referido_por uuid;
  v_tuvo_otro_pago boolean;
begin
  select referido_por into v_referido_por from public.perfiles where id = p_usuario_id;
  if v_referido_por is null then
    return;
  end if;

  select exists(
    select 1 from public.pedidos
    where usuario_id = p_usuario_id and estado in ('confirmado', 'completado') and id <> p_pedido_id
  ) into v_tuvo_otro_pago;

  if v_tuvo_otro_pago then
    return;
  end if;

  update public.perfiles set puntos = puntos + 20 where id = p_usuario_id;
  update public.perfiles set puntos = puntos + 20 where id = v_referido_por;
end;
$$;

revoke execute on function public.otorgar_bono_referido(uuid, uuid) from public;

-- Reemplaza las versiones de más arriba: además de sumar los puntos
-- normales, engancha el bono de referidos en los mismos dos momentos.
create or replace function public.procesar_nuevo_pedido()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  saldo_actual numeric(10,2);
begin
  if new.tipo = 'compra_diamantes' then
    if new.id_jugador_ff is null or length(trim(new.id_jugador_ff)) = 0 then
      raise exception 'Falta el ID del jugador de Free Fire';
    end if;

    select saldo into saldo_actual
      from public.perfiles where id = new.usuario_id for update;

    if saldo_actual < new.monto then
      raise exception 'Saldo insuficiente. Recarga tu saldo antes de comprar.';
    end if;

    update public.perfiles
      set saldo = saldo - new.monto,
          puntos = puntos + floor(new.monto)::integer
      where id = new.usuario_id;
    new.estado := 'confirmado';

    perform public.otorgar_bono_referido(new.usuario_id, new.id);
  end if;

  return new;
end;
$$;

create or replace function public.acreditar_recarga_confirmada()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.tipo = 'recarga_saldo'
     and new.estado = 'confirmado'
     and old.estado is distinct from 'confirmado' then
    update public.perfiles
      set saldo = saldo + new.monto,
          puntos = puntos + floor(new.monto)::integer
      where id = new.usuario_id;

    perform public.otorgar_bono_referido(new.usuario_id, new.id);
  end if;
  return new;
end;
$$;

-- ---------- CATÁLOGO DE CUENTAS DE FREE FIRE ----------
-- Cada cuenta es única (una sola unidad): se publica desde admin.html y,
-- cuando alguien la compra, queda "agotado" en el mismo instante.
create table public.cuentas_ff (
  id serial primary key,
  titulo text not null check (length(trim(titulo)) > 0),
  descripcion text not null default '',
  precio numeric(10,2) not null check (precio > 0),
  estado text not null default 'disponible' check (estado in ('disponible', 'agotado')),
  created_at timestamptz not null default now()
);

alter table public.cuentas_ff enable row level security;

create policy "ver_cuentas" on public.cuentas_ff for select using (true);

-- Solo lectura pública y solo de estas columnas; todo lo demás (crear,
-- editar, vender) pasa por las funciones de más abajo.
revoke all on public.cuentas_ff from anon, authenticated;
grant select (id, titulo, descripcion, precio, estado, created_at) on public.cuentas_ff to anon, authenticated;

-- Los pedidos ahora pueden ser de tipo "compra_cuenta" y guardan qué cuenta fue.
alter table public.pedidos drop constraint pedidos_tipo_check;
alter table public.pedidos add constraint pedidos_tipo_check
  check (tipo in ('recarga_saldo', 'compra_diamantes', 'compra_cuenta'));
alter table public.pedidos add column cuenta_id integer references public.cuentas_ff(id) on delete set null;

-- Desde el sitio solo se pueden insertar recargas y compras de diamantes
-- directo; las compras de cuentas SOLO por comprar_cuenta() (así el precio
-- sale de la base de datos y no de lo que mande el navegador).
drop policy "insertar_mis_pedidos" on public.pedidos;
create policy "insertar_mis_pedidos" on public.pedidos
  for insert with check (auth.uid() = usuario_id and tipo in ('recarga_saldo', 'compra_diamantes'));

-- Compra de una cuenta con saldo. Todo en una sola transacción y con la fila
-- de la cuenta bloqueada: si dos personas le dan "Comprar" a la vez, la
-- segunda recibe "ya no está disponible" en vez de venderse dos veces.
create function public.comprar_cuenta(p_cuenta_id integer)
returns table (pedido_id uuid, titulo text, precio numeric)
language plpgsql
security definer set search_path = public
as $$
declare
  v_cuenta public.cuentas_ff%rowtype;
  v_saldo numeric(10,2);
  v_pedido uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para comprar';
  end if;

  select * into v_cuenta from public.cuentas_ff where id = p_cuenta_id for update;
  if not found then
    raise exception 'Esta cuenta no existe';
  end if;
  if v_cuenta.estado <> 'disponible' then
    raise exception 'Esta cuenta ya no está disponible';
  end if;

  select saldo into v_saldo from public.perfiles where id = auth.uid() for update;
  if v_saldo is null then
    raise exception 'No se encontró tu perfil';
  end if;
  if v_saldo < v_cuenta.precio then
    raise exception 'Saldo insuficiente. Recarga tu saldo antes de comprar.';
  end if;

  update public.perfiles
    set saldo = saldo - v_cuenta.precio,
        puntos = puntos + floor(v_cuenta.precio)::integer
    where id = auth.uid();

  insert into public.pedidos (usuario_id, tipo, cuenta_id, monto, metodo_pago, estado, nota_admin)
  values (auth.uid(), 'compra_cuenta', v_cuenta.id, v_cuenta.precio, 'saldo', 'confirmado', 'Cuenta: ' || v_cuenta.titulo)
  returning id into v_pedido;

  update public.cuentas_ff set estado = 'agotado' where id = v_cuenta.id;

  perform public.otorgar_bono_referido(auth.uid(), v_pedido);

  return query select v_pedido, v_cuenta.titulo, v_cuenta.precio;
end;
$$;

revoke execute on function public.comprar_cuenta(integer) from public;
grant execute on function public.comprar_cuenta(integer) to authenticated;

-- Admin: listar, crear/editar y eliminar cuentas.
create function public.admin_listar_cuentas()
returns table (
  id integer,
  titulo text,
  descripcion text,
  precio numeric,
  estado text,
  created_at timestamptz
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select c.id, c.titulo, c.descripcion, c.precio, c.estado, c.created_at
    from public.cuentas_ff c
    order by (c.estado = 'disponible') desc, c.id desc;
end;
$$;

-- Crear (p_id null) o editar una cuenta. Devuelve el id.
create function public.admin_guardar_cuenta(
  p_id integer,
  p_titulo text,
  p_descripcion text,
  p_precio numeric,
  p_estado text
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_id integer;
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  if p_titulo is null or length(trim(p_titulo)) = 0 then
    raise exception 'Falta el título de la cuenta';
  end if;
  if p_precio is null or p_precio <= 0 then
    raise exception 'El precio debe ser mayor a 0';
  end if;

  if p_id is null then
    insert into public.cuentas_ff (titulo, descripcion, precio, estado)
    values (trim(p_titulo), coalesce(p_descripcion, ''), p_precio, coalesce(p_estado, 'disponible'))
    returning id into v_id;
  else
    update public.cuentas_ff
      set titulo = trim(p_titulo),
          descripcion = coalesce(p_descripcion, ''),
          precio = p_precio,
          estado = coalesce(p_estado, estado)
      where id = p_id;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;

-- Eliminar solo si nunca se vendió (una vendida queda como historial: se
-- marca "agotado" y listo).
create function public.admin_eliminar_cuenta(p_id integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  if exists (select 1 from public.pedidos where cuenta_id = p_id) then
    raise exception 'Esta cuenta ya tiene una compra registrada; márcala como agotada en vez de eliminarla';
  end if;
  delete from public.cuentas_ff where id = p_id;
end;
$$;

revoke execute on function public.admin_listar_cuentas() from public;
revoke execute on function public.admin_guardar_cuenta(integer, text, text, numeric, text) from public;
revoke execute on function public.admin_eliminar_cuenta(integer) from public;
grant execute on function public.admin_listar_cuentas() to authenticated;
grant execute on function public.admin_guardar_cuenta(integer, text, text, numeric, text) to authenticated;
grant execute on function public.admin_eliminar_cuenta(integer) to authenticated;

-- Reemplazan las versiones de más arriba para que contemplen las cuentas:
-- el ticker decía "compró un paquete" y el resumen del admin no contaba las
-- cuentas pagadas por entregar.
create or replace function public.compras_recientes(p_limite integer default 12)
returns table (nickname text, texto text, creado_hace timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select
    left(pf.nickname, 2) || repeat('*', greatest(length(pf.nickname) - 2, 2)),
    case
      when pe.tipo = 'recarga_saldo' then 'recargó S/ ' || to_char(pe.monto, 'FM999999990.00')
      when pe.tipo = 'compra_cuenta' then 'compró una cuenta de Free Fire'
      else 'compró ' || coalesce(pa.nombre, 'un paquete')
    end,
    pe.created_at
  from public.pedidos pe
  join public.perfiles pf on pf.id = pe.usuario_id
  left join public.paquetes_ff pa on pa.id = pe.paquete_id
  where pe.estado in ('confirmado', 'completado')
  order by pe.created_at desc
  limit greatest(1, least(coalesce(p_limite, 12), 30));
$$;

create or replace function public.admin_estadisticas()
returns table (
  pedidos_pendientes bigint,
  pedidos_por_entregar bigint,
  total_usuarios bigint,
  saldo_total numeric
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select
      (select count(*) from public.pedidos where tipo = 'recarga_saldo' and estado = 'pendiente'),
      (select count(*) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado = 'confirmado'),
      (select count(*) from public.perfiles),
      (select coalesce(sum(saldo), 0) from public.perfiles);
end;
$$;

-- ---------- PRECIO VALIDADO EN EL SERVIDOR ----------
-- Antes, el trigger descontaba el "monto" que mandara el navegador sin
-- compararlo con el precio real: alguien con sesión podía comprar un paquete
-- caro mandando monto 0.01. Ahora el precio se valida contra la base de datos
-- (los clientes legítimos mandan exactamente estos precios, así que siguen
-- funcionando igual). Reemplaza la versión de más arriba.
create or replace function public.procesar_nuevo_pedido()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  saldo_actual numeric(10,2);
  v_paquete public.paquetes_ff%rowtype;
  v_precio_valido boolean;
  v_cantidad integer;
begin
  if new.tipo = 'compra_diamantes' then
    if new.id_jugador_ff is null or length(trim(new.id_jugador_ff)) = 0 then
      raise exception 'Falta el ID del jugador de Free Fire';
    end if;

    if new.paquete_id is not null then
      -- Paquete normal: el monto tiene que ser el precio de lista, o el precio
      -- de la promo del día si esa promo está activa y es justo ese paquete.
      select * into v_paquete from public.paquetes_ff where id = new.paquete_id;
      if not found or not v_paquete.activo then
        raise exception 'Este paquete ya no está disponible';
      end if;

      v_precio_valido := (new.monto = v_paquete.precio);
      if not v_precio_valido then
        select coalesce(pr.activo and pr.paquete_id = new.paquete_id and pr.precio_promo = new.monto, false)
          into v_precio_valido
          from public.promo_diamantes pr where pr.id = 1;
        v_precio_valido := coalesce(v_precio_valido, false);
      end if;
      if not v_precio_valido then
        raise exception 'El precio de este paquete cambió. Recarga la página e inténtalo de nuevo.';
      end if;
    else
      -- Cantidad exacta (solo Cajas de Tokens): S/ 0.48 por caja, mínimo 20.
      -- La cantidad viaja en nota_admin ("Cantidad personalizada: N Cajas Evolutivas")
      -- y el monto tiene que cuadrar exactamente con esa cantidad.
      if new.nota_admin is null or new.nota_admin !~ '^Cantidad personalizada: [0-9]{1,6} Cajas Evolutivas$' then
        raise exception 'Compra no válida';
      end if;
      v_cantidad := substring(new.nota_admin from '^Cantidad personalizada: ([0-9]{1,6}) Cajas Evolutivas$')::integer;
      if v_cantidad < 20 or new.monto <> round(v_cantidad * 0.48, 2) then
        raise exception 'Compra no válida';
      end if;
    end if;

    select saldo into saldo_actual
      from public.perfiles where id = new.usuario_id for update;

    if saldo_actual < new.monto then
      raise exception 'Saldo insuficiente. Recarga tu saldo antes de comprar.';
    end if;

    update public.perfiles
      set saldo = saldo - new.monto,
          puntos = puntos + floor(new.monto)::integer
      where id = new.usuario_id;
    new.estado := 'confirmado';

    perform public.otorgar_bono_referido(new.usuario_id, new.id);
  end if;

  return new;
end;
$$;

-- ---------- REEMBOLSO AL CANCELAR UNA COMPRA YA COBRADA ----------
-- Si el admin cancela una compra (diamantes o cuenta) que estaba "confirmada"
-- (cobrada, pero aún sin entregar), se le devuelve el saldo al cliente y se le
-- quitan los puntos que había ganado por esa compra. (El bono de referidos
-- ya otorgado no se revierte.) Reemplaza la versión de más arriba.
create or replace function public.acreditar_recarga_confirmada()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.tipo = 'recarga_saldo'
     and new.estado = 'confirmado'
     and old.estado is distinct from 'confirmado' then
    update public.perfiles
      set saldo = saldo + new.monto,
          puntos = puntos + floor(new.monto)::integer
      where id = new.usuario_id;

    perform public.otorgar_bono_referido(new.usuario_id, new.id);

  elsif new.tipo in ('compra_diamantes', 'compra_cuenta')
        and old.estado = 'confirmado'
        and new.estado = 'cancelado' then
    update public.perfiles
      set saldo = saldo + new.monto,
          puntos = greatest(0, puntos - floor(new.monto)::integer)
      where id = new.usuario_id;
  end if;
  return new;
end;
$$;

-- ---------- ESTADOS DE UN PEDIDO: SOLO TRANSICIONES VÁLIDAS ----------
-- pendiente -> confirmado | cancelado,  confirmado -> completado | cancelado.
-- "completado" y "cancelado" son finales. Sin esto, un pedido se podía volver a
-- "pendiente"/"confirmado" y acreditar (o devolver) el saldo dos veces.
-- Reemplaza la versión de más arriba.
create or replace function public.admin_actualizar_pedido(p_id uuid, p_estado text, p_nota text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_actual text;
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  if p_estado is null then
    raise exception 'Falta el estado del pedido';
  end if;

  select estado into v_actual from public.pedidos where id = p_id for update;
  if not found then
    raise exception 'Ese pedido no existe';
  end if;

  if p_estado <> v_actual and not (
       (v_actual = 'pendiente'  and p_estado in ('confirmado', 'cancelado'))
    or (v_actual = 'confirmado' and p_estado in ('completado', 'cancelado'))
  ) then
    raise exception 'No se puede pasar un pedido de "%" a "%"', v_actual, p_estado;
  end if;

  update public.pedidos
    set estado = p_estado,
        nota_admin = coalesce(p_nota, nota_admin)
    where id = p_id;
end;
$$;

-- ---------- INSERCIÓN DIRECTA DESDE EL SITIO, MÁS ESTRICTA ----------
-- Solo recargas "pendientes" (las confirma el admin) o compras de diamantes
-- (que valida el trigger de arriba), y sin colgarse de una cuenta ajena.
-- Reemplaza la policy de más arriba.
drop policy "insertar_mis_pedidos" on public.pedidos;
create policy "insertar_mis_pedidos" on public.pedidos
  for insert with check (
    auth.uid() = usuario_id
    and cuenta_id is null
    and (
      (tipo = 'recarga_saldo' and estado = 'pendiente')
      or tipo = 'compra_diamantes'
    )
  );


-- ---------- CONSTANCIA DE ACEPTACIÓN DE TÉRMINOS Y PRIVACIDAD ----------
-- register.html exige marcar la casilla y manda la versión vigente como
-- metadata "version_terminos". La fecha la pone el servidor (now()), no el
-- navegador, para que el consentimiento se pueda demostrar. Las cuentas
-- creadas antes de esto quedan con estas dos columnas en null.
alter table public.perfiles add column acepto_terminos_at timestamptz;
alter table public.perfiles add column version_terminos text;

create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_codigo text;
  v_referido_por uuid;
  v_version text;
begin
  loop
    v_codigo := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.perfiles where codigo_referido = v_codigo);
  end loop;

  select id into v_referido_por from public.perfiles
    where codigo_referido = upper(coalesce(new.raw_user_meta_data->>'ref', ''))
    limit 1;

  -- La fecha la pone el servidor; del cliente solo viene la versión (se
  -- recorta a 20 caracteres y solo se guarda si realmente la mandó).
  v_version := nullif(left(trim(coalesce(new.raw_user_meta_data->>'version_terminos', '')), 20), '');

  insert into public.perfiles (id, nickname, codigo_referido, referido_por, acepto_terminos_at, version_terminos)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1)),
    v_codigo,
    v_referido_por,
    case when v_version is not null then now() end,
    v_version
  );
  return new;
end;
$$;


-- ---------- FOTOS DE LAS CUENTAS ----------
-- Bucket público (cualquiera puede VER las fotos por su URL), pero solo el
-- admin puede subir, reemplazar o borrar. Se guarda en cada cuenta la lista
-- de nombres de archivo (la primera es la portada), no la URL completa.
-- Nota: es_admin_actual() no tiene EXECUTE para "authenticated" a propósito,
-- así que las políticas consultan el perfil propio directamente.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cuentas', 'cuentas', true, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "cuentas_fotos_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cuentas' and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.es_admin));
create policy "cuentas_fotos_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'cuentas' and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.es_admin));
create policy "cuentas_fotos_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'cuentas' and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.es_admin))
  with check (bucket_id = 'cuentas' and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.es_admin));
create policy "cuentas_fotos_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cuentas' and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.es_admin));

alter table public.cuentas_ff add column fotos text[] not null default '{}'
  check (cardinality(fotos) <= 8);
grant select (fotos) on public.cuentas_ff to anon, authenticated;

-- Cambian de firma/retorno, así que se recrean.
drop function public.admin_listar_cuentas();
drop function public.admin_guardar_cuenta(integer, text, text, numeric, text);

create function public.admin_listar_cuentas()
returns table (
  id integer,
  titulo text,
  descripcion text,
  precio numeric,
  estado text,
  created_at timestamptz,
  fotos text[]
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select c.id, c.titulo, c.descripcion, c.precio, c.estado, c.created_at, c.fotos
    from public.cuentas_ff c
    order by (c.estado = 'disponible') desc, c.id desc;
end;
$$;

-- p_fotos null = no tocar las fotos que ya tiene. Solo se aceptan nombres de
-- archivo simples (nada de URLs ni rutas), máximo 8.
create function public.admin_guardar_cuenta(
  p_id integer,
  p_titulo text,
  p_descripcion text,
  p_precio numeric,
  p_estado text,
  p_fotos text[] default null
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_id integer;
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  if p_titulo is null or length(trim(p_titulo)) = 0 then
    raise exception 'Falta el título de la cuenta';
  end if;
  if p_precio is null or p_precio <= 0 then
    raise exception 'El precio debe ser mayor a 0';
  end if;
  if p_fotos is not null then
    if cardinality(p_fotos) > 8 then
      raise exception 'Máximo 8 fotos por cuenta';
    end if;
    if exists (select 1 from unnest(p_fotos) f where f is null or f !~ '^[A-Za-z0-9._-]{1,100}$') then
      raise exception 'Foto no válida';
    end if;
  end if;

  if p_id is null then
    insert into public.cuentas_ff (titulo, descripcion, precio, estado, fotos)
    values (trim(p_titulo), coalesce(p_descripcion, ''), p_precio, coalesce(p_estado, 'disponible'), coalesce(p_fotos, '{}'))
    returning id into v_id;
  else
    update public.cuentas_ff
      set titulo = trim(p_titulo),
          descripcion = coalesce(p_descripcion, ''),
          precio = p_precio,
          estado = coalesce(p_estado, estado),
          fotos = coalesce(p_fotos, fotos)
      where id = p_id;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.admin_listar_cuentas() from public;
revoke execute on function public.admin_guardar_cuenta(integer, text, text, numeric, text, text[]) from public;
grant execute on function public.admin_listar_cuentas() to authenticated;
grant execute on function public.admin_guardar_cuenta(integer, text, text, numeric, text, text[]) to authenticated;


-- ---------- ESTADO DE LOS CATÁLOGOS, STOCK DE PAQUETES Y RESUMEN DEL ADMIN ----------
-- Cada catálogo se puede ocultar, poner en mantenimiento o marcar sin stock (con un
-- mensaje opcional para el cliente), y cada paquete se puede marcar agotado. El servidor
-- también lo hace cumplir al comprar (no basta con esconder el botón en la web).
create table public.catalogos_config (
  categoria text primary key check (categoria in ('ilimitada', 'promo', 'cajas_tokens', 'tokens_evolutivos', 'cuentas')),
  visible boolean not null default true,
  mantenimiento boolean not null default false,
  sin_stock boolean not null default false,
  mensaje text not null default '' check (length(mensaje) <= 200),
  updated_at timestamptz not null default now()
);
insert into public.catalogos_config (categoria) values ('ilimitada'), ('promo'), ('cajas_tokens'), ('tokens_evolutivos'), ('cuentas');

alter table public.catalogos_config enable row level security;
create policy "ver_catalogos_config" on public.catalogos_config for select using (true);
revoke all on public.catalogos_config from anon, authenticated;
grant select on public.catalogos_config to anon, authenticated;

alter table public.paquetes_ff add column agotado boolean not null default false;

-- ¿Se puede comprar en este catálogo? (visible, sin mantenimiento y con stock)
create function public.catalogo_disponible(p_categoria text)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select coalesce(
    (select visible and not mantenimiento and not sin_stock from public.catalogos_config where categoria = p_categoria),
    true
  );
$$;
revoke execute on function public.catalogo_disponible(text) from public, anon, authenticated;

-- procesar_nuevo_pedido(): igual que antes, más estas tres comprobaciones:
--   · paquete con catálogo oculto / en mantenimiento / sin stock  -> 'Este catálogo no está disponible por ahora'
--   · paquete agotado                                            -> 'Este paquete está agotado por ahora'
--   · cantidad exacta (cajas_tokens) con ese catálogo bloqueado   -> 'Este catálogo no está disponible por ahora'
-- comprar_cuenta(): igual que antes, más la comprobación del catálogo 'cuentas'.
-- (Las dos funciones completas están definidas en la base; se recrearon con "create or replace".)

create function public.admin_listar_catalogos()
returns table (
  categoria text, visible boolean, mantenimiento boolean, sin_stock boolean, mensaje text,
  total_productos integer, productos_agotados integer
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select c.categoria, c.visible, c.mantenimiento, c.sin_stock, c.mensaje,
      case when c.categoria = 'cuentas'
        then (select count(*)::integer from public.cuentas_ff)
        else (select count(*)::integer from public.paquetes_ff p where p.categoria = c.categoria and p.activo) end,
      case when c.categoria = 'cuentas'
        then (select count(*)::integer from public.cuentas_ff where estado = 'agotado')
        else (select count(*)::integer from public.paquetes_ff p where p.categoria = c.categoria and p.activo and p.agotado) end
    from public.catalogos_config c
    order by array_position(array['ilimitada','promo','cajas_tokens','tokens_evolutivos','cuentas'], c.categoria);
end;
$$;

create function public.admin_guardar_catalogo(
  p_categoria text, p_visible boolean, p_mantenimiento boolean, p_sin_stock boolean, p_mensaje text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  if char_length(coalesce(p_mensaje, '')) > 200 then
    raise exception 'El mensaje puede tener máximo 200 caracteres';
  end if;
  update public.catalogos_config
    set visible = coalesce(p_visible, visible),
        mantenimiento = coalesce(p_mantenimiento, mantenimiento),
        sin_stock = coalesce(p_sin_stock, sin_stock),
        mensaje = trim(coalesce(p_mensaje, mensaje)),
        updated_at = now()
    where categoria = p_categoria;
  if not found then
    raise exception 'Catálogo no válido';
  end if;
end;
$$;

-- Cambia solo la visibilidad y el stock de un paquete (sin tocar su precio ni nombre).
create function public.admin_estado_paquete(p_id integer, p_activo boolean, p_agotado boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  update public.paquetes_ff
    set activo = coalesce(p_activo, activo), agotado = coalesce(p_agotado, agotado)
    where id = p_id;
  if not found then
    raise exception 'Paquete no encontrado';
  end if;
end;
$$;

-- Mismo listado de antes, ahora con "agotado" (cambia el retorno, por eso se recrea).
drop function public.admin_listar_paquetes();
create function public.admin_listar_paquetes()
returns table (
  id integer, nombre text, cantidad integer, precio numeric, categoria text, unidad text,
  destacado boolean, activo boolean, orden integer, agotado boolean
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select pa.id, pa.nombre, pa.cantidad, pa.precio, pa.categoria, pa.unidad, pa.destacado, pa.activo, pa.orden, pa.agotado
    from public.paquetes_ff pa
    order by pa.categoria, pa.orden;
end;
$$;

-- Resumen del negocio para el inicio del panel (los días se cuentan con la hora de Lima).
-- "Ventas" = compras con saldo (diamantes y cuentas) confirmadas o entregadas; las canceladas no cuentan.
create function public.admin_resumen_tienda()
returns table (
  solicitudes_pendientes bigint, monto_solicitudes numeric, por_entregar bigint,
  total_usuarios bigint, usuarios_hoy bigint, saldo_clientes numeric,
  ventas_hoy numeric, ventas_mes numeric, n_ventas_hoy bigint,
  recargado_hoy numeric, recargado_mes numeric,
  cuentas_disponibles bigint, ultima_venta timestamptz
)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_mes date := date_trunc('month', now() at time zone 'America/Lima')::date;
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select
      (select count(*) from public.pedidos where tipo = 'recarga_saldo' and estado = 'pendiente'),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo = 'recarga_saldo' and estado = 'pendiente'),
      (select count(*) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado = 'confirmado'),
      (select count(*) from public.perfiles),
      (select count(*) from public.perfiles where (created_at at time zone 'America/Lima')::date = v_hoy),
      (select coalesce(sum(saldo), 0) from public.perfiles),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date = v_hoy),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date >= v_mes),
      (select count(*) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date = v_hoy),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo = 'recarga_saldo' and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date = v_hoy),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo = 'recarga_saldo' and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date >= v_mes),
      (select count(*) from public.cuentas_ff where estado = 'disponible'),
      (select max(created_at) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado in ('confirmado', 'completado'));
end;
$$;

-- Ventas y recargas por día (últimos p_dias días, hora de Lima).
create function public.admin_ventas_dias(p_dias integer default 14)
returns table (dia date, recargado numeric, ventas numeric, n_ventas integer)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_n integer := greatest(1, least(coalesce(p_dias, 14), 90));
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select d::date,
      coalesce((select sum(pe.monto) from public.pedidos pe where pe.tipo = 'recarga_saldo' and pe.estado in ('confirmado', 'completado') and (pe.created_at at time zone 'America/Lima')::date = d::date), 0),
      coalesce((select sum(pe.monto) from public.pedidos pe where pe.tipo in ('compra_diamantes', 'compra_cuenta') and pe.estado in ('confirmado', 'completado') and (pe.created_at at time zone 'America/Lima')::date = d::date), 0),
      (select count(*)::integer from public.pedidos pe where pe.tipo in ('compra_diamantes', 'compra_cuenta') and pe.estado in ('confirmado', 'completado') and (pe.created_at at time zone 'America/Lima')::date = d::date)
    from generate_series(v_hoy - (v_n - 1), v_hoy, interval '1 day') d
    order by d;
end;
$$;

-- Qué catálogos venden más (últimos p_dias días).
create function public.admin_ventas_catalogos(p_dias integer default 30)
returns table (categoria text, ventas numeric, n integer)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select case when pe.tipo = 'compra_cuenta' then 'cuentas'
                when pe.paquete_id is null then 'cajas_tokens'
                else pa.categoria end as cat,
           sum(pe.monto), count(*)::integer
    from public.pedidos pe
    left join public.paquetes_ff pa on pa.id = pe.paquete_id
    where pe.tipo in ('compra_diamantes', 'compra_cuenta')
      and pe.estado in ('confirmado', 'completado')
      and pe.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)))
    group by 1
    order by 2 desc;
end;
$$;

revoke execute on function public.admin_listar_catalogos() from public;
revoke execute on function public.admin_guardar_catalogo(text, boolean, boolean, boolean, text) from public;
revoke execute on function public.admin_estado_paquete(integer, boolean, boolean) from public;
revoke execute on function public.admin_listar_paquetes() from public;
revoke execute on function public.admin_resumen_tienda() from public;
revoke execute on function public.admin_ventas_dias(integer) from public;
revoke execute on function public.admin_ventas_catalogos(integer) from public;
grant execute on function public.admin_listar_catalogos() to authenticated;
grant execute on function public.admin_guardar_catalogo(text, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.admin_estado_paquete(integer, boolean, boolean) to authenticated;
grant execute on function public.admin_listar_paquetes() to authenticated;
grant execute on function public.admin_resumen_tienda() to authenticated;
grant execute on function public.admin_ventas_dias(integer) to authenticated;
grant execute on function public.admin_ventas_catalogos(integer) to authenticated;


-- ============================================================
-- INTEGRACIÓN CON EL PROVEEDOR DE RECARGAS (27 de octubre de 2026)
-- Nickname por ID y entrega automática. Ver el README, sección "Integración
-- con el proveedor de recargas". Son 4 migraciones, en este orden:
--   integracion_proveedor_api_base, integracion_proveedor_api_ayudas_servicio,
--   integracion_proveedor_api_info_juego y entrega_pasar_a_manual.
-- Las funciones "entrega_*" e "integracion_*" las usa SOLO la Edge Function
-- "integracion" (rol service_role): nadie más puede ejecutarlas.
-- ============================================================

-- >>> migración: integracion_proveedor_api_base
-- ---------- INTEGRACIÓN CON LA API DEL PROVEEDOR (nickname por ID y entrega automática) ----------
-- Todo lo que toca al proveedor corre en el servidor (Edge Functions). La llave de la API vive
-- en los "secrets" de Supabase, nunca en la web. Aquí está solo el estado, los códigos de cada
-- paquete, la caché de nicknames y los registros. Mientras la integración esté apagada, todo
-- sigue funcionando a mano como siempre.

-- 1) Juegos (hoy solo Free Fire; la estructura queda lista para otros)
create table public.juegos (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  nombre text not null check (length(trim(nombre)) > 0),
  activo boolean not null default true,
  etiqueta_id text not null default 'ID de jugador',
  patron_id text not null default '^[0-9]{5,15}$' check (('x' ~ patron_id) is not null),
  usa_zona boolean not null default false,
  etiqueta_zona text,
  validar_auto boolean not null default false,
  entrega_auto boolean not null default false,
  created_at timestamptz not null default now()
);
insert into public.juegos (slug, nombre) values ('free-fire', 'Free Fire');
alter table public.juegos enable row level security;
create policy "ver_juegos" on public.juegos for select using (true);
revoke all on public.juegos from anon, authenticated;
grant select on public.juegos to anon, authenticated;
grant all on public.juegos to service_role;

-- 2) Cada paquete pertenece a un juego; "entrega_auto" es solo la marca pública para mostrar el aviso
alter table public.paquetes_ff add column juego text not null default 'free-fire' references public.juegos(slug);
alter table public.paquetes_ff add column entrega_auto boolean not null default false;

-- 3) Código de cada paquete en el proveedor (privado: nadie lo lee desde la web)
create table public.paquetes_proveedor (
  paquete_id integer primary key references public.paquetes_ff(id) on delete cascade,
  codigo text not null check (codigo ~ '^[A-Za-z0-9._:/@+ -]{1,80}$'),
  updated_at timestamptz not null default now()
);
alter table public.paquetes_proveedor enable row level security;
revoke all on public.paquetes_proveedor from anon, authenticated;
grant all on public.paquetes_proveedor to service_role;

-- 4) Estado de la conexión (lo escribe la función "integracion", acción "probar")
create table public.integracion_estado (
  id integer primary key default 1 check (id = 1),
  modo text not null default 'apagado' check (modo in ('apagado', 'simulado', 'real')),
  listo boolean not null default false,
  saldo numeric(12,2),
  moneda text,
  mensaje text,
  verificado_at timestamptz
);
insert into public.integracion_estado (id) values (1);
alter table public.integracion_estado enable row level security;
revoke all on public.integracion_estado from anon, authenticated;
grant all on public.integracion_estado to service_role;

-- 5) Caché de nicknames, límite de consultas y registro de lo que pasa con el proveedor
create table public.jugadores_cache (
  juego text not null references public.juegos(slug) on delete cascade,
  id_jugador text not null,
  zona text not null default '',
  nickname text not null,
  extra jsonb,
  consultado_at timestamptz not null default now(),
  primary key (juego, id_jugador, zona)
);
alter table public.jugadores_cache enable row level security;
revoke all on public.jugadores_cache from anon, authenticated;
grant all on public.jugadores_cache to service_role;

create table public.consultas_jugador (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  juego text not null,
  created_at timestamptz not null default now()
);
create index consultas_jugador_usuario_idx on public.consultas_jugador (usuario_id, created_at desc);
alter table public.consultas_jugador enable row level security;
revoke all on public.consultas_jugador from anon, authenticated;
grant all on public.consultas_jugador to service_role;

create table public.integracion_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  tipo text not null check (tipo in ('validar', 'entregar', 'probar')),
  juego text,
  pedido_id uuid,
  usuario_id uuid,
  ok boolean not null,
  detalle text
);
create index integracion_logs_fecha_idx on public.integracion_logs (created_at desc);
alter table public.integracion_logs enable row level security;
revoke all on public.integracion_logs from anon, authenticated;
grant all on public.integracion_logs to service_role;

-- 6) Datos de entrega en cada pedido (los llena solo el servidor)
alter table public.pedidos
  add column nickname_jugador text,
  add column entrega text not null default 'manual'
    check (entrega in ('manual', 'auto_pendiente', 'auto_en_proceso', 'auto_entregado', 'auto_fallo', 'auto_revisar')),
  add column entrega_ref text,
  add column entrega_detalle text,
  add column entrega_intentos integer not null default 0,
  add column entrega_at timestamptz;
create index pedidos_entrega_idx on public.pedidos (entrega) where entrega <> 'manual';

-- 7) Compra de diamantes: ahora también valida el ID, guarda el nickname verificado y decide si la
--    entrega es automática. Los campos de entrega NUNCA se aceptan desde el navegador.
create or replace function public.procesar_nuevo_pedido()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  saldo_actual numeric(10,2);
  v_paquete public.paquetes_ff%rowtype;
  v_precio_valido boolean;
  v_cantidad integer;
  v_juego public.juegos%rowtype;
  v_slug text;
begin
  new.nickname_jugador := null;
  new.entrega := 'manual';
  new.entrega_ref := null;
  new.entrega_detalle := null;
  new.entrega_intentos := 0;
  new.entrega_at := null;

  if new.tipo = 'compra_diamantes' then
    if new.id_jugador_ff is null or length(trim(new.id_jugador_ff)) = 0 then
      raise exception 'Falta el ID del jugador de Free Fire';
    end if;
    new.id_jugador_ff := trim(new.id_jugador_ff);

    if new.paquete_id is not null then
      select * into v_paquete from public.paquetes_ff where id = new.paquete_id;
      if not found or not v_paquete.activo then
        raise exception 'Este paquete ya no está disponible';
      end if;
      if not public.catalogo_disponible(v_paquete.categoria) then
        raise exception 'Este catálogo no está disponible por ahora';
      end if;
      if v_paquete.agotado then
        raise exception 'Este paquete está agotado por ahora';
      end if;
      v_slug := v_paquete.juego;

      v_precio_valido := (new.monto = v_paquete.precio);
      if not v_precio_valido then
        select coalesce(pr.activo and pr.paquete_id = new.paquete_id and pr.precio_promo = new.monto, false)
          into v_precio_valido
          from public.promo_diamantes pr where pr.id = 1;
        v_precio_valido := coalesce(v_precio_valido, false);
      end if;
      if not v_precio_valido then
        raise exception 'El precio de este paquete cambió. Recarga la página e inténtalo de nuevo.';
      end if;
    else
      v_slug := 'free-fire';
      if not public.catalogo_disponible('cajas_tokens') then
        raise exception 'Este catálogo no está disponible por ahora';
      end if;
      if new.nota_admin is null or new.nota_admin !~ '^Cantidad personalizada: [0-9]{1,6} Cajas Evolutivas$' then
        raise exception 'Compra no válida';
      end if;
      v_cantidad := substring(new.nota_admin from '^Cantidad personalizada: ([0-9]{1,6}) Cajas Evolutivas$')::integer;
      if v_cantidad < 20 or new.monto <> round(v_cantidad * 0.48, 2) then
        raise exception 'Compra no válida';
      end if;
    end if;

    select * into v_juego from public.juegos where slug = v_slug;
    if not found or not v_juego.activo then
      raise exception 'Este juego no está disponible por ahora';
    end if;
    if new.id_jugador_ff !~ v_juego.patron_id then
      raise exception 'El ID de jugador no es válido. Revísalo e inténtalo de nuevo.';
    end if;

    -- Nickname verificado por la API en los últimos días (si se consultó); si no, queda vacío.
    select jc.nickname into new.nickname_jugador
      from public.jugadores_cache jc
      where jc.juego = v_slug and jc.id_jugador = new.id_jugador_ff and jc.zona = ''
        and jc.consultado_at > now() - interval '3 days';

    -- Entrega automática solo si el juego la tiene activa, el paquete tiene su código en el
    -- proveedor y la conexión está probada. Si no, la entrega sigue siendo a mano.
    if v_juego.entrega_auto and new.paquete_id is not null
       and exists (select 1 from public.paquetes_proveedor pp where pp.paquete_id = new.paquete_id)
       and exists (select 1 from public.integracion_estado ie where ie.id = 1 and ie.listo) then
      new.entrega := 'auto_pendiente';
    end if;

    select saldo into saldo_actual
      from public.perfiles where id = new.usuario_id for update;

    if saldo_actual < new.monto then
      raise exception 'Saldo insuficiente. Recarga tu saldo antes de comprar.';
    end if;

    update public.perfiles
      set saldo = saldo - new.monto,
          puntos = puntos + floor(new.monto)::integer
      where id = new.usuario_id;
    new.estado := 'confirmado';

    perform public.otorgar_bono_referido(new.usuario_id, new.id);
  end if;

  return new;
end;
$$;

-- 8) El admin no puede cambiar a mano un pedido mientras el servidor lo está entregando
create or replace function public.admin_actualizar_pedido(p_id uuid, p_estado text, p_nota text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_actual text;
  v_entrega text;
  v_entrega_at timestamptz;
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  if p_estado is null then
    raise exception 'Falta el estado del pedido';
  end if;

  select estado, entrega, entrega_at into v_actual, v_entrega, v_entrega_at
    from public.pedidos where id = p_id for update;
  if not found then
    raise exception 'Ese pedido no existe';
  end if;

  if p_estado <> v_actual and not (
       (v_actual = 'pendiente'  and p_estado in ('confirmado', 'cancelado'))
    or (v_actual = 'confirmado' and p_estado in ('completado', 'cancelado'))
  ) then
    raise exception 'No se puede pasar un pedido de "%" a "%"', v_actual, p_estado;
  end if;

  if p_estado <> v_actual and v_entrega = 'auto_en_proceso' and v_entrega_at > now() - interval '10 minutes' then
    raise exception 'La entrega automática de este pedido está en proceso. Espera un momento y vuelve a intentar.';
  end if;

  update public.pedidos
    set estado = p_estado,
        nota_admin = coalesce(p_nota, nota_admin)
    where id = p_id;
end;
$$;

-- 9) Funciones que SOLO usa el servidor (Edge Functions con la llave de servicio)
-- Reclama un pedido para entregarlo: devuelve fila solo a quien lo logra primero, así nunca se
-- envía dos veces al proveedor. p_forzar = reintento pedido por el admin.
create function public.entrega_reclamar(p_pedido uuid, p_forzar boolean default false)
returns table (pedido_id uuid, id_jugador text, juego text, codigo text, nombre_paquete text, cantidad integer, intentos integer)
language plpgsql
security definer set search_path = public
as $$
declare
  v_p public.pedidos%rowtype;
  v_codigo text;
  v_pq public.paquetes_ff%rowtype;
begin
  update public.pedidos pe
    set entrega = 'auto_en_proceso', entrega_intentos = pe.entrega_intentos + 1, entrega_at = now()
    where pe.id = p_pedido and pe.tipo = 'compra_diamantes' and pe.estado = 'confirmado'
      and (
        pe.entrega = 'auto_pendiente'
        or (p_forzar and pe.entrega in ('auto_fallo', 'auto_revisar'))
        or (p_forzar and pe.entrega = 'auto_en_proceso' and pe.entrega_at < now() - interval '10 minutes')
      )
    returning pe.* into v_p;
  if not found then
    return;
  end if;

  select pp.codigo into v_codigo from public.paquetes_proveedor pp where pp.paquete_id = v_p.paquete_id;
  if v_codigo is null then
    update public.pedidos set entrega = 'manual', entrega_detalle = 'El paquete ya no tiene código del proveedor', entrega_at = now() where id = v_p.id;
    return;
  end if;

  select * into v_pq from public.paquetes_ff where id = v_p.paquete_id;
  return query select v_p.id, v_p.id_jugador_ff, v_pq.juego, v_codigo, v_pq.nombre, v_pq.cantidad, v_p.entrega_intentos;
end;
$$;

-- Cierra una entrega: 'entregado', 'fallo' (el proveedor la rechazó) o 'revisar' (no sabemos qué pasó).
-- Si fue simulada NO se marca el pedido como entregado de verdad.
create function public.entrega_cerrar(p_pedido uuid, p_resultado text, p_ref text, p_detalle text, p_simulado boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_resultado = 'entregado' then
    update public.pedidos
      set entrega = 'auto_entregado',
          entrega_ref = left(p_ref, 120),
          entrega_detalle = case when p_simulado then 'SIMULADO: no se entregó nada de verdad' else null end,
          entrega_at = now(),
          estado = case when p_simulado then estado else 'completado' end
      where id = p_pedido and entrega = 'auto_en_proceso';
  elsif p_resultado = 'fallo' then
    update public.pedidos
      set entrega = 'auto_fallo', entrega_detalle = left(coalesce(p_detalle, 'El proveedor no pudo hacer la entrega'), 200), entrega_at = now()
      where id = p_pedido and entrega = 'auto_en_proceso';
  elsif p_resultado = 'revisar' then
    update public.pedidos
      set entrega = 'auto_revisar', entrega_detalle = left(coalesce(p_detalle, 'No sabemos si el proveedor entregó: revisa su panel'), 200), entrega_at = now()
      where id = p_pedido and entrega = 'auto_en_proceso';
  else
    raise exception 'Resultado no válido';
  end if;
  if not found then
    raise exception 'El pedido no está en proceso de entrega';
  end if;
end;
$$;

-- Límite de consultas de nickname por usuario (ventana deslizante) y limpieza de datos viejos.
create function public.integracion_permitir_consulta(p_usuario uuid, p_juego text, p_max integer default 20, p_minutos integer default 60)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_n integer;
begin
  delete from public.consultas_jugador where created_at < now() - interval '2 days';
  delete from public.jugadores_cache where consultado_at < now() - interval '30 days';
  select count(*) into v_n from public.consultas_jugador
    where usuario_id = p_usuario and created_at > now() - make_interval(mins => p_minutos);
  if v_n >= p_max then
    return false;
  end if;
  insert into public.consultas_jugador (usuario_id, juego) values (p_usuario, p_juego);
  return true;
end;
$$;

create function public.integracion_log(p_tipo text, p_juego text, p_pedido uuid, p_usuario uuid, p_ok boolean, p_detalle text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.integracion_logs (tipo, juego, pedido_id, usuario_id, ok, detalle)
  values (p_tipo, p_juego, p_pedido, p_usuario, p_ok, left(p_detalle, 300));
  delete from public.integracion_logs where created_at < now() - interval '30 days';
end;
$$;

create function public.integracion_guardar_estado(p_modo text, p_listo boolean, p_saldo numeric, p_moneda text, p_mensaje text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.integracion_estado
    set modo = p_modo, listo = p_listo, saldo = p_saldo, moneda = left(p_moneda, 10),
        mensaje = left(p_mensaje, 300), verificado_at = now()
    where id = 1;
end;
$$;

-- 10) Funciones del panel admin
create function public.admin_integracion_estado()
returns table (modo text, listo boolean, saldo numeric, moneda text, mensaje text, verificado_at timestamptz)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  return query select ie.modo, ie.listo, ie.saldo, ie.moneda, ie.mensaje, ie.verificado_at from public.integracion_estado ie where ie.id = 1;
end;
$$;

create function public.admin_listar_juegos()
returns table (slug text, nombre text, activo boolean, validar_auto boolean, entrega_auto boolean, paquetes_total integer, paquetes_con_codigo integer)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  return query
    select j.slug, j.nombre, j.activo, j.validar_auto, j.entrega_auto,
      (select count(*)::integer from public.paquetes_ff p where p.juego = j.slug),
      (select count(*)::integer from public.paquetes_ff p join public.paquetes_proveedor pp on pp.paquete_id = p.id where p.juego = j.slug)
    from public.juegos j
    order by j.created_at;
end;
$$;

-- Activar la validación o la entrega automática exige haber probado la conexión antes.
create function public.admin_guardar_juego(p_slug text, p_activo boolean, p_validar_auto boolean, p_entrega_auto boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_j public.juegos%rowtype;
  v_listo boolean;
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  select * into v_j from public.juegos where slug = p_slug for update;
  if not found then
    raise exception 'Juego no encontrado';
  end if;
  select ie.listo into v_listo from public.integracion_estado ie where ie.id = 1;
  if ((coalesce(p_validar_auto, v_j.validar_auto) and not v_j.validar_auto)
      or (coalesce(p_entrega_auto, v_j.entrega_auto) and not v_j.entrega_auto)) and not coalesce(v_listo, false) then
    raise exception 'Primero prueba la conexión con el proveedor (sección Integraciones)';
  end if;
  update public.juegos
    set activo = coalesce(p_activo, activo),
        validar_auto = coalesce(p_validar_auto, validar_auto),
        entrega_auto = coalesce(p_entrega_auto, entrega_auto)
    where slug = p_slug;
end;
$$;

-- Guarda (o quita, si viene vacío) el código del paquete en el proveedor.
create function public.admin_guardar_proveedor_paquete(p_paquete_id integer, p_codigo text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_codigo text := nullif(trim(coalesce(p_codigo, '')), '');
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  if not exists (select 1 from public.paquetes_ff where id = p_paquete_id) then
    raise exception 'Paquete no encontrado';
  end if;
  if v_codigo is null then
    delete from public.paquetes_proveedor where paquete_id = p_paquete_id;
    update public.paquetes_ff set entrega_auto = false where id = p_paquete_id;
  else
    if v_codigo !~ '^[A-Za-z0-9._:/@+ -]{1,80}$' then
      raise exception 'El código del proveedor solo puede llevar letras, números y . _ : / @ + -';
    end if;
    insert into public.paquetes_proveedor (paquete_id, codigo) values (p_paquete_id, v_codigo)
      on conflict (paquete_id) do update set codigo = excluded.codigo, updated_at = now();
    update public.paquetes_ff set entrega_auto = true where id = p_paquete_id;
  end if;
end;
$$;

create function public.admin_logs_integracion(p_limite integer default 40)
returns table (created_at timestamptz, tipo text, juego text, pedido_id uuid, ok boolean, detalle text)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;
  return query
    select l.created_at, l.tipo, l.juego, l.pedido_id, l.ok, l.detalle
    from public.integracion_logs l
    order by l.created_at desc
    limit greatest(1, least(coalesce(p_limite, 40), 200));
end;
$$;

-- Listados del panel con los datos nuevos (cambia lo que devuelven, por eso se recrean).
drop function public.admin_listar_paquetes();
create function public.admin_listar_paquetes()
returns table (
  id integer, nombre text, cantidad integer, precio numeric, categoria text, unidad text,
  destacado boolean, activo boolean, orden integer, agotado boolean, juego text, codigo_proveedor text
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select pa.id, pa.nombre, pa.cantidad, pa.precio, pa.categoria, pa.unidad, pa.destacado, pa.activo, pa.orden, pa.agotado,
           pa.juego, pp.codigo
    from public.paquetes_ff pa
    left join public.paquetes_proveedor pp on pp.paquete_id = pa.id
    order by pa.categoria, pa.orden;
end;
$$;

drop function public.admin_listar_pedidos(text);
create function public.admin_listar_pedidos(p_estado text default null)
returns table (
  id uuid, created_at timestamptz, tipo text, estado text, monto numeric, metodo_pago text,
  id_jugador_ff text, nota_admin text, usuario_id uuid, nickname text, correo text, paquete_nombre text,
  nickname_jugador text, entrega text, entrega_ref text, entrega_detalle text, entrega_intentos integer, entrega_at timestamptz
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select pe.id, pe.created_at, pe.tipo, pe.estado, pe.monto, pe.metodo_pago,
           pe.id_jugador_ff, pe.nota_admin, pe.usuario_id,
           pf.nickname, u.email::text, pa.nombre,
           pe.nickname_jugador, pe.entrega, pe.entrega_ref, pe.entrega_detalle, pe.entrega_intentos, pe.entrega_at
    from public.pedidos pe
    join public.perfiles pf on pf.id = pe.usuario_id
    join auth.users u on u.id = pe.usuario_id
    left join public.paquetes_ff pa on pa.id = pe.paquete_id
    where p_estado is null or pe.estado = p_estado
    order by pe.created_at desc;
end;
$$;

drop function public.admin_resumen_tienda();
create function public.admin_resumen_tienda()
returns table (
  solicitudes_pendientes bigint, monto_solicitudes numeric, por_entregar bigint,
  total_usuarios bigint, usuarios_hoy bigint, saldo_clientes numeric,
  ventas_hoy numeric, ventas_mes numeric, n_ventas_hoy bigint,
  recargado_hoy numeric, recargado_mes numeric,
  cuentas_disponibles bigint, ultima_venta timestamptz,
  entregas_problema bigint, entregas_auto_pendientes bigint
)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_mes date := date_trunc('month', now() at time zone 'America/Lima')::date;
begin
  if not public.es_admin_actual() then
    raise exception 'No autorizado';
  end if;

  return query
    select
      (select count(*) from public.pedidos where tipo = 'recarga_saldo' and estado = 'pendiente'),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo = 'recarga_saldo' and estado = 'pendiente'),
      (select count(*) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado = 'confirmado'),
      (select count(*) from public.perfiles),
      (select count(*) from public.perfiles where (created_at at time zone 'America/Lima')::date = v_hoy),
      (select coalesce(sum(saldo), 0) from public.perfiles),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date = v_hoy),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date >= v_mes),
      (select count(*) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date = v_hoy),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo = 'recarga_saldo' and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date = v_hoy),
      (select coalesce(sum(monto), 0) from public.pedidos where tipo = 'recarga_saldo' and estado in ('confirmado', 'completado') and (created_at at time zone 'America/Lima')::date >= v_mes),
      (select count(*) from public.cuentas_ff where estado = 'disponible'),
      (select max(created_at) from public.pedidos where tipo in ('compra_diamantes', 'compra_cuenta') and estado in ('confirmado', 'completado')),
      (select count(*) from public.pedidos where tipo = 'compra_diamantes' and estado = 'confirmado' and entrega in ('auto_fallo', 'auto_revisar')),
      (select count(*) from public.pedidos where tipo = 'compra_diamantes' and estado = 'confirmado' and entrega in ('auto_pendiente', 'auto_en_proceso'));
end;
$$;

-- 11) Permisos
revoke execute on function public.entrega_reclamar(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.entrega_cerrar(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.integracion_permitir_consulta(uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.integracion_log(text, text, uuid, uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.integracion_guardar_estado(text, boolean, numeric, text, text) from public, anon, authenticated;
grant execute on function public.entrega_reclamar(uuid, boolean) to service_role;
grant execute on function public.entrega_cerrar(uuid, text, text, text, boolean) to service_role;
grant execute on function public.integracion_permitir_consulta(uuid, text, integer, integer) to service_role;
grant execute on function public.integracion_log(text, text, uuid, uuid, boolean, text) to service_role;
grant execute on function public.integracion_guardar_estado(text, boolean, numeric, text, text) to service_role;

revoke execute on function public.admin_integracion_estado() from public;
revoke execute on function public.admin_listar_juegos() from public;
revoke execute on function public.admin_guardar_juego(text, boolean, boolean, boolean) from public;
revoke execute on function public.admin_guardar_proveedor_paquete(integer, text) from public;
revoke execute on function public.admin_logs_integracion(integer) from public;
revoke execute on function public.admin_listar_paquetes() from public;
revoke execute on function public.admin_listar_pedidos(text) from public;
revoke execute on function public.admin_resumen_tienda() from public;
grant execute on function public.admin_integracion_estado() to authenticated;
grant execute on function public.admin_listar_juegos() to authenticated;
grant execute on function public.admin_guardar_juego(text, boolean, boolean, boolean) to authenticated;
grant execute on function public.admin_guardar_proveedor_paquete(integer, text) to authenticated;
grant execute on function public.admin_logs_integracion(integer) to authenticated;
grant execute on function public.admin_listar_paquetes() to authenticated;
grant execute on function public.admin_listar_pedidos(text) to authenticated;
grant execute on function public.admin_resumen_tienda() to authenticated;

-- >>> migración: integracion_proveedor_api_ayudas_servicio
-- El rol de servicio (service_role) no tiene permisos directos sobre las tablas viejas (pedidos,
-- perfiles...). En vez de dárselos, solo puede llamar estas funciones puntuales.
create function public.integracion_es_admin(p_usuario uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select coalesce((select es_admin from public.perfiles where id = p_usuario), false);
$$;

create function public.entrega_pedido_info(p_pedido uuid)
returns table (id uuid, usuario_id uuid, tipo text, estado text, entrega text, entrega_at timestamptz, id_jugador text, paquete_id integer)
language sql stable
security definer set search_path = public
as $$
  select pe.id, pe.usuario_id, pe.tipo, pe.estado, pe.entrega, pe.entrega_at, pe.id_jugador_ff, pe.paquete_id
  from public.pedidos pe where pe.id = p_pedido;
$$;

revoke execute on function public.integracion_es_admin(uuid) from public, anon, authenticated;
revoke execute on function public.entrega_pedido_info(uuid) from public, anon, authenticated;
grant execute on function public.integracion_es_admin(uuid) to service_role;
grant execute on function public.entrega_pedido_info(uuid) to service_role;

-- >>> migración: integracion_proveedor_api_info_juego
-- La función necesita saber de qué juego es el pedido (para revisar si la entrega automática sigue activa).
drop function public.entrega_pedido_info(uuid);
create function public.entrega_pedido_info(p_pedido uuid)
returns table (id uuid, usuario_id uuid, tipo text, estado text, entrega text, entrega_at timestamptz, id_jugador text, paquete_id integer, juego text)
language sql stable
security definer set search_path = public
as $$
  select pe.id, pe.usuario_id, pe.tipo, pe.estado, pe.entrega, pe.entrega_at, pe.id_jugador_ff, pe.paquete_id,
         coalesce(pa.juego, 'free-fire')
  from public.pedidos pe
  left join public.paquetes_ff pa on pa.id = pe.paquete_id
  where pe.id = p_pedido;
$$;
revoke execute on function public.entrega_pedido_info(uuid) from public, anon, authenticated;
grant execute on function public.entrega_pedido_info(uuid) to service_role;

-- >>> migración: entrega_pasar_a_manual
-- Si un pedido quedó marcado para entrega automática pero la integración ya no está disponible
-- (se apagó el proveedor o el juego), vuelve al flujo manual de siempre en vez de quedarse esperando.
create or replace function public.entrega_pasar_a_manual(p_pedido uuid, p_detalle text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pedidos
    set entrega = 'manual',
        entrega_detalle = left(coalesce(p_detalle, 'La entrega automática no estaba disponible: se hace a mano'), 200),
        entrega_at = now()
    where id = p_pedido
      and tipo = 'compra_diamantes'
      and estado = 'confirmado'
      and entrega = 'auto_pendiente';
end;
$$;

revoke all on function public.entrega_pasar_a_manual(uuid, text) from public, anon, authenticated;
grant execute on function public.entrega_pasar_a_manual(uuid, text) to service_role;
