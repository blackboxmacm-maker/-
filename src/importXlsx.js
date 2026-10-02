// แปลงไฟล์ Excel ปฏิทินรายเดือน (แบบ MAHIDOL BLACK BOX: 1 ชีต = 1 เดือน, หัวตาราง SUN..SAT)
// เป็นรายการในตารางห้อง — ใช้ได้ทั้งในเบราว์เซอร์ (หน้าแอดมิน) และใน node
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DAYS = ["SUN", "MON", "TUES", "WED", "THURS", "FRI", "SAT"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => { const x = new Date(y, m, d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const RANGE = /(\d{1,2})[.:](\d{2})\d?\s*[-–]\s*(\d{1,2})[.:](\d{2})\d?/;
const EVENT = /rent|เช่า|holiday|ปิดเทอม|เปิดเทอม|setup|สอบ|ceremony|mainten|graduation|recital|yam[pc]|camp|open house|งด|concert|perform|exam|jury/i;
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export const ROOM_BB = { id: "bb", name: "Black Box" };
export const ROOM_WB = { id: "wb", name: "White Box" };

function sheetMonth(name, rows) {
  const tryParse = (s) => { const m = String(s || "").toLowerCase().match(/([a-z]{3})[a-z]*\.?\s*(\d{4})/); return m && m[1] in MONTHS ? { y: +m[2], m: MONTHS[m[1]] } : null; };
  return tryParse(name) || rows.slice(0, 4).flat().map(tryParse).find(Boolean) || null;
}
const num = (v) => { if (typeof v === "number") return Number.isInteger(v) && v >= 1 && v <= 31 ? v : null; const s = String(v).trim(); return /^\d{1,2}(\.0)?$/.test(s) && +s >= 1 && +s <= 31 ? Math.round(+s) : null; };

function parseLine(raw) {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const m = t.match(RANGE);
  let start = "", end = "", title = t;
  if (m) {
    const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
    if (e > s && +m[1] < 24 && +m[3] <= 24) { start = `${pad(m[1])}:${m[2]}`; end = `${pad(m[3])}:${m[4]}`; title = t.replace(m[0], " "); }
  }
  title = title.replace(/^[\s:\-/|,]+|[\s:\-/|,]+$/g, "").replace(/\s{2,}/g, " ");
  return { start, end, title };
}

// sheets: [{ name, rows: any[][], blue?: Set<"r,c"> }] — blue = ช่องที่ตัวอักษรสีฟ้า (= White Box)
export function parseCalendar(sheets) {
  const out = []; const skipped = [];
  for (const { name, rows, blue } of sheets) {
    const ym = sheetMonth(name, rows); if (!ym) { skipped.push(name); continue; }
    const h = rows.findIndex((r) => r.some((c) => String(c).trim().toUpperCase() === "SUN") && r.some((c) => String(c).trim().toUpperCase() === "SAT"));
    if (h < 0) { skipped.push(name); continue; }
    const cols = DAYS.map((d) => rows[h].findIndex((c) => String(c).trim().toUpperCase() === d));
    let week = null; let started = false; let maxSeen = 0;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      const flat = r.map((c) => String(c).trim().toLowerCase());
      if (flat.includes("name list") || flat.some((c) => c.startsWith("waiting for approve"))) break;
      const cells = cols.map((c) => (c >= 0 ? r[c] ?? "" : ""));
      const filled = cells.filter((c) => String(c).trim() !== "");
      if (filled.length && filled.every((c) => num(c) !== null)) {
        week = cells.map((c) => {
          const n = num(c); if (n === null) return null;
          let mo = ym.m;
          if (n === 1) started = true;
          if (!started && n > 1) mo = ym.m - 1;               // ท้ายเดือนก่อน
          else if (started && maxSeen >= 28 && n < 15) mo = ym.m + 1; // ต้นเดือนถัดไป
          if (started && mo === ym.m) maxSeen = Math.max(maxSeen, n);
          return ymd(ym.y, mo, n);
        });
        continue;
      }
      if (!week) continue;
      cells.forEach((c, di) => {
        const date = week[di]; if (!date || String(c).trim() === "") return;
        const isBlue = blue ? blue.has(`${i},${cols[di]}`) : false;
        String(c).split(/\n/).forEach((line) => {
          const p = parseLine(line); if (!p) return;
          // บรรทัดที่มีแต่เวลา → เป็นเวลาของรายการก่อนหน้า (เช่น "RENT: KPN" แล้วบรรทัดถัดไป "15.00-20.00")
          if (!p.title && p.start) {
            const prev = [...out].reverse().find((x) => x.date === date && x._col.startsWith(name + di));
            if (prev && prev.allDay) { prev.allDay = false; prev.start = p.start; prev.end = p.end; }
            return;
          }
          if (!p.title) return;
          const prev = [...out].reverse().find((x) => x.date === date && x._col.startsWith(name + di));
          // บรรทัดรายละเอียด (ชื่อทีมงาน, อุปกรณ์, "รอเวลา") → ต่อเป็นหมายเหตุของรายการก่อนหน้า
          if (prev && (/^\(/.test(p.title) && p.start && prev.allDay)) { prev.allDay = false; prev.start = p.start; prev.end = p.end; prev.note = [prev.note, p.title].filter(Boolean).join(" · "); return; }
          if (prev && !p.start && !EVENT.test(p.title)) { prev.note = [prev.note, p.title].filter(Boolean).join(" · "); return; }
          const saysWB = /white\s*box|\bwb\b/i.test(p.title), saysBB = /black\s*box|\bbb\b/i.test(p.title);
          // สีฟ้า = White Box, สีดำ = Black Box · ข้อความ "WB+BB" = ใช้ทั้งสองห้อง
          const rooms = saysWB && saysBB && !/^setup/i.test(p.title) ? [ROOM_BB.id, ROOM_WB.id] : [(isBlue || (saysWB && !saysBB)) ? ROOM_WB.id : ROOM_BB.id];
          const rent = /\brent\b|เช่า/i.test(p.title);
          const teacher = (p.title.match(/\(((?:A|อ|Dr|ดร)\.?\s*[^)]+)\)/i) || [])[1] || "";
          for (const room of rooms) out.push({
            _col: name + di + room, date, room,
            allDay: !p.start, start: p.start, end: p.end, title: p.title, name: teacher.trim(),
            kind: rent ? "request" : "class", role: rent ? "renter" : "admin", purpose: rent ? "other" : "class",
            status: "confirmed", source: "excel",
          });
        });
      });
    }
  }
  // กันซ้ำ: id คงที่จากวัน+ห้อง+เวลา+ชื่อ → นำเข้าซ้ำจะทับของเดิม ไม่เพิ่มซ้ำ
  const seen = new Set(); const list = [];
  for (const b of out) {
    const id = "x" + hash(`${b.date}|${b.room}|${b.start}|${b.end}|${b.title}`);
    if (seen.has(id)) continue; seen.add(id);
    const { _col, ...rest } = b; list.push({ ...rest, id, createdAt: new Date().toISOString() });
  }
  return { bookings: list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)), skipped };
}

