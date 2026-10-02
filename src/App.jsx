import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Phone, MessageCircle, Check, X, AlertTriangle, Settings, CalendarDays,
  Copy, Lock, Trash2, Inbox, Pencil, Users, Link2, LogOut, Calculator, Wrench, Ban, Clock, Sun, Moon,
} from "lucide-react";
import { loadBookings, upsertBookings, deleteBookings, loadSettings, saveSettings, subscribe, notifyTeam, mode, loadShifts, upsertShifts, deleteShifts } from "./storage.js";
import logo from "./assets/logo.jpg";
import { parseCalendar, readWorkbook, ROOM_BB, ROOM_WB } from "./importXlsx.js";

// ─── ค่าตั้งต้น (แก้ได้ในหน้า ตั้งค่า ของแอดมิน) ─────────────────────
const DEFAULT_SETTINGS = {
  orgName: "Blackbox Mahidol",
  rooms: [{ id: "r1", name: "ห้อง 1" }],
  contacts: [{ id: "c1", name: "แอดมิน", phone: "", line: "" }],
  equipment: [
    { id: "screen", name: "จอ / โปรเจกเตอร์" }, { id: "mic_wireless", name: "ไมค์ไร้สาย" }, { id: "mic_wired", name: "ไมค์สาย" },
    { id: "stand", name: "ขาไมค์" }, { id: "speaker", name: "ลำโพง PA" }, { id: "monitor", name: "ลำโพงมอนิเตอร์" },
    { id: "mixer", name: "มิกเซอร์" }, { id: "light", name: "ไฟเวที" }, { id: "keyboard", name: "คีย์บอร์ด" },
    { id: "drum", name: "กลองชุด" }, { id: "amp", name: "แอมป์กีตาร์ / เบส" }, { id: "di", name: "DI box" },
  ],
  staffMembers: [],
  shiftPresets: [{ id: "am", name: "กะเช้า", start: "08:00", end: "16:00" }, { id: "pm", name: "กะบ่าย", start: "13:00", end: "21:00" }],
  startHour: 8, endHour: 23, showWeekend: false,
  ot: { uni: 60, ext: 200, before: "09:00", after: "17:00" },
};
const PIN = import.meta.env.VITE_ADMIN_PIN || "";
const STAFF_PIN = import.meta.env.VITE_STAFF_PIN || "";
// สีห้องตั้งต้นเปลี่ยนตามโหมดสว่าง/มืด (CSS --room-N) · ถ้าแอดมินเลือกสีเองจะใช้สีนั้น
const AUTO_COLORS = ["#FFFFFF", "#8C8C8C", "#FF7A1A", "#3FD0FF", "#1F2A37", "#1656D6", "#10254F"];
const roomColor = (settings, id) => { const i = settings.rooms.findIndex((r) => r.id === id); const c = settings.rooms[i]?.color; return c && !AUTO_COLORS.includes(c.toUpperCase()) ? c : `var(--room-${Math.max(0, i) % 6})`; };
// สีประจำวันแบบไทย (จ=เหลือง อ=ชมพู พ=เขียว พฤ=ส้ม ศ=ฟ้า ส=ม่วง อา=แดง) · ปรับโทนตามโหมดใน CSS --day-N
const dayVar = (dateStr) => `var(--day-${(parseYmd(dateStr).getDay() + 6) % 7})`;
const STAFF_HEX = ["#3B82F6", "#E8772E", "#22A06B", "#D6409F", "#8B5CF6", "#0EA5B7", "#C9A227", "#E5484D"];
const staffColor = (settings, id) => { const list = settings.staffMembers || []; const i = list.findIndex((m) => m.id === id); const c = list[i]?.color; return c || `var(--staff-${Math.max(0, i) % 8})`; };
// จับชื่อพนักงานจากหมายเหตุ (เช่น "pae+Tucky+Dear") เพื่อแนะนำผู้รับผิดชอบงาน
const crewFromText = (text, staff) => { const t = (text || "").toLowerCase(); return staff.filter((m) => m.name && t.includes(m.name.toLowerCase())).map((m) => m.id); };
const useTheme = () => {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("twt-rooms-theme") || ""; } catch { return ""; } });
  const sysDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const current = theme || (sysDark ? "dark" : "light");
  useEffect(() => { const r = document.documentElement; if (theme) r.setAttribute("data-theme", theme); else r.removeAttribute("data-theme"); }, [theme]);
  const toggle = () => { const n = current === "dark" ? "light" : "dark"; setTheme(n); try { localStorage.setItem("twt-rooms-theme", n); } catch {} };
  return [current, toggle];
};

const ROLES = {
  teacher: { label: "อาจารย์", color: "var(--c-teacher)", title: "วิชา / คาบที่จะใช้ห้อง", name: "ชื่ออาจารย์" },
  student: { label: "นักเรียน", color: "var(--c-student)", title: "ใช้ห้องทำอะไร", name: "ชื่อ-นามสกุล (ชื่อเล่น)" },
  renter: { label: "ผู้เช่าสถานที่", color: "var(--c-renter)", title: "ชื่องาน / ชื่อองค์กร", name: "ชื่อผู้ติดต่อ" },
};
const PURPOSES = [
  ["class", "สอน / คาบเรียน"], ["practice", "ซ้อม"], ["record", "อัดเสียง / ทำเพลง"],
  ["show", "โชว์ / คอนเสิร์ต / อีเวนต์"], ["other", "ประชุม / อื่นๆ"],
];
const purposeName = (p) => (PURPOSES.find((x) => x[0] === p) || [, ""])[1];
const colorOf = (b) => (b.kind === "class" ? "var(--c-class)" : ROLES[b.role]?.color || "var(--c-class)");
const roleName = (b) => (b.kind === "class" ? "คาบเรียน" : ROLES[b.role]?.label || "");
const STATUS = { pending: "รอคอนเฟิร์ม", confirmed: "ยืนยันแล้ว", rejected: "ไม่อนุมัติ", cancelled: "ยกเลิกแล้ว" };
// รายการในตาราง = class / request · คำขอเปลี่ยนเวลา-ยกเลิก = change · คำขออุปกรณ์ = equip
const isSlot = (b) => b.kind === "class" || b.kind === "request";
const LIVE = (b) => b.status !== "rejected" && b.status !== "cancelled";
const kindLabel = (b) => (b.kind === "change" ? (b.action === "cancel" ? "ขอยกเลิกคาบ" : "ขอเปลี่ยนวัน/เวลา") : b.kind === "equip" ? "ขอใช้อุปกรณ์" : roleName(b));
const fmtBaht = (n) => Math.round(n).toLocaleString("th-TH");
const fmtHrs = (m) => { const h = m / 60; return (Math.round(h * 100) / 100).toLocaleString("th-TH"); };

// ─── วันเวลา ───────────────────────────────────────────────────
const TH_DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสฯ", "ศุกร์", "เสาร์", "อาทิตย์"];
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const toMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
const dayName = (s) => TH_DAYS[(parseYmd(s).getDay() + 6) % 7];
const fmtDate = (s) => { const d = parseYmd(s); return `วัน${dayName(s)}ที่ ${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543}`; };
const timeOptions = (s, endInclusive) => { const out = []; for (let h = s.startHour; h <= s.endHour; h++) for (const m of [0, 30]) { if (h === s.endHour && m > 0) break; out.push(`${pad(h)}:${pad(m)}`); } return endInclusive ? out.slice(1) : out.slice(0, -1); };
const DAY_TIMES = (() => { const o = []; for (let h = 0; h <= 24; h++) for (const m of [0, 30]) { if (h === 24 && m) break; o.push(`${pad(h)}:${pad(m)}`); } return o; })();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ─── ตรวจตารางชน ─────────────────────────────────────────────────
const overlaps = (a, b) => !a.allDay && !b.allDay && a.room === b.room && a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
const clashes = (x, list, onlyConfirmed) => list.filter((b) => isSlot(b) && b.id !== x.id && LIVE(b) && (!onlyConfirmed || b.status === "confirmed") && overlaps(x, b));
// โอที: จ–ศ นับเฉพาะก่อน/หลังเวลาที่ตั้ง · ส–อา นับทั้งกะ
const otMinutes = (sh, ot) => {
  if (sh.status === "leave") return 0;
  const s = toMin(sh.start), e = toMin(sh.end); if (e <= s) return 0;
  if ((parseYmd(sh.date).getDay() + 6) % 7 >= 5) return e - s;
  const ov = (a, b) => Math.max(0, Math.min(e, b) - Math.max(s, a));
  return ov(0, toMin(ot.before)) + ov(toMin(ot.after), 24 * 60);
};

const lineLink = (id) => { const v = (id || "").trim(); if (!v) return ""; if (/^https?:/.test(v)) return v; return v.startsWith("@") ? `https://line.me/R/ti/p/${encodeURIComponent(v)}` : `https://line.me/ti/p/~${encodeURIComponent(v)}`; };
const timeText = (b) => (b.allDay ? "ทั้งวัน" : `${b.start}–${b.end} น.`);
const telLink = (p) => "tel:" + (p || "").replace(/[^0-9+]/g, "");

// ─── เส้นทาง: /, /book, /admin (หรือ #/book) ─────────────────────
const HASH = import.meta.env.VITE_HASH_ROUTES === "1";
const readRoute = () => {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [hp, hq] = h.split("?");
  const p = window.location.pathname.replace(/^\/|\/$/g, "");
  const name = HASH ? hp || "home" : hp || p || "home";
  const params = new URLSearchParams(hq || window.location.search);
  return { name, params };
};
const pageUrl = (name) => (HASH ? window.location.origin + window.location.pathname + "#/" : window.location.origin + "/") + (name === "home" ? "" : name);
const copyText = (t, say) => { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => say("คัดลอกลิงก์แล้ว"), () => window.prompt("คัดลอกลิงก์นี้", t)); };
const go = (name, params) => {
  const path = "/" + (name === "home" ? "" : name) + (params ? "?" + new URLSearchParams(params) : "");
  if (HASH) window.location.hash = path;
  else { window.history.pushState(null, "", path); window.dispatchEvent(new PopStateEvent("popstate")); }
  window.scrollTo(0, 0);
};

function useData() {
  const [bookings, setBookings] = useState(null);
  const [settings, setSettings] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [err, setErr] = useState("");
  // การตั้งค่าบันทึกอัตโนมัติ: แก้ทันทีบนจอ → รวมกับข้อมูลล่าสุดในฐานข้อมูล → บันทึก (หลายคนแก้พร้อมกันได้ ไม่ทับกัน)
  const pending = useRef([]); const timer = useRef(null);
  const [saveState, setSaveState] = useState(""); const [saveErr, setSaveErr] = useState("");
  const reload = useCallback(async () => {
    try {
      const [b, s, sh] = await Promise.all([loadBookings(), loadSettings(), loadShifts().catch(() => [])]);
      setBookings(b || []); setShifts(sh || []); setSettings(pending.current.reduce((d, f) => f(d), { ...DEFAULT_SETTINGS, ...(s || {}) })); setErr("");
    } catch (e) { setErr(e.message || String(e)); setBookings((x) => x || []); setSettings((x) => x || DEFAULT_SETTINGS); }
  }, []);
  useEffect(() => {
    reload();
    const un = subscribe(reload);
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const t = setInterval(reload, 60000);
    return () => { un && un(); window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, [reload]);
  const flush = useCallback(async () => {
    const fns = pending.current; if (!fns.length) return;
    pending.current = [];
    setSaveState("saving");
    try {
      const latest = { ...DEFAULT_SETTINGS, ...((await loadSettings()) || {}) };
      const next = fns.reduce((d, f) => f(d), latest);
      await saveSettings(next);
      setSettings(pending.current.reduce((d, f) => f(d), next));
      setSaveState("saved"); setSaveErr("");
    } catch (e) {
      pending.current = [...fns, ...pending.current];
      setSaveState("error"); setSaveErr(e.message || String(e));
    }
  }, []);
  const editSettings = useCallback((fn) => {
    setSettings((cur) => fn(cur));
    pending.current.push(fn);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [flush]);
  useEffect(() => { const f = () => flush(); window.addEventListener("beforeunload", f); return () => window.removeEventListener("beforeunload", f); }, [flush]);
  return { bookings, settings, setBookings, setSettings, editSettings, saveState, saveErr, shifts, setShifts, reload, err };
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => { const f = () => setRoute(readRoute()); window.addEventListener("hashchange", f); window.addEventListener("popstate", f); return () => { window.removeEventListener("hashchange", f); window.removeEventListener("popstate", f); }; }, []);
  const data = useData();
  const [theme, toggleTheme] = useTheme();
  const [toast, setToast] = useState("");
  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  if (!data.bookings || !data.settings) return <div className="app"><p className="empty-note" style={{ padding: 40, textAlign: "center" }}>กำลังโหลดตาราง…</p></div>;

  const isForm = route.name === "book" || route.name === "equipment";
  let page;
  if (route.name === "book") page = <RequestPage {...data} params={route.params} />;
  else if (route.name === "equipment") page = <EquipPage {...data} params={route.params} />;
  else if (route.name === "admin") page = <AdminGate><Admin {...data} say={say} /></AdminGate>;
  else if (route.name === "approve") page = <AdminGate allowStaff><ApprovePage {...data} say={say} /></AdminGate>;
  else if (route.name === "staff") page = <ShiftsView {...data} editable={false} say={say} />;
  else page = <HomePage {...data} />;

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); go("home"); }}>
          <img className="brand-logo" src={logo} alt="" width="48" height="48" />
          <div><b>{data.settings.orgName}</b><span>ตารางห้อง Black Box · White Box</span></div>
        </a>
        <div className="spacer" />
        <button className="btn theme-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"} title={theme === "dark" ? "โหมดสว่าง" : "โหมดมืด"}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
        {isForm ? (
          <button className="btn exit" onClick={() => go("home")}><LogOut size={17} /> ออก</button>
        ) : (
          <nav className="top-actions">
            {route.name === "home" ? <button className="btn" onClick={() => go("staff")}><Users size={17} /> กะพนักงาน</button>
              : <button className="btn" onClick={() => go("home")}><CalendarDays size={17} /> หน้าตาราง</button>}
            <button className="btn" onClick={() => copyText(pageUrl("book"), say)} title="คัดลอกลิงก์ขอใช้ห้องไปส่งต่อ"><Link2 size={17} /> คัดลอกลิงก์</button>
            {route.name === "admin" ? <button className="btn" onClick={() => copyText(pageUrl("equipment"), say)}><Wrench size={17} /> ลิงก์ขออุปกรณ์</button>
              : <button className="btn" onClick={() => go("admin")}><Lock size={17} /> แอดมิน</button>}
            {route.name !== "admin" && <button className="btn primary" onClick={() => go("book")}><Plus size={17} /> ขอใช้ห้อง</button>}
          </nav>
        )}
      </header>
      {data.err && <div className="alert warn" style={{ marginBottom: 12 }}>เชื่อมต่อฐานข้อมูลไม่ได้: {data.err}</div>}
      {page}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// ─── ส่วนหัวตาราง: เลื่อนสัปดาห์ + เลือกห้อง ─────────────────────────
