-- รันใน Supabase → SQL Editor ครั้งเดียว (ใช้โปรเจกต์ Supabase เดิมได้ ชื่อตารางไม่ชนกับระบบโรงเรียน)

-- รายการจองห้อง + คาบเรียน (1 แถว = 1 รายการ)
create table if not exists room_bookings (
  id text primary key,
  data jsonb not null,
  status text,
  date text,
  updated_at timestamptz default now()
);
alter table room_bookings enable row level security;
create policy "rooms read"   on room_bookings for select using (true);
create policy "rooms insert" on room_bookings for insert with check (true);
create policy "rooms update" on room_bookings for update using (true);
create policy "rooms delete" on room_bookings for delete using (true);

-- ค่าตั้งค่า (เบอร์แอดมิน ห้อง อุปกรณ์)
create table if not exists room_settings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table room_settings enable row level security;
create policy "settings read"   on room_settings for select using (true);
create policy "settings insert" on room_settings for insert with check (true);
create policy "settings update" on room_settings for update using (true);

-- ให้หน้าเว็บอัปเดตเองทันทีเมื่อมีคนจอง / แก้การตั้งค่า
alter publication supabase_realtime add table room_bookings;
alter publication supabase_realtime add table room_settings;

-- กะพนักงาน (ใครเข้างานเวลาไหน)
create table if not exists room_shifts (
  id text primary key,
  data jsonb not null,
  date text,
  updated_at timestamptz default now()
);
alter table room_shifts enable row level security;
create policy "shifts read"   on room_shifts for select using (true);
create policy "shifts insert" on room_shifts for insert with check (true);
create policy "shifts update" on room_shifts for update using (true);
create policy "shifts delete" on room_shifts for delete using (true);
alter publication supabase_realtime add table room_shifts;

-- สิทธิ์ให้เว็บ (anon / publishable key) อ่าน-เขียนตารางได้
-- โปรเจกต์ Supabase ใหม่บางโปรเจกต์ไม่ให้สิทธิ์อัตโนมัติ ถ้าไม่มีส่วนนี้จะขึ้น "permission denied for table ..."
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table room_bookings, room_settings, room_shifts to anon, authenticated;
