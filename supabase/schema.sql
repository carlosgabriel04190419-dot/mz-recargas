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

    update public.perfiles set saldo = saldo - new.monto where id = new.usuario_id;
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
    update public.perfiles set saldo = saldo + new.monto where id = new.usuario_id;
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