function WeekBar({ weekStart, setWeekStart, settings, room, setRoom, right }) {
  const days = settings.showWeekend ? 7 : 5;
  const end = addDays(weekStart, days - 1);
  const label = `${weekStart.getDate()} ${TH_M[weekStart.getMonth()]} – ${end.getDate()} ${TH_M[end.getMonth()]} ${end.getFullYear() + 543}`;
  return (
    <>
      <div className="toolbar">
        <button className="btn icon-btn" aria-label="สัปดาห์ก่อน" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => setWeekStart(mondayOf(new Date()))}>สัปดาห์นี้</button>
        <button className="btn icon-btn" aria-label="สัปดาห์ถัดไป" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={18} /></button>
        <span className="week-label">{label}</span>
        <input className="jump" type="date" aria-label="ไปที่วันที่" value={ymd(weekStart)} onChange={(e) => e.target.value && setWeekStart(mondayOf(parseYmd(e.target.value)))} />
        <div style={{ flex: 1 }} />
        {right}
      </div>
      {settings.rooms.length > 1 && (
        <div className="rooms" style={{ marginBottom: 12 }}>
          <button className={"room-tab" + (room === "all" ? " on" : "")} onClick={() => setRoom("all")}>รวมทุกห้อง</button>
          {settings.rooms.map((r) => <button key={r.id} className={"room-tab" + (r.id === room ? " on" : "")} style={{ "--rc": roomColor(settings, r.id) }} onClick={() => setRoom(r.id)}><i className="dot" />{r.name}</button>)}
        </div>
      )}
    </>
  );
}

function laneLayout(items) {
  const s = [...items].sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  const out = []; let cluster = []; let lanes = []; let cEnd = -1;
  const flush = () => { const cols = lanes.length || 1; cluster.forEach((o) => { o.cols = cols; out.push(o); }); cluster = []; lanes = []; cEnd = -1; };
  for (const b of s) {
    const st = toMin(b.start), en = toMin(b.end);
    if (cluster.length && st >= cEnd) flush();
    let lane = lanes.findIndex((e) => e <= st);
    if (lane < 0) { lane = lanes.length; lanes.push(en); } else lanes[lane] = en;
    cluster.push({ b, lane }); cEnd = Math.max(cEnd, en);
  }
  flush();
  return out;
}

