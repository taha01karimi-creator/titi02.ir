const $ = id => document.getElementById(id);
const CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&*+-/:;<=>?@^_~";
const B = BigInt(CH.length), enc = new TextEncoder(), dec = new TextDecoder();
let socket = null, aesKey = null;

// بایت‌ها <-> رشته‌ی به‌هم‌ریخته
function toStr(bytes) {
  let n = 1n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = CH[Number(n % B)] + s; n /= B; }
  return s;
}
function toBytes(s) {
  let n = 0n;
  for (const c of s) { const i = CH.indexOf(c); if (i < 0) throw 0; n = n * B + BigInt(i); }
  const a = [];
  while (n > 1n) { a.unshift(Number(n & 255n)); n >>= 8n; }
  return new Uint8Array(a);
}

// کلید فقط یک‌بار موقع ورود ساخته می‌شود (نمک = کد اتاق) تا پیام‌ها سریع باشند
async function deriveKey(pin, room) {
  const m = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("ghofl-raz|" + room), iterations: 600000, hash: "SHA-256" },
    m, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encrypt(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(text)));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  return toStr(all);
}
async function decrypt(s) {
  const all = toBytes(s);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, aesKey, all.slice(12));
  return dec.decode(pt);
}

function add(cls, text) {
  const d = document.createElement("div");
  d.className = cls; d.textContent = text;        // textContent = امن در برابر XSS
  $("log").appendChild(d);
  $("log").scrollTop = $("log").scrollHeight;
}
const err = t => ($("msg").textContent = t);

async function join() {
  const room = $("room").value.trim(), pin = $("pin").value;
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(room)) return err("کد اتاق: ۴ تا ۳۲ حرف انگلیسی/عدد");
  if (!/^\d{6}$/.test(pin)) return err("رمز باید دقیقاً ۶ رقم باشد");
  if (!window.crypto || !crypto.subtle) return err("این صفحه باید با HTTPS یا localhost باز شود");
  err("در حال آماده‌سازی…");
  aesKey = await deriveKey(pin, room);
  $("pin").value = "";
  socket = io({ transports: ["websocket", "polling"] });
  socket.on("connect", () => socket.emit("join", { room }));
  socket.on("err", d => err(d.text));
  socket.on("joined", d => {
    $("joinBox").hidden = true; $("chatBox").hidden = false;
    $("status").textContent = "اتاق: " + room;
    add("sys", d.count > 1 ? "طرف مقابل آنلاین است" : "منتظر طرف مقابل…");
  });
  socket.on("system", d => add("sys", d.text));
  socket.on("msg", async d => {
    try { add("b other", await decrypt(d.data)); }
    catch { add("b other bad", "🔒 پیامی رسید که با این رمز باز نشد (رمزها یکی نیست)"); }
  });
}

async function send() {
  const t = $("text").value.trim();
  if (!t || !socket) return;
  $("text").value = "";
  socket.emit("msg", { data: await encrypt(t) });
  add("b me", t);
}

function leave() { if (socket) socket.disconnect(); location.reload(); }

$("pin").addEventListener("input", e => e.target.value = e.target.value.replace(/\D/g, ""));
$("gen").onclick = () => {
  const a = crypto.getRandomValues(new Uint8Array(6));
  $("room").value = Array.from(a, x => CH[x % 62]).join("");
};
$("join").onclick = join;
$("sendBtn").onclick = send;
$("text").addEventListener("keydown", e => { if (e.key === "Enter") send(); });
$("leave").onclick = leave;
