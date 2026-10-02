// Vercel Serverless Function — ยิงข้อความ LINE จาก OA ของโรงเรียน (push)
// ตั้งค่า ENV ใน Vercel: LINE_CHANNEL_ACCESS_TOKEN, LINE_TARGET_ID
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_TARGET_ID;
  if (!token || !to) return res.status(200).json({ ok: false, error: "ยังไม่ได้ตั้งค่า LINE (ENV ว่าง)" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const text = (body.text || "").toString().slice(0, 4900);
    if (!text) return res.status(400).json({ ok: false, error: "no text" });
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
    });
    if (!r.ok) return res.status(200).json({ ok: false, error: await r.text() });
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(200).json({ ok: false, error: String(e) }); }
}