function WeekGrid({ settings, bookings, room, weekStart, onEmpty, onOpen, isPublic }) {
  const days = settings.showWeekend ? 7 : 5;
  const sh = settings.startHour, eh = settings.endHour;
  const slots = (eh - sh) * 2; const RH = 26;
  const dates = Array.from({ length: days }, (_, i) => addDays(weekStart, i));
  const todayKey = ymd(new Date());
  const all = room === "all";
  const inRoom = (b) => (all ? settings.rooms.some((r) => r.id === b.room) : b.room === room);
  const live = bookings.filter((b) => isSlot(b) && inRoom(b) && LIVE(b) && !b.allDay);
  const allDay = bookings.filter((b) => isSlot(b) && inRoom(b) && LIVE(b) && b.allDay);
  const cOf = (b) => roomColor(settings, b.room);
  const rName = (b) => settings.rooms.find((r) => r.id === b.room)?.name || "";
  return (
    <div className="grid-wrap">
      <div className="grid" style={{ gridTemplateColumns: `50px repeat(${days}, minmax(${all ? 150 : 112}px, 1fr))` }}>
        <div className="corner" />
        {dates.map((d) => (
          <div key={ymd(d)} className={"dayhead" + (ymd(d) === todayKey ? " is-today" : "")} style={{ "--dc": dayVar(ymd(d)) }}>
            <span>{TH_DAYS[(d.getDay() + 6) % 7]}</span><b>{d.getDate()} {TH_M[d.getMonth()]}</b>
            {(() => {
              const ids = [...new Set([...live, ...allDay].filter((b) => b.date === ymd(d) && b.status === "confirmed").flatMap((b) => b.crew || []))];
              const crew = ids.map((id) => (settings.staffMembers || []).find((m) => m.id === id)).filter(Boolean);
              return crew.length ? <div className="crew-row" title="ทีมงานที่รับผิดชอบงานวันนี้">{crew.map((m) => <span key={m.id} className="crew-chip" style={{ "--sc": staffColor(settings, m.id) }}>{m.name}</span>)}</div> : null;
            })()}
            {allDay.filter((b) => b.date === ymd(d)).map((b) => (
              <button key={b.id} className={"allday " + b.status} style={{ "--c": cOf(b) }} title={(all ? rName(b) + " · " : "") + b.title} onClick={() => onOpen(b)}>
                {all && <span className="rtag">{rName(b)}</span>}{isPublic && b.status === "pending" ? "รอคอนเฟิร์ม" : b.title}
              </button>
            ))}
          </div>
        ))}
        <div className="times">
          {Array.from({ length: slots }, (_, i) => <div key={i} className="t" style={{ height: RH, transform: i === 0 ? "none" : undefined }}>{i % 2 === 0 ? `${pad(sh + i / 2)}:00` : ""}</div>)}
        </div>
        {dates.map((d) => {
          const key = ymd(d);
          const items = laneLayout(live.filter((b) => b.date === key));
          return (
            <div key={key} className="daycol" style={{ height: slots * RH }}>
              {Array.from({ length: slots }, (_, i) => {
                const t = `${pad(sh + Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`;
                return <button key={i} className={"slot" + (i % 2 === 0 ? " hour" : "") + (onEmpty ? "" : " ro")} style={{ top: i * RH, height: RH }}
                  tabIndex={onEmpty ? 0 : -1} aria-label={onEmpty ? `จองวัน${dayName(key)} ${t}` : undefined} onClick={() => onEmpty && onEmpty(key, t)} />;
              })}
              {items.map(({ b, lane, cols }) => {
                const top = ((toMin(b.start) - sh * 60) / 30) * RH; const h = ((toMin(b.end) - toMin(b.start)) / 30) * RH;
                const clash = !isPublic && clashes(b, bookings, false).length > 0;
                const hideName = isPublic && b.status === "pending";
                return (
                  <button key={b.id} className={"blk " + b.status + (clash ? " clash" : "")} onClick={() => onOpen(b)}
                    style={{ top: top + 1, height: Math.max(h - 2, 20), left: `calc(${(lane / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, "--c": cOf(b) }}>
                    <span className="tm">{b.start}–{b.end}{all ? ` · ${rName(b)}` : ""}</span>
                    <b>{hideName ? "รอคอนเฟิร์ม" : b.title || roleName(b)}</b>
                    {!hideName && h > 50 && <span className="who">{b.name}</span>}
                    {!hideName && (b.crew || []).length > 0 && <span className="crew-dots">{b.crew.map((id) => <i key={id} style={{ "--sc": staffColor(settings, id) }} title={(settings.staffMembers || []).find((m) => m.id === id)?.name} />)}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ settings, room }) {
  if (settings) return (
    <div className="legend">
      {settings.rooms.map((r) => <span key={r.id}><i style={{ "--c": roomColor(settings, r.id) }} />{r.name}</span>)}
      <span><i className="p" />รอคอนเฟิร์ม</span>
    </div>
  );
  return (
    <div className="legend">
      <span><i style={{ "--c": "var(--c-class)" }} />คาบเรียน</span>
      <span><i style={{ "--c": "var(--c-teacher)" }} />อาจารย์จอง</span>
      <span><i style={{ "--c": "var(--c-student)" }} />นักเรียนจอง</span>
      <span><i style={{ "--c": "var(--c-renter)" }} />เช่าสถานที่</span>
      <span><i className="p" />รอคอนเฟิร์ม</span>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  useEffect(() => { const f = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button className="btn icon-btn ghost" aria-label="ปิด" onClick={onClose}><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}

function ContactList({ contacts }) {
  const list = contacts.filter((c) => c.name || c.phone || c.line);
  if (!list.length) return null;
  return (
    <div className="contacts">
      {list.map((c) => (
        <div className="contact" key={c.id}>
          <b>{c.name}</b>
          {c.phone && <a href={telLink(c.phone)}><Phone size={15} /> {c.phone}</a>}
          {c.line && <a href={lineLink(c.line)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> LINE {c.line}</a>}
        </div>
      ))}
    </div>
  );
}

// ─── หน้าแรก: ตารางห้อง (ทุกคนดูได้) ───────────────────────────────
function HomePage({ bookings, settings, shifts = [] }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [room, setRoom] = useState(settings.rooms.length > 1 ? "all" : settings.rooms[0]?.id);
  const [open, setOpen] = useState(null);
  const todayKey = ymd(new Date());
  const roomName = (id) => settings.rooms.find((r) => r.id === id)?.name || "";
  const todays = bookings.filter((b) => isSlot(b) && b.date === todayKey && b.status === "confirmed").sort((a, b) => (a.allDay ? -1 : toMin(a.start)) - (b.allDay ? -1 : toMin(b.start)));
  return (
    <>
      <section className="today">
        <h2>วันนี้ {fmtDate(todayKey).replace("วัน" + dayName(todayKey) + "ที่ ", "")}</h2>
        {todays.length ? (
          <div className="today-list">
            {todays.map((b) => (
              <div className="today-item" key={b.id} style={{ "--c": roomColor(settings, b.room) }}>
                <b>{b.title || roleName(b)}</b>{b.allDay ? "ทั้งวัน" : `${b.start}–${b.end}`}{settings.rooms.length > 1 ? ` · ${roomName(b.room)}` : ""}<br />{b.name}
              </div>
            ))}
          </div>
        ) : <p className="empty-note" style={{ margin: 0 }}>วันนี้ห้องว่างทั้งวัน</p>}
      </section>
      <StaffToday settings={settings} shifts={shifts} date={todayKey} />
      <WeekBar weekStart={weekStart} setWeekStart={setWeekStart} settings={settings} room={room} setRoom={setRoom} />
      <WeekGrid settings={settings} bookings={bookings} room={room} weekStart={weekStart} isPublic
        onEmpty={(date, start) => go("book", { date, start, ...(room !== "all" ? { room } : {}) })} onOpen={setOpen} />
      <Legend settings={settings} room={room} />
      <p className="note-small">แตะช่องว่างในตารางเพื่อขอใช้ห้องช่วงเวลานั้น</p>
      {open && (
        <Modal title={open.status === "pending" ? "ช่วงนี้มีคนขอใช้ห้องแล้ว" : open.title || roleName(open)} onClose={() => setOpen(null)}>
          <div className="panel">
            <dl className="kv">
              <dt>สถานะ</dt><dd><span className={"pill st-" + open.status}>{STATUS[open.status]}</span></dd>
              <dt>วันที่</dt><dd>{fmtDate(open.date)}</dd>
              <dt>เวลา</dt><dd>{timeText(open)}</dd>
              {settings.rooms.length > 1 && <><dt>ห้อง</dt><dd>{roomName(open.room)}</dd></>}
              {open.status !== "pending" && <><dt>ประเภท</dt><dd>{roleName(open)}{open.purpose && open.kind !== "class" ? ` · ${purposeName(open.purpose)}` : ""}</dd></>}
              {open.status !== "pending" && open.name && <><dt>ผู้ใช้ห้อง</dt><dd>{open.name}</dd></>}
              {open.status !== "pending" && (open.crew || []).length > 0 && <><dt>ทีมงาน</dt><dd className="chips">{open.crew.map((id) => { const m = (settings.staffMembers || []).find((x) => x.id === id); return m ? <span key={id} className="crew-chip" style={{ "--sc": staffColor(settings, id) }}>{m.name}</span> : null; })}</dd></>}
              {open.status !== "pending" && open.allDay && open.note && <><dt>รายละเอียด</dt><dd>{open.note}</dd></>}
            </dl>
          </div>
          {open.status === "pending" && <p className="note-small" style={{ margin: 0 }}>รอทีมงานตรวจสอบอยู่ ถ้าต้องการใช้ช่วงเวลานี้ ติดต่อแอดมินได้เลย</p>}
          {open.status === "confirmed" && !open.allDay && (
            <div className="actions stack-mobile">
              <button className="btn" onClick={() => go("book", { mode: "move", ref: open.id })}><Clock size={16} /> ขอเปลี่ยนวัน/เวลา</button>
              <button className="btn" onClick={() => go("book", { mode: "cancel", ref: open.id })}><Ban size={16} /> ขอยกเลิกคาบ</button>
              <button className="btn" onClick={() => go("equipment", { ref: open.id })}><Wrench size={16} /> ขอใช้อุปกรณ์</button>
            </div>
          )}
          <ContactList contacts={settings.contacts} />
        </Modal>
      )}
    </>
  );
}

// ─── ช่องตัวเลข + / − ─────────────────────────────────────────────
function Qty({ label, value, onChange }) {
  const v = value || 0;
  return (
    <div className={"qty" + (v ? " on" : "")}>
      <span>{label}</span>
      <div className="stepper">
        <button type="button" aria-label={`ลด ${label}`} onClick={() => onChange(Math.max(0, v - 1))}>−</button>
        <output aria-live="polite">{v}</output>
        <button type="button" aria-label={`เพิ่ม ${label}`} onClick={() => onChange(v + 1)}>+</button>
      </div>
    </div>
  );
}

function ClashBox({ hard, soft, settings, roomName }) {
  if (!hard.length && !soft.length) return null;
  const item = (b) => <li key={b.id}>{b.start}–{b.end} น. {b.status === "pending" ? "(มีคนขอไว้ รอคอนเฟิร์ม)" : `· ${b.title || roleName(b)}`}</li>;
  if (hard.length) return (
    <div className="alert warn" role="alert">
      <div className="alert-title"><AlertTriangle size={20} style={{ flex: "none" }} />ช่วงเวลานี้มีตารางชน โปรดติดต่อแอดมิน</div>
      <ul>{hard.map(item)}</ul>
      <ContactList contacts={settings.contacts} />
    </div>
  );
  return (
    <div className="alert amber" role="status">
      <div className="alert-title"><AlertTriangle size={20} style={{ flex: "none" }} />มีคนขอช่วงเวลานี้ไว้แล้ว (ยังรอคอนเฟิร์ม)</div>
      <ul>{soft.map(item)}</ul>
      <span style={{ fontSize: 14 }}>ส่งคำขอได้ แต่ทีมงานจะพิจารณาตามลำดับ หรือติดต่อแอดมินก่อนก็ได้</span>
      <ContactList contacts={settings.contacts} />
    </div>
  );
}

// ─── หน้าขอใช้ห้อง (ลิงก์ส่งให้อาจารย์ / นักเรียน / ผู้เช่า) ───────────────
function BookPage({ bookings, settings, setBookings, params }) {
  const times = timeOptions(settings, false), endTimes = timeOptions(settings, true);
  const initStart = times.includes(params.get("start")) ? params.get("start") : "17:00";
  const nextHour = (t) => { const m = toMin(t) + 60; const v = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; return endTimes.includes(v) ? v : endTimes[endTimes.length - 1]; };
  const [f, setF] = useState({
    role: ["teacher", "student", "renter"].includes(params.get("as")) ? params.get("as") : "teacher",
    title: "", name: "", phone: "", line: "",
    room: settings.rooms.some((r) => r.id === params.get("room")) ? params.get("room") : settings.rooms[0]?.id,
    date: params.get("date") || ymd(new Date()), start: initStart, end: nextHour(initStart),
    purpose: "class", showDetail: "", audience: "", equipment: {}, equipNote: "", note: "",
  });
  const [sent, setSent] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const R = ROLES[f.role];
  const validTime = toMin(f.start) < toMin(f.end);
  const all = clashes(f, bookings, false);
  const hard = all.filter((b) => b.status === "confirmed"); const soft = all.filter((b) => b.status === "pending");
  const dayNotes = bookings.filter((b) => isSlot(b) && b.allDay && b.date === f.date && b.room === f.room && LIVE(b));
  const missing = [!f.title && "หัวข้อ", !f.name && "ชื่อ", !f.phone && "เบอร์โทร", !f.date && "วันที่"].filter(Boolean);
  const roomName = (id) => settings.rooms.find((r) => r.id === id)?.name || "";

  const submit = async () => {
    setErr("");
    if (missing.length) { setErr("กรอกให้ครบก่อน: " + missing.join(", ")); return; }
    if (!validTime) { setErr("เวลาเลิกต้องหลังเวลาเริ่ม"); return; }
    setBusy(true);
    try {
      const fresh = await loadBookings();
      if (clashes(f, fresh, true).length) { setBookings(fresh); setErr("เพิ่งมีการยืนยันช่วงเวลานี้ไป โปรดเลือกเวลาใหม่หรือติดต่อแอดมิน"); setBusy(false); return; }
      const b = { ...f, id: uid(), kind: "request", status: "pending", createdAt: new Date().toISOString() };
      if (f.purpose !== "show") { delete b.showDetail; delete b.audience; }
      await upsertBookings([b]);
      setBookings([...fresh, b]); setSent(b);
      notifyTeam(`📥 มีคำขอใช้ห้องใหม่ (${R.label})\n${b.title}\n${fmtDate(b.date)} ${b.start}–${b.end}${settings.rooms.length > 1 ? " · " + roomName(b.room) : ""}\nโดย ${b.name} ${b.phone}\nเข้าไปอนุมัติที่หน้าแอดมิน`);
    } catch (e) { setErr("ส่งไม่สำเร็จ: " + (e.message || e)); }
    setBusy(false);
  };

  if (sent) return (
    <div className="panel done">
      <div className="mark"><Check size={34} /></div>
      <h1 style={{ margin: 0, fontSize: 22 }}>ส่งคำขอใช้ห้องแล้ว</h1>
      <p style={{ margin: 0 }}>{sent.title}<br />{fmtDate(sent.date)} เวลา {sent.start}–{sent.end} น.</p>
      <p className="note-small" style={{ margin: 0 }}>ทีมงานจะตรวจสอบและยืนยันห้องให้ สงสัยอะไรติดต่อแอดมินได้ที่</p>
      <div style={{ width: "100%", maxWidth: 460 }}><ContactList contacts={settings.contacts} /></div>
      <div className="actions" style={{ justifyContent: "center" }}>
        <button className="btn" onClick={() => go("home")}>ดูตารางห้อง</button>
        <button className="btn primary" onClick={() => { setSent(null); setF((x) => ({ ...x, title: "", note: "" })); }}>จองอีกช่วงเวลา</button>
      </div>
    </div>
  );

  return (
    <div className="form">

      <section className="sec">
        <h3>ผู้ขอใช้ห้อง</h3>
        <div className="seg">
          {Object.entries(ROLES).map(([k, r]) => <button key={k} type="button" className={f.role === k ? "on" : ""} onClick={() => set("role", k)}>{r.label}</button>)}
        </div>
        <label className="f"><span>{R.title} <em>*</em></span><input className="in" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={f.role === "teacher" ? "เช่น Basic Live Sound" : f.role === "student" ? "เช่น ซ้อมวง / อัดเดโม่" : "เช่น คอนเสิร์ตวง ..."} /></label>
        <div className="row">
          <label className="f"><span>{R.name} <em>*</em></span><input className="in" value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" /></label>
          <label className="f"><span>เบอร์โทร <em>*</em></span><input className="in" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" /></label>
          <label className="f"><span>LINE ID</span><input className="in" value={f.line} onChange={(e) => set("line", e.target.value)} /></label>
        </div>
      </section>

      <section className="sec">
        <h3>วันและเวลาที่ใช้ห้อง</h3>
        <div className="row">
          {settings.rooms.length > 1 && (
            <label className="f"><span>ห้อง</span><select className="in" value={f.room} onChange={(e) => set("room", e.target.value)}>{settings.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          )}
          <label className="f"><span>วันที่ <em>*</em></span><input className="in" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label className="f"><span>เริ่ม</span><select className="in" value={f.start} onChange={(e) => { const s = e.target.value; setF((x) => ({ ...x, start: s, end: toMin(x.end) > toMin(s) ? x.end : nextHour(s) })); }}>{times.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="f"><span>ถึงกี่โมง</span><select className="in" value={f.end} onChange={(e) => set("end", e.target.value)}>{endTimes.map((t) => <option key={t} disabled={toMin(t) <= toMin(f.start)}>{t}</option>)}</select></label>
        </div>
        {f.date && <span className="note-small">{fmtDate(f.date)} · {f.start}–{f.end} น.</span>}
        <ClashBox hard={hard} soft={soft} settings={settings} />
        {dayNotes.length > 0 && !hard.length && (
          <div className="alert amber" role="status">
            <div className="alert-title"><AlertTriangle size={20} style={{ flex: "none" }} />วันนี้ในตารางมี: {dayNotes.map((b) => b.title).join(", ")}</div>
            <span style={{ fontSize: 14 }}>เช็กกับแอดมินก่อนว่าห้องว่างช่วงที่ต้องการไหม</span>
            <ContactList contacts={settings.contacts} />
          </div>
        )}
      </section>

      <section className="sec">
        <h3>ใช้ห้องทำอะไร</h3>
        <div className="seg">
          {PURPOSES.map(([k, l]) => <button key={k} type="button" className={f.purpose === k ? "on" : ""} onClick={() => set("purpose", k)}>{l}</button>)}
        </div>
        {f.purpose === "show" && (
          <>
            <label className="f"><span>รูปแบบโชว์ / คอนเสิร์ต</span><textarea className="in" value={f.showDetail} onChange={(e) => set("showDetail", e.target.value)} placeholder="เช่น วงดนตรี 5 ชิ้น เล่นสด 2 ชั่วโมง มีเวลาซาวด์เช็ก 15:00 เปิดประตู 18:30" /></label>
            <label className="f" style={{ maxWidth: 220 }}><span>ผู้ชมประมาณ (คน)</span><input className="in" inputMode="numeric" value={f.audience} onChange={(e) => set("audience", e.target.value.replace(/[^0-9]/g, ""))} /></label>
          </>
        )}
      </section>

      <section className="sec">
        <h3>อุปกรณ์ที่ต้องใช้</h3>
        <div className="qty-list">
          {settings.equipment.map((q) => <Qty key={q.id} label={q.name} value={f.equipment[q.id]} onChange={(v) => set("equipment", { ...f.equipment, [q.id]: v })} />)}
        </div>
        <label className="f"><span>อุปกรณ์อื่นๆ ที่ต้องการ</span><input className="in" value={f.equipNote} onChange={(e) => set("equipNote", e.target.value)} placeholder="เช่น ต่อโน้ตบุ๊กออกจอผ่าน HDMI" /></label>
      </section>

      <section className="sec">
        <label className="f"><span>หมายเหตุถึงทีมงาน</span><textarea className="in" value={f.note} onChange={(e) => set("note", e.target.value)} /></label>
      </section>

      {err && <div className="alert warn" role="alert">{err}</div>}
      <SubmitBar busy={busy} disabled={hard.length > 0} onSubmit={submit} label={hard.length ? "ช่วงเวลานี้ไม่ว่าง" : "ส่งคำขอใช้ห้อง"} />
    </div>
  );
}

// ─── หลังบ้าน ────────────────────────────────────────────────────
function AdminGate({ children, allowStaff }) {
  const key = allowStaff ? "twt-rooms-staff-ok" : "twt-rooms-ok";
  const [ok, setOk] = useState(() => !PIN || sessionStorage.getItem("twt-rooms-ok") === "1" || sessionStorage.getItem(key) === "1");
  const [pin, setPin] = useState(""); const [bad, setBad] = useState(false);
  if (ok) return children;
  const tryPin = () => { if (pin === PIN || (allowStaff && STAFF_PIN && pin === STAFF_PIN)) { sessionStorage.setItem(key, "1"); setOk(true); } else setBad(true); };
  return (
    <div className="pin panel">
      <Lock size={28} style={{ margin: "0 auto", color: "var(--blue)" }} />
      <h1 style={{ margin: 0, fontSize: 20 }}>{allowStaff ? "รับรองคาบ / งาน" : "หน้าแอดมิน"}</h1>
      <input className="in" type="password" inputMode="numeric" autoFocus value={pin} aria-label="PIN"
        onChange={(e) => { setPin(e.target.value); setBad(false); }} onKeyDown={(e) => e.key === "Enter" && tryPin()} />
      {bad && <span style={{ color: "var(--warn)" }}>PIN ไม่ถูกต้อง</span>}
      <button className="btn primary" onClick={tryPin}>เข้าสู่ระบบ</button>
      <button className="btn ghost" onClick={() => go("home")}>กลับหน้าตาราง</button>
    </div>
  );
}

function Admin({ bookings, settings, setBookings, editSettings, saveState, saveErr, shifts, setShifts, say }) {
  const [tab, setTab] = useState("pending");
  const pending = bookings.filter((b) => b.status === "pending");
  const [me, setMe] = useMe();
  const { save, remove, approve, reject, cancel } = useBookingActions({ bookings, setBookings, say, me });
  const actions = { save, remove, approve, reject, cancel };

  return (
    <>
      <nav className="tabs">
        <button className={"tab" + (tab === "pending" ? " on" : "")} onClick={() => setTab("pending")}><Inbox size={17} /> รอรับรอง {pending.length > 0 && <span className="badge">{pending.length}</span>}</button>
        <button className={"tab" + (tab === "grid" ? " on" : "")} onClick={() => setTab("grid")}><CalendarDays size={17} /> ตาราง / ลงคาบเรียน</button>
        <button className={"tab" + (tab === "shifts" ? " on" : "")} onClick={() => setTab("shifts")}><Users size={17} /> กะพนักงาน</button>
        <button className={"tab" + (tab === "ot" ? " on" : "")} onClick={() => setTab("ot")}><Calculator size={17} /> ค่าโอที</button>
        <button className={"tab" + (tab === "settings" ? " on" : "")} onClick={() => setTab("settings")}><Settings size={17} /> ตั้งค่า</button>
      </nav>
      {tab === "pending" && <><ApproverPicker settings={settings} me={me} setMe={setMe} /><PendingTab bookings={bookings} settings={settings} {...actions} /></>}
      {tab === "ot" && <OTTab settings={settings} editSettings={editSettings} shifts={shifts} say={say} />}
      {tab === "grid" && <AdminGrid bookings={bookings} settings={settings} {...actions} say={say} />}
      {tab === "shifts" && <ShiftsView settings={settings} bookings={bookings} shifts={shifts} setShifts={setShifts} editable say={say} />}
      {tab === "settings" && <SettingsTab settings={settings} editSettings={editSettings} saveState={saveState} saveErr={saveErr} say={say} bookings={bookings} setBookings={setBookings} />}
    </>
  );
}

function RequestCard({ b, bookings, settings, approve, reject, remove, cancel, onEdit, save }) {
  const rn = (id) => settings.rooms.find((r) => r.id === id)?.name || "";
  const roomName = rn(b.room);
  const ref = b.refId ? bookings.find((x) => x.id === b.refId) : null;
  const slotView = b.kind === "change" && b.action === "move" ? { ...b, id: b.refId } : b;
  const c = isSlot(b) || (b.kind === "change" && b.action === "move") ? clashes(slotView, bookings, false) : [];
  const equips = isSlot(b) ? bookings.filter((x) => x.kind === "equip" && x.refId === b.id && LIVE(x)) : [];
  const eqName = (id) => settings.equipment.find((q) => q.id === id)?.name || id;
  const stName = (id) => (settings.staff || []).find((q) => q.id === id)?.name || id;
  const eq = Object.entries(b.equipment || {}).filter(([, v]) => v > 0);
  const st = Object.entries(b.staff || {}).filter(([, v]) => v > 0);
  return (
    <article className="req" style={{ "--c": colorOf(b) }}>
      <div className="req-head">
        <h3>{b.title || roleName(b)}</h3>
        <span className="pill c">{kindLabel(b)}</span>
        <span className={"pill st-" + b.status}>{STATUS[b.status]}</span>
      </div>
      <dl className="kv">
        {b.kind === "change" || b.kind === "equip" ? (
          <>
            <dt>คาบ</dt><dd>{ref ? <><b>{fmtDate(b.from?.date || ref.date)}</b> · {b.from ? `${b.from.start}–${b.from.end} น.` : timeText(ref)}{settings.rooms.length > 1 ? ` · ${rn(b.from?.room || ref.room)}` : ""}</> : "ไม่พบคาบเดิม (อาจถูกลบไปแล้ว)"}</dd>
            {b.kind === "change" && b.action === "move" && <><dt>เปลี่ยนเป็น</dt><dd><b>{fmtDate(b.date)}</b> · {timeText(b)}{settings.rooms.length > 1 ? ` · ${roomName}` : ""}</dd></>}
            {b.reason && <><dt>เหตุผล</dt><dd style={{ whiteSpace: "pre-wrap" }}>{b.reason}</dd></>}
          </>
        ) : <><dt>วันเวลา</dt><dd><b>{fmtDate(b.date)}</b> · {timeText(b)}{settings.rooms.length > 1 ? ` · ${roomName}` : ""}</dd></>}
        {b.name && <><dt>{b.kind === "class" ? "อาจารย์" : "ผู้ขอ"}</dt><dd>{b.name}</dd></>}
        {(b.phone || b.line) && <><dt>ติดต่อ</dt><dd className="chips">
          {b.phone && <a className="chip" href={telLink(b.phone)}>📞 {b.phone}</a>}
          {b.line && <a className="chip" href={lineLink(b.line)} target="_blank" rel="noreferrer">LINE {b.line}</a>}
        </dd></>}
        {b.kind === "request" && b.source !== "excel" && <><dt>ใช้ทำ</dt><dd>{purposeName(b.purpose)}</dd></>}
        {b.showDetail && <><dt>รูปแบบโชว์</dt><dd style={{ whiteSpace: "pre-wrap" }}>{b.showDetail}</dd></>}
        {b.audience && <><dt>ผู้ชม</dt><dd>~{b.audience} คน</dd></>}
        {(eq.length > 0 || b.equipNote) && <><dt>อุปกรณ์</dt><dd className="chips">{eq.map(([k, v]) => <span className="chip" key={k}>{eqName(k)} × {v}</span>)}{b.equipNote && <span className="chip">{b.equipNote}</span>}</dd></>}
        {st.length > 0 && <><dt>ทีมงาน</dt><dd className="chips">{st.map(([k, v]) => <span className="chip" key={k}>{stName(k)} × {v}</span>)}</dd></>}
        {b.note && <><dt>หมายเหตุ</dt><dd style={{ whiteSpace: "pre-wrap" }}>{b.note}</dd></>}
        {b.adminNote && <><dt>หมายเหตุแอดมิน</dt><dd>{b.adminNote}</dd></>}
        {b.approvedBy && <><dt>{b.status === "rejected" ? "ไม่อนุมัติโดย" : "รับรองโดย"}</dt><dd>{b.approvedBy}</dd></>}
        {equips.length > 0 && <><dt>ขออุปกรณ์เพิ่ม</dt><dd className="chips">{equips.map((x) => <span className="chip" key={x.id}>{Object.entries(x.equipment || {}).filter(([, v]) => v > 0).map(([k, v]) => `${eqName(k)} × ${v}`).join(", ")}{x.equipNote ? ` · ${x.equipNote}` : ""} ({STATUS[x.status]})</span>)}</dd></>}
      </dl>
      {isSlot(b) && save && LIVE(b) && <CrewPicker b={b} settings={settings} save={save} />}
      {c.length > 0 && LIVE(b) && (
        <div className="alert warn"><div className="alert-title"><AlertTriangle size={18} />ชนกับ {c.length} รายการ</div>
          <ul>{c.map((x) => <li key={x.id}>{x.start}–{x.end} {x.title || roleName(x)} ({x.name}) · {STATUS[x.status]}</li>)}</ul></div>
      )}
      <div className="actions">
        {b.status === "pending" && <button className="btn ok" onClick={() => approve(b)}><Check size={17} /> {isSlot(b) ? "อนุมัติห้อง" : "รับรอง"}</button>}
        {b.status === "pending" && <button className="btn" onClick={() => reject(b)}><X size={17} /> ไม่อนุมัติ</button>}
        {(b.status === "rejected" || b.status === "cancelled") && isSlot(b) && <button className="btn" onClick={() => approve(b)}><Check size={17} /> คืนสถานะ</button>}
        {isSlot(b) && b.status === "confirmed" && cancel && <button className="btn" onClick={() => cancel(b)}><Ban size={16} /> ยกเลิกคาบ</button>}
        {onEdit && <button className="btn" onClick={() => onEdit(b)}><Pencil size={16} /> แก้ไข</button>}
        <button className="btn danger" onClick={async () => {
          if (b.series && window.confirm("ลบคาบนี้ทุกสัปดาห์ในชุดเดียวกันด้วยไหม?\nตกลง = ลบทั้งชุด / ยกเลิก = เลือกลบเฉพาะวันนี้")) { await remove(bookings.filter((x) => x.series === b.series && x.date >= b.date).map((x) => x.id)); return; }
          if (window.confirm("ลบรายการนี้?")) await remove([b.id]);
        }}><Trash2 size={16} /> ลบ</button>
      </div>
    </article>
  );
}

function PendingTab({ bookings, settings, approve, reject, remove, cancel, save }) {
  const [hist, setHist] = useState(false);
  const pending = bookings.filter((b) => b.status === "pending").sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const done = bookings.filter((b) => b.kind !== "class" && b.status !== "pending" && b.decidedAt).sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || "")).slice(0, 40);
  return (
    <div className="req-list">
      {pending.length ? pending.map((b) => <RequestCard key={b.id} b={b} bookings={bookings} settings={settings} approve={approve} reject={reject} remove={remove} cancel={cancel} save={save} />)
        : <div className="panel" style={{ textAlign: "center" }}><p style={{ margin: 0 }}>ไม่มีคำขอที่รอคอนเฟิร์ม</p><p className="note-small" style={{ margin: "4px 0 0" }}>ส่งลิงก์จองห้องให้อาจารย์หรือนักเรียนได้จากแท็บ ตั้งค่า</p></div>}
      <button className="btn" style={{ justifySelf: "start" }} onClick={() => setHist(!hist)}>{hist ? "ซ่อนประวัติ" : `ดูคำขอที่ตัดสินแล้ว (${done.length})`}</button>
      {hist && done.map((b) => <RequestCard key={b.id} b={b} bookings={bookings} settings={settings} approve={approve} reject={reject} remove={remove} cancel={cancel} save={save} />)}
    </div>
  );
}

function AdminGrid({ bookings, settings, save, remove, approve, reject, cancel, say }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [room, setRoom] = useState(settings.rooms.length > 1 ? "all" : settings.rooms[0]?.id);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const newClass = (date, start) => setForm({ date: date || ymd(new Date()), start: start || "17:00", room: room === "all" ? settings.rooms[0]?.id : room });
  return (
    <>
      <WeekBar weekStart={weekStart} setWeekStart={setWeekStart} settings={settings} room={room} setRoom={setRoom}
        right={<button className="btn primary" onClick={() => newClass()}><Plus size={17} /> ลงคาบเรียน</button>} />
      <WeekGrid settings={settings} bookings={bookings} room={room} weekStart={weekStart} onEmpty={newClass} onOpen={setOpen} />
      <Legend settings={settings} room={room} />
      <p className="note-small">แตะช่องว่างเพื่อลงคาบเรียน · กรอบสีแดง = ตารางชน</p>
      {open && (
        <Modal title="รายละเอียด" onClose={() => setOpen(null)}>
          <RequestCard b={bookings.find((x) => x.id === open.id) || open} bookings={bookings} settings={settings} save={save}
            approve={async (b) => { await approve(b); setOpen(null); }} reject={async (b) => { await reject(b); setOpen(null); }} cancel={async (b) => { await cancel(b); setOpen(null); }}
            remove={async (ids) => { await remove(ids); setOpen(null); }}
            onEdit={(b) => { setOpen(null); setForm(b); }} />
        </Modal>
      )}
      {form && <ClassForm init={form} settings={settings} bookings={bookings} onClose={() => setForm(null)}
        onSave={async (list) => { if (await save(list)) { setForm(null); say(list.length > 1 ? `ลงคาบเรียนแล้ว ${list.length} สัปดาห์` : "บันทึกแล้ว"); } }} />}
    </>
  );
}

function ClassForm({ init, settings, bookings, onClose, onSave }) {
  const editing = !!init.id;
  const times = timeOptions(settings, false), endTimes = timeOptions(settings, true);
  const plus = (t, m) => { const x = toMin(t) + m; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
  const [f, setF] = useState(() => ({
    kind: "class", role: "admin", title: "", name: "", phone: "", line: "", note: "",
    ...init, room: init.room || settings.rooms[0]?.id, end: init.end || (endTimes.includes(plus(init.start, 60)) ? plus(init.start, 60) : endTimes[endTimes.length - 1]),
  }));
  const [weeks, setWeeks] = useState(1);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const series = editing ? null : weeks > 1 ? uid() : null;
  const occ = useMemo(() => {
    const n = editing ? 1 : Math.max(1, Math.min(52, weeks));
    return Array.from({ length: n }, (_, i) => ({ ...f, date: ymd(addDays(parseYmd(f.date), i * 7)) }));
  }, [f, weeks, editing]);
  const withClash = occ.map((o) => ({ o, c: clashes(o, bookings, false) }));
  const bad = withClash.filter((x) => x.c.length);
  const ok = withClash.filter((x) => !x.c.length).map((x) => x.o);
  const valid = f.title && f.date && (f.allDay || toMin(f.start) < toMin(f.end));
  const build = (list) => list.map((o) => ({ ...o, id: editing ? o.id : uid(), kind: f.kind || "class", status: editing ? o.status : "confirmed", series: editing ? o.series : series, createdAt: o.createdAt || new Date().toISOString() }));
  return (
    <Modal title={editing ? "แก้ไขรายการ" : "ลงคาบเรียน"} onClose={onClose}>
      <section className="sec">
        <label className="f"><span>วิชา / ชื่อคาบ <em>*</em></span><input className="in" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} /></label>
        <div className="row">
          <label className="f"><span>อาจารย์</span><input className="in" value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="f"><span>เบอร์โทร</span><input className="in" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
          <label className="f"><span>LINE ID</span><input className="in" value={f.line} onChange={(e) => set("line", e.target.value)} /></label>
        </div>
        <div className="row">
          {settings.rooms.length > 1 && <label className="f"><span>ห้อง</span><select className="in" value={f.room} onChange={(e) => set("room", e.target.value)}>{settings.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
          <label className="f"><span>วันที่</span><input className="in" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label className="f"><span>เริ่ม</span><select className="in" value={f.start} onChange={(e) => set("start", e.target.value)}>{times.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="f"><span>ถึง</span><select className="in" value={f.end} onChange={(e) => set("end", e.target.value)}>{endTimes.map((t) => <option key={t} disabled={toMin(t) <= toMin(f.start)}>{t}</option>)}</select></label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!f.allDay} onChange={(e) => set("allDay", e.target.checked)} /> ทั้งวัน (แสดงเป็นป้ายบนหัววัน เช่น วันหยุด / เช่าทั้งวัน)</label>
        {!editing && (
          <label className="f" style={{ maxWidth: 260 }}><span>ทำซ้ำทุกสัปดาห์ (จำนวนสัปดาห์)</span>
            <input className="in" type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value) || 1)} /></label>
        )}
        <span className="note-small">{fmtDate(f.date)} · {timeText(f)}{weeks > 1 && !editing ? ` · ${weeks} สัปดาห์ ถึง${fmtDate(occ[occ.length - 1].date).replace("วัน" + dayName(f.date), "")}` : ""}</span>
        <label className="f"><span>หมายเหตุ</span><input className="in" value={f.note || ""} onChange={(e) => set("note", e.target.value)} /></label>
      </section>
      {bad.length > 0 && (
        <div className="alert warn" role="alert">
          <div className="alert-title"><AlertTriangle size={20} />ตารางชน {bad.length} วัน</div>
          <ul>{bad.map(({ o, c }) => <li key={o.date}>{fmtDate(o.date)}: ชนกับ {c.map((x) => `${x.title || roleName(x)} ${x.start}–${x.end}`).join(", ")}</li>)}</ul>
        </div>
      )}
      <div className="actions">
        <button className="btn primary" disabled={!valid || !ok.length} onClick={() => onSave(build(ok))}>
          {bad.length && ok.length ? `บันทึกเฉพาะวันที่ไม่ชน (${ok.length})` : editing ? "บันทึก" : "ลงคาบเรียน"}
        </button>
        {bad.length > 0 && <button className="btn" disabled={!valid} onClick={() => window.confirm("บันทึกทั้งหมดรวมวันที่ชนด้วย?") && onSave(build(occ))}>บันทึกทั้งหมดแม้จะชน</button>}
        <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
      </div>
    </Modal>
  );
}

// ─── ตั้งค่า ──────────────────────────────────────────────────────
function SettingsTab({ settings, editSettings, saveState, saveErr, say, bookings, setBookings }) {
  const s = settings;
  // แก้ทีละช่อง/ทีละรายการ แล้วระบบรวมกับของคนอื่นตอนบันทึก
  const upd = (k, v) => editSettings((d) => ({ ...d, [k]: v }));
  const listUpd = (k, id, patch) => editSettings((d) => ({ ...d, [k]: (d[k] || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const listDel = (k, id) => editSettings((d) => ({ ...d, [k]: (d[k] || []).filter((x) => x.id !== id) }));
  const listAdd = (k, item) => editSettings((d) => ({ ...d, [k]: [...(d[k] || []), item] }));
  const base = HASH ? window.location.origin + window.location.pathname + "#" : window.location.origin;
  const links = [["ตารางห้อง (ทุกคนดูได้)", base + "/"], ["ลิงก์จองห้อง ส่งให้อาจารย์", base + "/book?as=teacher"], ["ลิงก์จองห้อง ส่งให้นักเรียน", base + "/book?as=student"], ["ลิงก์จองห้อง ผู้เช่าสถานที่", base + "/book?as=renter"], ["ลิงก์เปลี่ยนวัน/เวลา หรือยกเลิกคาบ", base + "/book?mode=move"], ["ลิงก์ขอใช้อุปกรณ์ (อาจารย์ประจำ)", base + "/equipment"], ["หน้ารับรองคาบ/งาน (แอดมิน + พนักงาน)", base + "/approve"], ["ตารางกะพนักงาน (ดูอย่างเดียว)", base + "/staff"], ["หน้าแอดมิน", base + "/admin"]];
  const copy = (t) => { navigator.clipboard?.writeText(t).then(() => say("คัดลอกลิงก์แล้ว"), () => window.prompt("คัดลอกลิงก์นี้", t)); };

  const hours = Array.from({ length: 25 }, (_, i) => i);
  return (
    <div className="form" style={{ maxWidth: 760 }}>
      <div className={"autosave " + saveState} role="status">
        {saveState === "saving" ? "กำลังบันทึก…" : saveState === "error" ? `บันทึกไม่สำเร็จ: ${saveErr} (จะลองใหม่เมื่อแก้ครั้งถัดไป)` : saveState === "saved" ? "✓ บันทึกแล้ว · แก้ได้พร้อมกันหลายคน ทุกเครื่องเห็นทันที" : "แก้แล้วบันทึกอัตโนมัติ · แก้ได้พร้อมกันหลายคน ทุกเครื่องเห็นทันที"}
      </div>
      <section className="sec">
        <h3>ผู้ติดต่อเมื่อตารางชน</h3>
        <span className="note-small">ชื่อและเบอร์นี้จะขึ้นให้คนจองเห็นตอนเลือกเวลาที่ชน และหลังส่งคำขอ</span>
        <div className="list-edit">
          {s.contacts.map((c) => (
            <div className="line" key={c.id}>
              <input className="in" placeholder="ชื่อ" value={c.name} onChange={(e) => listUpd("contacts", c.id, { name: e.target.value })} />
              <input className="in" placeholder="เบอร์โทร" type="tel" value={c.phone} onChange={(e) => listUpd("contacts", c.id, { phone: e.target.value })} />
              <input className="in" placeholder="LINE ID หรือ @OA" value={c.line} onChange={(e) => listUpd("contacts", c.id, { line: e.target.value })} />
              <button className="btn icon-btn danger" aria-label="ลบผู้ติดต่อ" onClick={() => listDel("contacts", c.id)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => listAdd("contacts", { id: uid(), name: "", phone: "", line: "" })}><Plus size={16} /> เพิ่มผู้ติดต่อ</button>
      </section>

      <section className="sec">
        <h3>ห้อง</h3>
        <div className="list-edit">
          {s.rooms.map((r) => (
            <div className="line color" key={r.id}>
              <input type="color" className="swatch" aria-label={"สีของ " + r.name} title="เลือกสีเอง (ไม่เลือก = สีอัตโนมัติตามโหมดสว่าง/มืด)" value={roomColor(s, r.id).startsWith("#") ? roomColor(s, r.id) : "#888888"} onChange={(e) => listUpd("rooms", r.id, { color: e.target.value })} />
              <input className="in" value={r.name} onChange={(e) => listUpd("rooms", r.id, { name: e.target.value })} />
              <button className="btn icon-btn danger" aria-label="ลบห้อง" disabled={s.rooms.length < 2} onClick={() => window.confirm(`ลบ ${r.name}? (รายการจองของห้องนี้จะไม่แสดงในตาราง)`) && listDel("rooms", r.id)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => listAdd("rooms", { id: uid(), name: "ห้อง " + (s.rooms.length + 1) })}><Plus size={16} /> เพิ่มห้อง</button>
      </section>

      <section className="sec">
        <h3>รายการอุปกรณ์ในฟอร์มจอง</h3>
        <div className="list-edit">
          {s.equipment.map((q) => (
            <div className="line two" key={q.id}>
              <input className="in" value={q.name} onChange={(e) => listUpd("equipment", q.id, { name: e.target.value })} />
              <button className="btn icon-btn danger" aria-label="ลบอุปกรณ์" onClick={() => listDel("equipment", q.id)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => listAdd("equipment", { id: uid(), name: "" })}><Plus size={16} /> เพิ่มอุปกรณ์</button>
      </section>

      <section className="sec">
        <h3>พนักงาน ({s.staffMembers.length} คน)</h3>
        <span className="note-small">รายชื่อนี้ใช้ในตารางกะพนักงาน เพิ่ม/ลดได้ตามจำนวนคนจริง</span>
        <div className="list-edit">
          {s.staffMembers.map((m) => (
            <div className="line three color" key={m.id}>
              <input type="color" className="swatch" aria-label={"สีของ " + (m.name || "พนักงาน")} title="สีประจำตัวในตารางกะ" value={staffColor(s, m.id).startsWith("#") ? staffColor(s, m.id) : STAFF_HEX[Math.max(0, s.staffMembers.findIndex((x) => x.id === m.id)) % 8]} onChange={(e) => listUpd("staffMembers", m.id, { color: e.target.value })} />
              <input className="in" placeholder="ชื่อ / ชื่อเล่น" value={m.name} onChange={(e) => listUpd("staffMembers", m.id, { name: e.target.value })} />
              <input className="in" placeholder="หน้าที่ เช่น Sound / Light" value={m.role || ""} onChange={(e) => listUpd("staffMembers", m.id, { role: e.target.value })} />
              <button className="btn icon-btn danger" aria-label="ลบพนักงาน" onClick={() => window.confirm(`ลบ ${m.name || "พนักงาน"} ออกจากรายชื่อ?`) && listDel("staffMembers", m.id)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => listAdd("staffMembers", { id: uid(), name: "", role: "" })}><Plus size={16} /> เพิ่มพนักงาน</button>
      </section>

      <section className="sec">
        <h3>กะที่ใช้บ่อย</h3>
        <span className="note-small">กดเลือกได้เร็วตอนลงกะ</span>
        <div className="list-edit">
          {s.shiftPresets.map((q) => (
            <div className="line" key={q.id}>
              <input className="in" value={q.name} onChange={(e) => listUpd("shiftPresets", q.id, { name: e.target.value })} />
              <select className="in" value={q.start} onChange={(e) => listUpd("shiftPresets", q.id, { start: e.target.value })}>{DAY_TIMES.slice(0, -1).map((t) => <option key={t}>{t}</option>)}</select>
              <select className="in" value={q.end} onChange={(e) => listUpd("shiftPresets", q.id, { end: e.target.value })}>{DAY_TIMES.slice(1).map((t) => <option key={t}>{t}</option>)}</select>
              <button className="btn icon-btn danger" aria-label="ลบกะ" onClick={() => listDel("shiftPresets", q.id)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => listAdd("shiftPresets", { id: uid(), name: "กะใหม่", start: "09:00", end: "18:00" })}><Plus size={16} /> เพิ่มกะ</button>
      </section>

      <section className="sec">
        <h3>หน้าตาตาราง</h3>
        <div className="row">
          <label className="f"><span>ชื่อที่หัวเว็บ</span><input className="in" value={s.orgName} onChange={(e) => upd("orgName", e.target.value)} /></label>
          <label className="f"><span>ตารางเริ่ม</span><select className="in" value={s.startHour} onChange={(e) => upd("startHour", Number(e.target.value))}>{hours.filter((h) => h < s.endHour).map((h) => <option key={h} value={h}>{pad(h)}:00</option>)}</select></label>
          <label className="f"><span>ตารางจบ</span><select className="in" value={s.endHour} onChange={(e) => upd("endHour", Number(e.target.value))}>{hours.filter((h) => h > s.startHour).map((h) => <option key={h} value={h}>{pad(h)}:00</option>)}</select></label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={s.showWeekend} onChange={(e) => upd("showWeekend", e.target.checked)} /> แสดงวันเสาร์–อาทิตย์ด้วย</label>
      </section>



      <ImportBox settings={settings} editSettings={editSettings} bookings={bookings} setBookings={setBookings} say={say} />

      <section className="sec">
        <h3>ลิงก์สำหรับส่งต่อ</h3>
        {links.map(([l, u]) => (
          <div key={u} style={{ display: "grid", gap: 4 }}>
            <span className="note-small">{l}</span>
            <div className="linkbox"><code>{u}</code><button className="btn icon-btn" aria-label={"คัดลอก " + l} onClick={() => copy(u)}><Copy size={16} /></button></div>
          </div>
        ))}
        <span className="note-small">{mode === "cloud" ? "ข้อมูลเก็บบน Supabase ทุกเครื่องเห็นตรงกัน" : "ยังไม่ได้ต่อ Supabase ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น"}</span>
      </section>
    </div>
  );
}

// ─── นำเข้าตารางจาก Excel (ปฏิทินรายเดือน 1 ชีต = 1 เดือน) ─────────────────
function ImportBox({ settings, editSettings, bookings, setBookings, say }) {
  const [parsed, setParsed] = useState(null);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return ymd(d); });
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true);
    try { const r = parseCalendar(await readWorkbook(file)); setParsed({ ...r, file: file.name }); }
    catch (err) { say("อ่านไฟล์ไม่ได้: " + (err.message || err)); }
    setBusy(false); e.target.value = "";
  };
  const list = parsed ? parsed.bookings.filter((b) => b.date >= from) : [];
  const ids = new Set(bookings.map((b) => b.id));
  const fresh = list.filter((b) => !ids.has(b.id));
  const doImport = async () => {
    setBusy(true);
    try {
      const need = [ROOM_BB, ROOM_WB].filter((r) => list.some((b) => b.room === r.id) && !settings.rooms.some((x) => x.id === r.id));
      if (need.length) {
        const onlyDefault = settings.rooms.length === 1 && settings.rooms[0].id === "r1" && !bookings.some((b) => b.room === "r1");
        editSettings((d) => ({ ...d, rooms: [...(onlyDefault ? d.rooms.filter((r) => r.id !== "r1") : d.rooms).filter((r) => !need.some((n) => n.id === r.id)), ...need] }));
      }
      await upsertBookings(fresh);
      setBookings([...bookings, ...fresh]);
      say(`นำเข้าแล้ว ${fresh.length} รายการ`); setParsed(null);
    } catch (err) { say("นำเข้าไม่สำเร็จ: " + (err.message || err)); }
    setBusy(false);
  };
  return (
    <section className="sec">
      <h3>นำเข้าตารางจาก Excel</h3>
      <span className="note-small">รองรับไฟล์ปฏิทินแบบ 1 ชีต = 1 เดือน (หัวตาราง SUN–SAT) รายการที่มีคำว่า WhiteBox / WB จะเข้าห้อง White Box ที่เหลือเข้า Black Box · บรรทัดที่ไม่มีเวลาจะเป็นป้าย "ทั้งวัน" · นำเข้าซ้ำได้ ไม่เพิ่มซ้ำ</span>
      <input type="file" accept=".xlsx,.xls" onChange={pick} disabled={busy} />
      {busy && !parsed && <span className="note-small">กำลังอ่านไฟล์…</span>}
      {parsed && (
        <>
          <label className="f" style={{ maxWidth: 240 }}><span>นำเข้าตั้งแต่วันที่</span><input className="in" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <div className="alert okk">
            <div className="alert-title"><Check size={18} />{parsed.file}: พบ {list.length} รายการตั้งแต่วันที่เลือก</div>
            <span style={{ fontSize: 14 }}>มีเวลา {list.filter((b) => !b.allDay).length} · ทั้งวัน {list.filter((b) => b.allDay).length} · ใหม่ {fresh.length} · มีอยู่แล้ว {list.length - fresh.length}</span>
          </div>
          <div className="actions">
            <button className="btn primary" disabled={busy || !fresh.length} onClick={doImport}>{busy ? "กำลังนำเข้า…" : `นำเข้า ${fresh.length} รายการ`}</button>
            <button className="btn ghost" onClick={() => setParsed(null)}>ยกเลิก</button>
          </div>
        </>
      )}
    </section>
  );
}

// ─── กะพนักงาน: ใครเข้างานเวลาไหน ────────────────────────────────
function ShiftsView({ settings, bookings, shifts, setShifts, editable, say }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [cell, setCell] = useState(null); // { staff, date }
  const staff = settings.staffMembers || [];
  const dates = Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i)));
  const todayKey = ymd(new Date());
  const byCell = (sid, d) => shifts.filter((x) => x.staffId === sid && x.date === d).sort((a, b) => toMin(a.start) - toMin(b.start));
  const working = (d) => new Set(shifts.filter((x) => x.date === d && x.status !== "leave" && staff.some((m) => m.id === x.staffId)).map((x) => x.staffId)).size;
  const events = (d) => bookings.filter((b) => isSlot(b) && b.date === d && b.status === "confirmed").length;
  const end = addDays(weekStart, 6);

  const save = async (list) => { try { await upsertShifts(list); const m = new Map(shifts.map((x) => [x.id, x])); list.forEach((x) => m.set(x.id, x)); setShifts([...m.values()]); return true; } catch (e) { say("บันทึกไม่สำเร็จ: " + (e.message || e)); return false; } };
  const remove = async (ids) => { try { await deleteShifts(ids); setShifts(shifts.filter((x) => !ids.includes(x.id))); } catch (e) { say("ลบไม่สำเร็จ: " + (e.message || e)); } };
  const copyLastWeek = async () => {
    const prev = new Set(dates.map((d) => ymd(addDays(parseYmd(d), -7))));
    const src = shifts.filter((x) => prev.has(x.date));
    const add = src.map((x) => ({ ...x, id: uid(), date: ymd(addDays(parseYmd(x.date), 7)) }))
      .filter((n) => !shifts.some((x) => x.staffId === n.staffId && x.date === n.date && x.start === n.start && x.status === n.status));
    if (!add.length) { say("สัปดาห์ก่อนไม่มีกะให้คัดลอก"); return; }
    if (await save(add)) say(`คัดลอกมาแล้ว ${add.length} กะ`);
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn icon-btn" aria-label="สัปดาห์ก่อน" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => setWeekStart(mondayOf(new Date()))}>สัปดาห์นี้</button>
        <button className="btn icon-btn" aria-label="สัปดาห์ถัดไป" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={18} /></button>
        <span className="week-label">กะพนักงาน {weekStart.getDate()} {TH_M[weekStart.getMonth()]} – {end.getDate()} {TH_M[end.getMonth()]}</span>
        <div style={{ flex: 1 }} />
        {editable && <button className="btn" onClick={copyLastWeek}><Copy size={16} /> คัดลอกกะจากสัปดาห์ก่อน</button>}
        {editable && <button className="btn" onClick={() => copyText(pageUrl("staff"), say)}><Link2 size={16} /> ลิงก์ให้พนักงานดู</button>}
      </div>
      {!staff.length ? (
        <div className="panel" style={{ textAlign: "center" }}>
          <p style={{ margin: 0 }}>ยังไม่มีรายชื่อพนักงาน</p>
          {editable && <p className="note-small" style={{ margin: "4px 0 0" }}>เพิ่มพนักงานได้ที่แท็บ ตั้งค่า → พนักงาน</p>}
        </div>
      ) : (
        <div className="grid-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th className="who">พนักงาน</th>
                {dates.map((d) => (
                  <th key={d} className={d === todayKey ? "is-today" : ""} style={{ "--dc": dayVar(d) }}>
                    <span>{dayName(d)}</span><b>{parseYmd(d).getDate()} {TH_M[parseYmd(d).getMonth()]}</b>
                    <small>เข้างาน {working(d)} คน · งาน {events(d)}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id}>
                  <th className="who" style={{ "--sc": staffColor(settings, m.id) }}><b><i className="sdot" />{m.name || "—"}</b>{m.role && <span>{m.role}</span>}</th>
                  {dates.map((d) => {
                    const list = byCell(m.id, d);
                    const content = list.map((x) => (
                      <span key={x.id} className={"shift" + (x.status === "leave" ? " leave" : "")} style={{ "--sc": staffColor(settings, m.id) }}>
                        {x.status === "leave" ? "ลา" : `${x.start}–${x.end}`}{x.job === "ext" && x.status !== "leave" ? <i className="tag">นอก</i> : null}{x.note ? <em>{x.note}</em> : null}
                      </span>
                    ));
                    return (
                      <td key={d}>
                        {editable ? <button className="cell" onClick={() => setCell({ m, d })} aria-label={`ลงกะ ${m.name} ${fmtDate(d)}`}>{content.length ? content : <span className="add">+</span>}</button> : <div className="cell ro">{content}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && staff.length > 0 && <p className="note-small">แตะช่องเพื่อลงกะ · "งาน" = จำนวนรายการในห้องที่ยืนยันแล้ววันนั้น</p>}
      {cell && <ShiftModal m={cell.m} d={cell.d} settings={settings} bookings={bookings} list={byCell(cell.m.id, cell.d)} onClose={() => setCell(null)} save={save} remove={remove} />}
    </>
  );
}

function ShiftModal({ m, d, settings, bookings, list, onClose, save, remove }) {
  const [start, setStart] = useState("09:00"); const [end, setEnd] = useState("18:00"); const [note, setNote] = useState("");
  const hasRent = bookings.some((b) => isSlot(b) && b.date === d && LIVE(b) && b.role === "renter");
  const [job, setJob] = useState(hasRent ? "ext" : "uni");
  const ot = { ...DEFAULT_SETTINGS.ot, ...(settings.ot || {}) };
  const add = (x) => save([{ id: uid(), staffId: m.id, date: d, status: "work", note, job, ...x }]).then((ok) => ok && setNote(""));
  const dayEvents = bookings.filter((b) => isSlot(b) && b.date === d && b.status === "confirmed").sort((a, b) => (a.allDay ? -1 : toMin(a.start)) - (b.allDay ? -1 : toMin(b.start)));
  const rName = (id) => settings.rooms.find((r) => r.id === id)?.name || "";
  return (
    <Modal title={`${m.name} · ${fmtDate(d)}`} onClose={onClose}>
      {list.length > 0 && (
        <section className="sec">
          <h3>กะที่ลงไว้</h3>
          {list.map((x) => (
            <div key={x.id} className="contact">
              <b>{x.status === "leave" ? "ลา" : `${x.start}–${x.end} น.`}{x.note ? ` · ${x.note}` : ""}
                {x.status !== "leave" && <span className="note-small" style={{ display: "block", fontWeight: 400 }}>{x.job === "ext" ? "งานภายนอก" : "งานมหาลัย"} · OT {fmtHrs(otMinutes(x, ot))} ชม.</span>}</b>
              {x.status !== "leave" && <button className="btn" onClick={() => save([{ ...x, job: x.job === "ext" ? "uni" : "ext" }])}>เปลี่ยนเป็น{x.job === "ext" ? "งานมหาลัย" : "งานนอก"}</button>}
              <button className="btn danger" onClick={() => remove([x.id])}><Trash2 size={15} /> ลบ</button>
            </div>
          ))}
        </section>
      )}
      <section className="sec">
        <h3>เพิ่มกะ</h3>
        <div className="seg">
          <button type="button" className={job === "uni" ? "on" : ""} onClick={() => setJob("uni")}>งานมหาลัย ({ot.uni}฿/ชม.)</button>
          <button type="button" className={job === "ext" ? "on" : ""} onClick={() => setJob("ext")}>งานภายนอก ({ot.ext}฿/ชม.)</button>
        </div>
        <label className="f"><span>หมายเหตุ (ไม่บังคับ) เช่น ประจำ Black Box / คุมไฟ</span><input className="in" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="actions">
          {settings.shiftPresets.map((p) => <button key={p.id} className="btn primary" onClick={() => add({ start: p.start, end: p.end })}>{p.name} {p.start}–{p.end}</button>)}
          <button className="btn" onClick={() => add({ status: "leave", start: "00:00", end: "00:00" })}>ลา</button>
        </div>
        <div className="row" style={{ alignItems: "end" }}>
          <label className="f"><span>เริ่ม</span><select className="in" value={start} onChange={(e) => setStart(e.target.value)}>{DAY_TIMES.slice(0, -1).map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="f"><span>ถึง</span><select className="in" value={end} onChange={(e) => setEnd(e.target.value)}>{DAY_TIMES.slice(1).map((t) => <option key={t} disabled={toMin(t) <= toMin(start)}>{t}</option>)}</select></label>
          <button className="btn" disabled={toMin(end) <= toMin(start)} onClick={() => add({ start, end })}><Plus size={16} /> เพิ่มเวลานี้</button>
        </div>
      </section>
      <section className="sec">
        <h3>งานในห้องวันนี้</h3>
        {dayEvents.length ? dayEvents.map((b) => <div key={b.id} className="note-small" style={{ color: "var(--ink)" }}>{timeText(b)} · {b.title}{settings.rooms.length > 1 ? ` · ${rName(b.room)}` : ""}</div>)
          : <span className="note-small">ไม่มีงานที่ยืนยันแล้ว</span>}
      </section>
    </Modal>
  );
}

// ─── พนักงานที่เข้างานวันนี้ (หน้าแรก) ───────────────────────────────
function StaffToday({ settings, shifts, date }) {
  const staff = settings.staffMembers || [];
  if (!staff.length) return null;
  const list = shifts.filter((x) => x.date === date && staff.some((m) => m.id === x.staffId))
    .sort((a, b) => (a.status === "leave") - (b.status === "leave") || toMin(a.start) - toMin(b.start));
  const name = (id) => staff.find((m) => m.id === id)?.name || "";
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <section className="today staff-today">
      <div className="staff-head">
        <h2>พนักงานเข้างานวันนี้</h2>
        <button className="btn ghost" onClick={() => go("staff")}>ดูทั้งสัปดาห์ <ChevronRight size={16} /></button>
      </div>
      {list.length ? (
        <div className="today-list">
          {list.map((x) => {
            const onDuty = x.status !== "leave" && toMin(x.start) <= nowMin && nowMin < toMin(x.end);
            return (
              <div key={x.id} className={"staff-pill" + (x.status === "leave" ? " leave" : "") + (onDuty ? " on" : "")} style={{ "--sc": staffColor(settings, x.staffId) }}>
                <b>{name(x.staffId)}</b>
                <span>{x.status === "leave" ? "ลา" : `${x.start}–${x.end}`}{onDuty ? " · อยู่ในกะ" : ""}</span>
                {x.note && <em>{x.note}</em>}
              </div>
            );
          })}
        </div>
      ) : <p className="empty-note" style={{ margin: 0 }}>ยังไม่มีการลงกะของวันนี้</p>}
    </section>
  );
}

// ─── การรับรอง: ใช้ร่วมกันระหว่างหน้าแอดมินและหน้ารับรองของพนักงาน ──────────
function useMe() {
  const [me, setMeState] = useState(() => { try { return localStorage.getItem("twt-rooms-me") || ""; } catch { return ""; } });
  const setMe = (v) => { setMeState(v); try { localStorage.setItem("twt-rooms-me", v); } catch {} };
  return [me, setMe];
}

function ApproverPicker({ settings, me, setMe }) {
  const names = ["แอดมิน", ...(settings.staffMembers || []).map((m) => m.name).filter(Boolean)];
  return (
    <div className="approver">
      <label className="f"><span>ผู้รับรอง (ชื่อจะบันทึกไว้กับรายการที่กดรับรอง)</span>
        <select className="in" value={me} onChange={(e) => setMe(e.target.value)}>
          <option value="">— เลือกชื่อ —</option>
          {names.map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}

function useBookingActions({ bookings, setBookings, say, me }) {
  const now = () => new Date().toISOString();
  const who = () => me || "แอดมิน";
  const save = async (list) => {
    try { await upsertBookings(list); const map = new Map(bookings.map((b) => [b.id, b])); list.forEach((b) => map.set(b.id, b)); setBookings([...map.values()]); return true; }
    catch (e) { say("บันทึกไม่สำเร็จ: " + (e.message || e)); return false; }
  };
  const remove = async (ids) => {
    try { await deleteBookings(ids); setBookings(bookings.filter((b) => !ids.includes(b.id))); return true; }
    catch (e) { say("ลบไม่สำเร็จ: " + (e.message || e)); return false; }
  };
  const stamp = () => ({ status: "confirmed", decidedAt: now(), approvedBy: who() });
  const approve = async (b) => {
    if (b.kind === "change") {
      const ref = bookings.find((x) => x.id === b.refId);
      if (!ref) { say("ไม่พบคาบเดิม"); return; }
      if (b.action === "cancel") {
        if (await save([{ ...b, ...stamp() }, { ...ref, status: "cancelled", adminNote: "ยกเลิกตามคำขอ" + (b.reason ? `: ${b.reason}` : ""), decidedAt: now(), approvedBy: who() }])) say("ยกเลิกคาบแล้ว");
        return;
      }
      const moved = { ...ref, date: b.date, start: b.start, end: b.end, room: b.room || ref.room, movedFrom: `${ref.date} ${ref.start}–${ref.end}` };
      const c = clashes(moved, bookings, true);
      if (c.length && !window.confirm(`เวลาใหม่ชนกับ "${c[0].title || roleName(c[0])}" ${c[0].start}–${c[0].end}\nยังจะย้ายอยู่ไหม?`)) return;
      if (await save([{ ...b, ...stamp() }, moved])) say("ย้ายคาบแล้ว");
      return;
    }
    if (b.kind === "equip") { if (await save([{ ...b, ...stamp() }])) say("รับรองการขออุปกรณ์แล้ว"); return; }
    const c = clashes(b, bookings, true);
    if (c.length && !window.confirm(`ช่วงเวลานี้ชนกับ "${c[0].title || roleName(c[0])}" ${c[0].start}–${c[0].end} ที่ยืนยันแล้ว\nยังจะอนุมัติอยู่ไหม?`)) return;
    if (await save([{ ...b, ...stamp() }])) say("อนุมัติแล้ว");
  };
  const reject = async (b) => {
    const reason = window.prompt("เหตุผลที่ไม่อนุมัติ (ไม่ใส่ก็ได้)", "");
    if (reason === null) return;
    if (await save([{ ...b, status: "rejected", adminNote: reason, decidedAt: now(), approvedBy: who() }])) say("ไม่อนุมัติแล้ว");
  };
  const cancel = async (b) => {
    const reason = window.prompt(`ยกเลิกคาบ "${b.title}" ${fmtDate(b.date)} ${b.start}–${b.end}\nเหตุผล (ไม่ใส่ก็ได้)`, "");
    if (reason === null) return;
    if (await save([{ ...b, status: "cancelled", adminNote: reason, decidedAt: now(), approvedBy: who() }])) say("ยกเลิกคาบแล้ว");
  };
  return { save, remove, approve, reject, cancel };
}

function ApprovePage({ bookings, settings, setBookings, say }) {
  const [me, setMe] = useMe();
  const actions = useBookingActions({ bookings, setBookings, say, me });
  const n = bookings.filter((b) => b.status === "pending").length;
  return (
    <>
      <div className="page-head"><h1>รับรองคาบ / งาน</h1><p className="lead">รอรับรอง {n} รายการ · แอดมินและพนักงานช่วยกันตรวจได้จากหน้านี้</p></div>
      <ApproverPicker settings={settings} me={me} setMe={setMe} />
      <PendingTab bookings={bookings} settings={settings} {...actions} />
    </>
  );
}

// ─── ส่วนที่ใช้ร่วมในฟอร์มคำขอ ─────────────────────────────────────
function SubmitBar({ busy, disabled, onSubmit, label }) {
  return (
    <div className="submit-bar">
      <button className="btn" onClick={() => go("home")}><LogOut size={17} /> ออก</button>
      <button className="btn primary big" disabled={busy || disabled} onClick={onSubmit}>{busy ? "กำลังส่ง…" : label}</button>
    </div>
  );
}

function RequesterFields({ f, set, nameLabel = "ชื่อผู้ขอ" }) {
  return (
    <div className="row">
      <label className="f"><span>{nameLabel} <em>*</em></span><input className="in" value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" /></label>
      <label className="f"><span>เบอร์โทร <em>*</em></span><input className="in" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" /></label>
      <label className="f"><span>LINE ID</span><input className="in" value={f.line} onChange={(e) => set("line", e.target.value)} /></label>
    </div>
  );
}

function Done({ title, lines, settings, again }) {
  return (
    <div className="panel done">
      <div className="mark"><Check size={34} /></div>
      <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
      <p style={{ margin: 0 }}>{lines}</p>
      <p className="note-small" style={{ margin: 0 }}>ทีมงานจะตรวจสอบและรับรองให้ สงสัยอะไรติดต่อแอดมินได้ที่</p>
      <div style={{ width: "100%", maxWidth: 460 }}><ContactList contacts={settings.contacts} /></div>
      <div className="actions" style={{ justifyContent: "center" }}>
        <button className="btn" onClick={() => go("home")}><LogOut size={16} /> ออก</button>
        <button className="btn primary" onClick={again}>ส่งคำขออีกรายการ</button>
      </div>
    </div>
  );
}

// เลือกคาบจากตาราง (รายสัปดาห์ + ค้นหาชื่อวิชา/อาจารย์)
function ClassPicker({ bookings, settings, value, onChange }) {
  const sel = bookings.find((b) => b.id === value);
  const [weekStart, setWeekStart] = useState(() => mondayOf(sel ? parseYmd(sel.date) : new Date()));
  const [q, setQ] = useState("");
  const rn = (id) => settings.rooms.find((r) => r.id === id)?.name || "";
  const dates = new Set(Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i))));
  const list = bookings.filter((b) => isSlot(b) && b.status === "confirmed" && !b.allDay && dates.has(b.date) && (!q || `${b.title} ${b.name}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const end = addDays(weekStart, 6);
  let lastDate = "";
  return (
    <div className="picker">
      {sel && <div className="picked"><b>{sel.title}</b><span>{fmtDate(sel.date)} · {sel.start}–{sel.end} น.{settings.rooms.length > 1 ? ` · ${rn(sel.room)}` : ""}</span></div>}
      <div className="toolbar" style={{ margin: 0 }}>
        <button type="button" className="btn icon-btn" aria-label="สัปดาห์ก่อน" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={18} /></button>
        <span className="week-label" style={{ fontSize: 14 }}>{weekStart.getDate()} {TH_M[weekStart.getMonth()]} – {end.getDate()} {TH_M[end.getMonth()]}</span>
        <button type="button" className="btn icon-btn" aria-label="สัปดาห์ถัดไป" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={18} /></button>
      </div>
      <input className="in" placeholder="ค้นหาชื่อวิชาหรืออาจารย์" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pick-list">
        {list.length ? list.map((b) => {
          const head = b.date !== lastDate ? (lastDate = b.date, <div className="pick-day" key={"d" + b.date}>{fmtDate(b.date)}</div>) : null;
          return [head, (
            <button type="button" key={b.id} className={"pick" + (b.id === value ? " on" : "")} onClick={() => onChange(b.id)}>
              <span className="tm">{b.start}–{b.end}</span><b>{b.title}</b><span className="who">{b.name}{settings.rooms.length > 1 ? ` · ${rn(b.room)}` : ""}</span>
            </button>
          )];
        }) : <p className="empty-note" style={{ margin: 0 }}>ไม่มีคาบในสัปดาห์นี้{q ? "ที่ตรงกับคำค้น" : ""}</p>}
      </div>
    </div>
  );
}

// ─── หน้าขอใช้ห้อง: จองใหม่ / เปลี่ยนวันเวลา / ยกเลิกคาบ ─────────────────
function RequestPage(props) {
  const p = props.params.get("mode");
  const [mode, setMode] = useState(["move", "cancel"].includes(p) ? p : "new");
  const tabs = [["new", "จองห้องใหม่"], ["move", "เปลี่ยนวัน/เวลาคาบ"], ["cancel", "ยกเลิกคาบ"]];
  return (
    <>
      <div className="form" style={{ marginBottom: 16 }}>
        <div className="page-head"><h1>ขอใช้ห้อง</h1><p className="lead">ทีมงานจะตรวจสอบและรับรองให้ทุกคำขอ</p></div>
        <div className="seg mode-seg" role="tablist">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>)}
        </div>
      </div>
      {mode === "new" ? <BookPage {...props} /> : <ChangeForm key={mode} mode={mode} {...props} />}
    </>
  );
}

function ChangeForm({ mode, bookings, settings, setBookings, params }) {
  const times = timeOptions(settings, false), endTimes = timeOptions(settings, true);
  const initRef = bookings.find((b) => b.id === params.get("ref") && isSlot(b));
  const [refId, setRefId] = useState(initRef?.id || "");
  const ref = bookings.find((b) => b.id === refId);
  const [f, setF] = useState({ name: initRef?.name || "", phone: initRef?.phone || "", line: initRef?.line || "", reason: "", date: initRef?.date || ymd(new Date()), start: initRef?.start || "17:00", end: initRef?.end || "18:00", room: initRef?.room || settings.rooms[0]?.id });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [sent, setSent] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const pick = (id) => { setRefId(id); const r = bookings.find((b) => b.id === id); if (r) setF((x) => ({ ...x, date: r.date, start: r.start, end: r.end, room: r.room, name: x.name || r.name || "", phone: x.phone || r.phone || "" })); };
  const moved = ref ? { ...ref, date: f.date, start: f.start, end: f.end, room: f.room } : null;
  const all = mode === "move" && moved ? clashes(moved, bookings, false) : [];
  const hard = all.filter((b) => b.status === "confirmed"), soft = all.filter((b) => b.status === "pending");
  const unchanged = ref && f.date === ref.date && f.start === ref.start && f.end === ref.end && f.room === ref.room;

  const submit = async () => {
    setErr("");
    const miss = [!ref && "คาบที่ต้องการ", !f.name && "ชื่อ", !f.phone && "เบอร์โทร", mode === "move" && unchanged && "วัน/เวลาใหม่"].filter(Boolean);
    if (miss.length) { setErr("กรอกให้ครบก่อน: " + miss.join(", ")); return; }
    if (mode === "move" && toMin(f.start) >= toMin(f.end)) { setErr("เวลาเลิกต้องหลังเวลาเริ่ม"); return; }
    setBusy(true);
    try {
      const r = {
        id: uid(), kind: "change", action: mode, refId: ref.id, title: ref.title, status: "pending", createdAt: new Date().toISOString(),
        from: { date: ref.date, start: ref.start, end: ref.end, room: ref.room },
        date: mode === "move" ? f.date : ref.date, start: mode === "move" ? f.start : ref.start, end: mode === "move" ? f.end : ref.end, room: mode === "move" ? f.room : ref.room,
        name: f.name, phone: f.phone, line: f.line, reason: f.reason,
      };
      await upsertBookings([r]); setBookings([...bookings, r]); setSent(r);
      notifyTeam(`📥 ${kindLabel(r)}: ${r.title}\nเดิม ${fmtDate(ref.date)} ${ref.start}–${ref.end}${mode === "move" ? `\nใหม่ ${fmtDate(r.date)} ${r.start}–${r.end}` : ""}\nโดย ${r.name} ${r.phone}`);
    } catch (e) { setErr("ส่งไม่สำเร็จ: " + (e.message || e)); }
    setBusy(false);
  };

  if (sent) return <Done title={mode === "move" ? "ส่งคำขอเปลี่ยนวัน/เวลาแล้ว" : "ส่งคำขอยกเลิกคาบแล้ว"} lines={<>{sent.title}<br />{mode === "move" ? `ย้ายไป ${fmtDate(sent.date)} ${sent.start}–${sent.end} น.` : `${fmtDate(sent.date)} ${sent.start}–${sent.end} น.`}</>} settings={settings} again={() => { setSent(null); setRefId(""); }} />;

  return (
    <div className="form">
      <section className="sec">
        <h3>เลือกคาบ</h3>
        <ClassPicker bookings={bookings} settings={settings} value={refId} onChange={pick} />
      </section>
      {mode === "move" && ref && (
        <section className="sec">
          <h3>วันเวลาใหม่</h3>
          <div className="row">
            {settings.rooms.length > 1 && <label className="f"><span>ห้อง</span><select className="in" value={f.room} onChange={(e) => set("room", e.target.value)}>{settings.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
            <label className="f"><span>วันที่</span><input className="in" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
            <label className="f"><span>เริ่ม</span><select className="in" value={f.start} onChange={(e) => set("start", e.target.value)}>{times.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="f"><span>ถึงกี่โมง</span><select className="in" value={f.end} onChange={(e) => set("end", e.target.value)}>{endTimes.map((t) => <option key={t} disabled={toMin(t) <= toMin(f.start)}>{t}</option>)}</select></label>
          </div>
          <span className="note-small">{fmtDate(f.date)} · {f.start}–{f.end} น.</span>
          <ClashBox hard={hard} soft={soft} settings={settings} />
        </section>
      )}
      <section className="sec">
        <h3>ผู้ขอ</h3>
        <RequesterFields f={f} set={set} nameLabel="ชื่ออาจารย์ / ผู้ขอ" />
        <label className="f"><span>เหตุผล{mode === "cancel" ? "ที่ยกเลิก" : "ที่เปลี่ยน"}</span><textarea className="in" value={f.reason} onChange={(e) => set("reason", e.target.value)} /></label>
      </section>
      {err && <div className="alert warn" role="alert">{err}</div>}
      <SubmitBar busy={busy} disabled={hard.length > 0} onSubmit={submit} label={hard.length ? "เวลาใหม่ไม่ว่าง" : mode === "move" ? "ส่งคำขอเปลี่ยนเวลา" : "ส่งคำขอยกเลิกคาบ"} />
    </div>
  );
}

// ─── ขอใช้อุปกรณ์ (อาจารย์ประจำ ขอเพิ่มเฉพาะคาบในสัปดาห์นั้น) ─────────────
function EquipPage({ bookings, settings, setBookings, params }) {
  const initRef = bookings.find((b) => b.id === params.get("ref") && isSlot(b));
  const [refId, setRefId] = useState(initRef?.id || "");
  const ref = bookings.find((b) => b.id === refId);
  const [f, setF] = useState({ name: initRef?.name || "", phone: "", line: "", equipment: {}, equipNote: "" });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [sent, setSent] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const count = Object.values(f.equipment).reduce((a, b) => a + (b || 0), 0);
  const submit = async () => {
    setErr("");
    const miss = [!ref && "คาบที่ต้องการ", !f.name && "ชื่อ", !f.phone && "เบอร์โทร", !count && !f.equipNote && "อุปกรณ์"].filter(Boolean);
    if (miss.length) { setErr("กรอกให้ครบก่อน: " + miss.join(", ")); return; }
    setBusy(true);
    try {
      const r = { id: uid(), kind: "equip", refId: ref.id, title: ref.title, date: ref.date, start: ref.start, end: ref.end, room: ref.room, from: { date: ref.date, start: ref.start, end: ref.end, room: ref.room }, status: "pending", createdAt: new Date().toISOString(), ...f };
      await upsertBookings([r]); setBookings([...bookings, r]); setSent(r);
      const eq = Object.entries(f.equipment).filter(([, v]) => v > 0).map(([k, v]) => `${settings.equipment.find((q) => q.id === k)?.name || k} × ${v}`).join(", ");
      notifyTeam(`🔧 ขอใช้อุปกรณ์: ${ref.title}\n${fmtDate(ref.date)} ${ref.start}–${ref.end}\n${eq}${f.equipNote ? `\n${f.equipNote}` : ""}\nโดย ${f.name} ${f.phone}`);
    } catch (e) { setErr("ส่งไม่สำเร็จ: " + (e.message || e)); }
    setBusy(false);
  };
  if (sent) return <Done title="ส่งคำขออุปกรณ์แล้ว" lines={<>{sent.title}<br />{fmtDate(sent.date)} {sent.start}–{sent.end} น.</>} settings={settings} again={() => { setSent(null); setRefId(""); setF((x) => ({ ...x, equipment: {}, equipNote: "" })); }} />;
  return (
    <div className="form">
      <div className="page-head"><h1>ขอใช้อุปกรณ์</h1><p className="lead">สำหรับอาจารย์ที่มีคาบประจำ ขออุปกรณ์เพิ่มเฉพาะคาบในสัปดาห์นั้น</p></div>
      <section className="sec">
        <h3>เลือกคาบ</h3>
        <ClassPicker bookings={bookings} settings={settings} value={refId} onChange={(id) => { setRefId(id); const r = bookings.find((b) => b.id === id); if (r && !f.name) set("name", r.name || ""); }} />
      </section>
      <section className="sec">
        <h3>อุปกรณ์ที่ต้องการ</h3>
        <div className="qty-list">
          {settings.equipment.map((q) => <Qty key={q.id} label={q.name} value={f.equipment[q.id]} onChange={(v) => set("equipment", { ...f.equipment, [q.id]: v })} />)}
        </div>
        <label className="f"><span>อุปกรณ์อื่นๆ / รายละเอียด</span><input className="in" value={f.equipNote} onChange={(e) => set("equipNote", e.target.value)} placeholder="เช่น ต่อโน้ตบุ๊กออกจอผ่าน HDMI" /></label>
      </section>
      <section className="sec">
        <h3>ผู้ขอ</h3>
        <RequesterFields f={f} set={set} nameLabel="ชื่ออาจารย์" />
      </section>
      {err && <div className="alert warn" role="alert">{err}</div>}
      <SubmitBar busy={busy} onSubmit={submit} label="ส่งคำขออุปกรณ์" />
    </div>
  );
}

// ─── คำนวณค่าโอที ────────────────────────────────────────────────
function OTTab({ settings, editSettings, shifts, say }) {
  const ot = { ...DEFAULT_SETTINGS.ot, ...(settings.ot || {}) };
  const rate = ot;
  const setRate = (r) => editSettings((d) => ({ ...d, ot: { ...DEFAULT_SETTINGS.ot, ...(d.ot || {}), ...Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== ot[k])) } }));
  const monthRange = (offset) => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() + offset, 1); const b = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0); return [ymd(a), ymd(b)]; };
  const [[from, to], setRange] = useState(() => monthRange(0));
  const [open, setOpen] = useState(null);

  const staff = settings.staffMembers || [];
  const rows = staff.map((m) => {
    const list = shifts.filter((x) => x.staffId === m.id && x.date >= from && x.date <= to && x.status !== "leave")
      .map((x) => { const min = otMinutes(x, rate); const r = x.job === "ext" ? Number(rate.ext) || 0 : Number(rate.uni) || 0; return { ...x, min, pay: (min / 60) * r }; })
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const uni = list.filter((x) => x.job !== "ext").reduce((a, x) => a + x.min, 0);
    const ext = list.filter((x) => x.job === "ext").reduce((a, x) => a + x.min, 0);
    return { m, list, uni, ext, pay: (uni / 60) * (Number(rate.uni) || 0) + (ext / 60) * (Number(rate.ext) || 0) };
  });
  const total = rows.reduce((a, r) => a + r.pay, 0);

  const summary = () => {
    const t = [`สรุปค่าโอที ${fmtDate(from).replace(/^วัน\S+ที่ /, "")} – ${fmtDate(to).replace(/^วัน\S+ที่ /, "")}`];
    rows.filter((r) => r.pay > 0).forEach((r) => t.push(`${r.m.name}: มหาลัย ${fmtHrs(r.uni)} ชม. · งานนอก ${fmtHrs(r.ext)} ชม. = ${fmtBaht(r.pay)} บาท`));
    t.push(`รวม ${fmtBaht(total)} บาท`);
    copyText(t.join("\n"), say);
  };
  return (
    <div className="form" style={{ maxWidth: 860 }}>
      <section className="sec">
        <h3>อัตราและเงื่อนไขโอที</h3>
        <div className="row">
          <label className="f"><span>งานมหาลัย (บาท/ชม.)</span><input className="in" inputMode="numeric" value={rate.uni} onChange={(e) => setRate({ ...rate, uni: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          <label className="f"><span>งานภายนอก (บาท/ชม.)</span><input className="in" inputMode="numeric" value={rate.ext} onChange={(e) => setRate({ ...rate, ext: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
          <label className="f"><span>จ–ศ นับโอทีก่อน</span><select className="in" value={rate.before} onChange={(e) => setRate({ ...rate, before: e.target.value })}>{DAY_TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="f"><span>จ–ศ นับโอทีหลัง</span><select className="in" value={rate.after} onChange={(e) => setRate({ ...rate, after: e.target.value })}>{DAY_TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        <span className="note-small">วันจันทร์–ศุกร์ นับเฉพาะช่วงก่อน {rate.before} และหลัง {rate.after} · เสาร์–อาทิตย์ นับเป็นโอทีทั้งกะ · ประเภทงานเลือกตอนลงกะ (แท็บกะพนักงาน)</span>
        <span className="note-small">แก้แล้วบันทึกอัตโนมัติ</span>
      </section>

      <section className="sec">
        <h3>ช่วงที่คำนวณ</h3>
        <div className="row">
          <label className="f"><span>ตั้งแต่</span><input className="in" type="date" value={from} onChange={(e) => setRange([e.target.value, to])} /></label>
          <label className="f"><span>ถึง</span><input className="in" type="date" value={to} onChange={(e) => setRange([from, e.target.value])} /></label>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setRange(monthRange(0))}>เดือนนี้</button>
          <button className="btn" onClick={() => setRange(monthRange(-1))}>เดือนก่อน</button>
        </div>
      </section>

      {!staff.length ? <div className="panel">ยังไม่มีรายชื่อพนักงาน เพิ่มได้ที่แท็บ ตั้งค่า → พนักงาน</div> : (
        <section className="sec">
          <div className="ot-head"><h3>สรุปต่อคน</h3><button className="btn" onClick={summary}><Copy size={16} /> คัดลอกสรุป</button></div>
          <div className="ot-table">
            <div className="ot-row ot-th"><span>พนักงาน</span><span>มหาลัย</span><span>งานนอก</span><span>รวม (บาท)</span></div>
            {rows.map((r) => (
              <div key={r.m.id}>
                <button className="ot-row" onClick={() => setOpen(open === r.m.id ? null : r.m.id)} aria-expanded={open === r.m.id}>
                  <span><b>{r.m.name}</b></span><span>{fmtHrs(r.uni)} ชม.</span><span>{fmtHrs(r.ext)} ชม.</span><span className="amt">{fmtBaht(r.pay)}</span>
                </button>
                {open === r.m.id && (
                  <div className="ot-detail">
                    {r.list.length ? r.list.map((x) => (
                      <div key={x.id} className="ot-line">
                        <span>{dayName(x.date)} {parseYmd(x.date).getDate()} {TH_M[parseYmd(x.date).getMonth()]}</span>
                        <span>{x.start}–{x.end}</span>
                        <span>{x.job === "ext" ? "งานนอก" : "มหาลัย"}</span>
                        <span>OT {fmtHrs(x.min)} ชม.</span>
                        <span className="amt">{fmtBaht(x.pay)}</span>
                      </div>
                    )) : <span className="note-small">ไม่มีกะในช่วงนี้</span>}
                  </div>
                )}
              </div>
            ))}
            <div className="ot-row ot-total"><span>รวมทั้งหมด</span><span>{fmtHrs(rows.reduce((a, r) => a + r.uni, 0))} ชม.</span><span>{fmtHrs(rows.reduce((a, r) => a + r.ext, 0))} ชม.</span><span className="amt">{fmtBaht(total)}</span></div>
          </div>
          <span className="note-small">แตะชื่อเพื่อดูรายละเอียดทีละกะ</span>
        </section>
      )}
    </div>
  );
}

// ─── เลือกทีมงานที่รับผิดชอบงานนี้ ─────────────────────────────────
function CrewPicker({ b, settings, save }) {
  const staff = settings.staffMembers || [];
  if (!staff.length) return <p className="note-small" style={{ margin: 0 }}>เพิ่มรายชื่อพนักงานที่ ตั้งค่า → พนักงาน เพื่อเลือกคนทำงานนี้</p>;
  const crew = b.crew || [];
  const toggle = (id) => save([{ ...b, crew: crew.includes(id) ? crew.filter((x) => x !== id) : [...crew, id] }]);
  const suggest = crewFromText(`${b.note || ""} ${b.title || ""}`, staff).filter((id) => !crew.includes(id));
  return (
    <div className="crew-pick">
      <span className="crew-label">ทีมงานที่รับผิดชอบ{crew.length ? ` (${crew.length} คน)` : ""}</span>
      <div className="chips">
        {staff.map((m) => (
          <button key={m.id} type="button" className={"crew-toggle" + (crew.includes(m.id) ? " on" : "")} style={{ "--sc": staffColor(settings, m.id) }} aria-pressed={crew.includes(m.id)} onClick={() => toggle(m.id)}>
            {crew.includes(m.id) ? <Check size={14} /> : <i className="sdot" />}{m.name}{m.role ? <small>{m.role}</small> : null}
          </button>
        ))}
      </div>
      {suggest.length > 0 && (
        <button type="button" className="btn ghost suggest" onClick={() => save([{ ...b, crew: [...crew, ...suggest] }])}>
          ใส่ตามหมายเหตุ: {suggest.map((id) => staff.find((m) => m.id === id)?.name).join(", ")}
        </button>
      )}
    </div>
  );
}
