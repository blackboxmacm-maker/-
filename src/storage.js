import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export const mode = supabase ? "cloud" : "local";

const LS_B = "twt-rooms-bookings";
const LS_S = "twt-rooms-settings";
const LS_SH = "twt-rooms-shifts";
const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const DEMO = import.meta.glob("./demo-seed.json", { eager: true });
function demoSeed() {
  if (import.meta.env.VITE_DEMO !== "1" || localStorage.getItem("twt-rooms-seed") === "mahidol-v7") return;
  localStorage.setItem("twt-rooms-seed", "mahidol-v7");
  const seed = Object.values(DEMO)[0]?.default; if (!seed) return;
  writeLS(LS_B, seed.bookings); writeLS(LS_S, seed.settings); writeLS(LS_SH, seed.shifts || []);
}

export async function loadBookings() {
  if (!supabase) { demoSeed(); return readLS(LS_B, []); }
  let out = []; let from = 0; const size = 1000;
  for (;;) {
    const { data, error } = await supabase.from("room_bookings").select("id,data").range(from, from + size - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < size) break;
    from += size;
  }
  return out.map((r) => r.data);
}

export async function upsertBookings(list) {
  if (!list.length) return;
  if (!supabase) {
    const cur = readLS(LS_B, []); const map = new Map(cur.map((b) => [b.id, b]));
    list.forEach((b) => map.set(b.id, b)); writeLS(LS_B, [...map.values()]); return;
  }
  const rows = list.map((b) => ({ id: b.id, data: b, status: b.status, date: b.date, updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await supabase.from("room_bookings").upsert(rows.slice(i, i + 300));
    if (error) throw error;
  }
}

export async function deleteBookings(ids) {
  if (!ids.length) return;
  if (!supabase) { writeLS(LS_B, readLS(LS_B, []).filter((b) => !ids.includes(b.id))); return; }
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("room_bookings").delete().in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }
}

export async function loadSettings() {
  if (!supabase) return readLS(LS_S, null);
  const { data, error } = await supabase.from("room_settings").select("data").eq("id", "main").maybeSingle();
  if (error) throw error;
  return data?.data || null;
}

export async function saveSettings(s) {
  if (!supabase) { writeLS(LS_S, s); return; }
  const { error } = await supabase.from("room_settings").upsert({ id: "main", data: s, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// อัปเดตหน้าจออัตโนมัติเมื่อมีคนจอง/แอดมินอนุมัติ
export function subscribe(onChange) {
  if (!supabase) {
    const f = (e) => { if (e.key === LS_B || e.key === LS_S || e.key === LS_SH) onChange(); };
    window.addEventListener("storage", f); return () => window.removeEventListener("storage", f);
  }
  const ch = supabase.channel("room-bookings")
    .on("postgres_changes", { event: "*", schema: "public", table: "room_bookings" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "room_shifts" }, () => onChange())
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

// ─── กะพนักงาน ──────────────────────────────────────────────
export async function loadShifts() {
  if (!supabase) return readLS(LS_SH, []);
  const { data, error } = await supabase.from("room_shifts").select("id,data");
  if (error) throw error;
  return (data || []).map((r) => r.data);
}
export async function upsertShifts(list) {
  if (!list.length) return;
  if (!supabase) { const map = new Map(readLS(LS_SH, []).map((x) => [x.id, x])); list.forEach((x) => map.set(x.id, x)); writeLS(LS_SH, [...map.values()]); return; }
  const { error } = await supabase.from("room_shifts").upsert(list.map((x) => ({ id: x.id, data: x, date: x.date, updated_at: new Date().toISOString() })));
  if (error) throw error;
}
export async function deleteShifts(ids) {
  if (!ids.length) return;
  if (!supabase) { writeLS(LS_SH, readLS(LS_SH, []).filter((x) => !ids.includes(x.id))); return; }
  const { error } = await supabase.from("room_shifts").delete().in("id", ids);
  if (error) throw error;
}

// แจ้งเตือนเข้ากลุ่ม LINE (ถ้าตั้งค่า ENV ใน Vercel ไว้) — ไม่ได้ตั้งก็ข้ามไปเงียบๆ
export async function notifyTeam(text) {
  try { await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); } catch {}
}