// อ่านสีตัวอักษรจากไฟล์ xlsx โดยตรง (SheetJS ฟรีไม่อ่านสีฟอนต์)
const attr = (tag, a) => (tag.match(new RegExp(`\\b${a}="([^"]*)"`)) || [])[1];
const isBlueRgb = (rgb) => { if (!rgb || rgb.length < 6) return false; const h = rgb.slice(-6); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return b >= 150 && r <= 110 && g <= 170; };
const colIdx = (letters) => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
export function blueCells(files) {
  const txt = (p) => (files[p] ? new TextDecoder().decode(files[p]) : "");
  const styles = txt("xl/styles.xml");
  const fontsXml = (styles.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/) || [])[1] || "";
  const fontBlue = (fontsXml.match(/<font\b[^>]*?(?:\/>|>[\s\S]*?<\/font>)/g) || []).map((f) => isBlueRgb(attr((f.match(/<color\b[^>]*>/) || [""])[0], "rgb")));
  const xfsXml = (styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || "";
  const xfBlue = (xfsXml.match(/<xf\b[^>]*>/g) || []).map((x) => !!fontBlue[+attr(x, "fontId") || 0]);
  const rels = {}; for (const r of txt("xl/_rels/workbook.xml.rels").match(/<Relationship\b[^>]*>/g) || []) rels[attr(r, "Id")] = attr(r, "Target");
  const out = {};
  for (const sh of txt("xl/workbook.xml").match(/<sheet\b[^>]*>/g) || []) {
    const name = attr(sh, "name").replace(/&amp;/g, "&"); let target = rels[attr(sh, "r:id")] || ""; target = target.replace(/^\//, "");
    const path = target.startsWith("xl/") ? target : "xl/" + target;
    const set = new Set();
    for (const c of txt(path).match(/<c\b[^>]*>/g) || []) {
      const s = attr(c, "s"); if (!s || !xfBlue[+s]) continue;
      const m = attr(c, "r").match(/^([A-Z]+)(\d+)$/); if (m) set.add(`${+m[2] - 1},${colIdx(m[1])}`);
    }
    out[name] = set;
  }
  return out;
}

export async function readWorkbook(file) {
  const [XLSX, { unzipSync }] = await Promise.all([import("xlsx"), import("fflate")]);
  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "array" });
  let blues = {}; try { blues = blueCells(unzipSync(buf)); } catch {}
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]; const rng = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { r: 0, c: 0 } };
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    // ปรับตำแหน่งให้ตรงกับ index ของ rows
    const b = new Set([...(blues[name] || [])].map((k) => { const [r, c] = k.split(",").map(Number); return `${r - rng.s.r},${c - rng.s.c}`; }));
    return { name, rows, blue: b };
  });
}
