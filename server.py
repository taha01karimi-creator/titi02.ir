"""
سرور چت رمزنگاری‌شده
- سرور فقط «متن رمزشده» را بین دو نفر رد و بدل می‌کند.
- رمز ۶ رقمی هرگز به سرور نمی‌رسد و پیام‌ها ذخیره نمی‌شوند.
"""
import eventlet
eventlet.monkey_patch()

import os
import re
import time
from flask import Flask, send_from_directory
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask import request

BASE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE, "static"), static_url_path="/static")
# روی Render/gunicorn از eventlet استفاده می‌شود؛ برای اجرای مستقیم لوکال هم eventlet کار می‌کند
socketio = SocketIO(app, async_mode="eventlet", cors_allowed_origins=[], max_http_buffer_size=20_000)

ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{4,32}$")
MAX_MEMBERS = 2          # هر اتاق فقط دو نفر
MAX_MSG_LEN = 8000       # حداکثر طول هر پیام رمزشده
MAX_PER_SEC = 8          # محدودیت سرعت ارسال

rooms = {}       # room -> set(sid)
sid_room = {}    # sid -> room
last_sent = {}   # sid -> [timestamps]


@app.after_request
def secure_headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"
    r.headers["X-Frame-Options"] = "DENY"
    r.headers["Referrer-Policy"] = "no-referrer"
    r.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:"
    )
    return r


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


def _leave(sid):
    room = sid_room.pop(sid, None)
    last_sent.pop(sid, None)
    if not room:
        return
    members = rooms.get(room, set())
    members.discard(sid)
    if members:
        emit("system", {"count": len(members), "text": "طرف مقابل خارج شد"}, to=room)
    else:
        rooms.pop(room, None)


@socketio.on("join")
def on_join(data):
    sid = request.sid
    room = (data or {}).get("room", "")
    if not isinstance(room, str) or not ROOM_RE.match(room):
        return emit("err", {"text": "کد اتاق نامعتبر است (۴ تا ۳۲ حرف انگلیسی/عدد)"})
    if sid in sid_room:
        _leave(sid)
    members = rooms.setdefault(room, set())
    if len(members) >= MAX_MEMBERS:
        return emit("err", {"text": "این اتاق پر است"})
    members.add(sid)
    sid_room[sid] = room
    join_room(room)
    emit("joined", {"count": len(members)})
    emit("system", {"count": len(members),
                    "text": "طرف مقابل وارد شد" if len(members) > 1 else "منتظر طرف مقابل…"},
         to=room, include_self=False)


@socketio.on("msg")
def on_msg(data):
    sid = request.sid
    room = sid_room.get(sid)
    payload = (data or {}).get("data", "")
    if not room or not isinstance(payload, str) or not payload or len(payload) > MAX_MSG_LEN:
        return
    now = time.time()
    hist = [t for t in last_sent.get(sid, []) if now - t < 1]
    if len(hist) >= MAX_PER_SEC:
        return emit("err", {"text": "خیلی سریع می‌فرستی"})
    hist.append(now)
    last_sent[sid] = hist
    emit("msg", {"data": payload}, to=room, include_self=False)


@socketio.on("disconnect")
def on_disconnect():
    _leave(request.sid)


if __name__ == "__main__":
    # اجرای محلی (روی Render این بخش اجرا نمی‌شود؛ gunicorn جایگزینش می‌شود)
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  سرور روشن شد: http://localhost:{port}\n")
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)
