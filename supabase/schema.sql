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
