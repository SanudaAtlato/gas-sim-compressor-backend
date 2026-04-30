"""
socket_server.py
─────────────────
python-socketio AsyncServer.

The 403 Forbidden on WebSocket connections is caused by engine.io's
built-in origin check.  Fix: pass cors_allowed_origins explicitly.
For development, '*' allows everything.  For production, replace with
a list of allowed frontend URLs.
"""

import os
import socketio

# Read allowed origins from env (comma-separated) or default to '*'
_raw = os.getenv("ALLOWED_ORIGINS", "*")
if _raw.strip() == "*":
    _cors = "*"
else:
    _cors = [o.strip() for o in _raw.split(",") if o.strip()]

sio = socketio.AsyncServer(
    async_mode       = "asgi",
    cors_allowed_origins = _cors,      # '*'  or  ['http://localhost:3000', ...]
    cors_credentials = True,
    logger           = False,
    engineio_logger  = False,
)


# ── Events ────────────────────────────────────────────────────────────────────

@sio.event
async def connect(sid, environ, auth=None):
    origin = environ.get("HTTP_ORIGIN", "unknown")
    print(f"[Socket.IO] connected  sid={sid}  origin={origin}")

@sio.event
async def disconnect(sid):
    print(f"[Socket.IO] disconnected  sid={sid}")

@sio.event
async def join(sid, data):
    room = data.get("room", "alaska") if isinstance(data, dict) else "alaska"
    await sio.enter_room(sid, room)
    print(f"[Socket.IO] {sid} joined room '{room}'")
    await sio.emit("joined", {"room": room}, to=sid)


# ── Broadcast helpers ─────────────────────────────────────────────────────────

async def broadcast_live_update(pipeline_id: str, payload: dict) -> None:
    await sio.emit("live_pipeline_update", payload, room=pipeline_id)

async def broadcast_alert(pipeline_id: str, message: str, level: str = "info") -> None:
    await sio.emit("alert", {"message": message, "level": level}, room=pipeline_id)
