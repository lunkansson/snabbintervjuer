-- Nexer speeddating booking — schema for Supabase (Postgres)
--
-- Run this once in the Supabase SQL editor for a fresh project.
--
-- Design intent (from the Claude Design handoff):
--   - Candidates never see each other's names — only "Ledig" / "Bokad".
--   - No double-booking: a slot can only ever hold one booking, enforced by
--     a unique constraint so a race between two candidates can't both win.
--   - Admin ("För oss") sees the full list (time, name, booking number)
--     behind a single shared password — not real auth, just a gate.
--
-- To keep candidate names out of reach even for anon-key requests that skip
-- the app UI, the anon role gets NO direct table access. Everything goes
-- through the view/functions below, which is the smallest surface that
-- still satisfies "no double-booking" + "no name leaks" + "one shared
-- admin password".

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id text not null unique,
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

alter table public.bookings enable row level security;
-- No policies are added for the anon role, so direct table access
-- (select/insert/update/delete) is denied by default. All access below
-- goes through the view and SECURITY DEFINER functions instead.

-- Public read: which slots are taken, never who booked them.
create or replace view public.public_slots as
  select slot_id from public.bookings;

grant select on public.public_slots to anon;

-- Create a booking. Generates the candidate-facing code server-side so the
-- client never has to (and can't) forge one. Raises 'slot_taken' if the
-- slot lost a race to another candidate.
create or replace function public.create_booking(p_slot_id text, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_slot_id is null or length(trim(p_name)) < 2 then
    raise exception 'invalid_input';
  end if;
  loop
    v_code := 'NX-' || (1000 + floor(random() * 9000))::int;
    begin
      insert into public.bookings (slot_id, name, code) values (p_slot_id, trim(p_name), v_code);
      return v_code;
    exception when unique_violation then
      if exists (select 1 from public.bookings where slot_id = p_slot_id) then
        raise exception 'slot_taken';
      end if;
      -- otherwise it was the booking-code that collided (very rare) — retry with a new one
    end;
  end loop;
end;
$$;

grant execute on function public.create_booking(text, text) to anon;

-- Cancel a booking. Requires knowing the exact code+slot pair (the same
-- "not real security, just a shared secret" level the original prototype
-- had), without letting anon requests probe/delete arbitrary rows directly.
create or replace function public.cancel_booking(p_code text, p_slot_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.bookings where code = p_code and slot_id = p_slot_id;
  return found;
end;
$$;

grant execute on function public.cancel_booking(text, text) to anon;

-- Admin list. Gated by a single shared password (matches the app's
-- "type the password" gate) rather than real per-admin accounts. Change
-- the password below before deploying.
create or replace function public.get_admin_bookings(p_password text)
returns table (slot_id text, name text, code text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_password is distinct from 'starforlife2005' then
    raise exception 'wrong_password';
  end if;
  return query select b.slot_id, b.name, b.code from public.bookings b order by b.slot_id;
end;
$$;

grant execute on function public.get_admin_bookings(text) to anon;

-- Optional: enable Realtime on the view's underlying table so every open
-- booking page updates live when someone else books/cancels a slot.
alter publication supabase_realtime add table public.bookings;
