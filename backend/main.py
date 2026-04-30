"""
main.py
────────
FastAPI + Socket.IO entry point.

IMPORTANT — run with socket_app, NOT app:
    python main.py
  or
    uvicorn main:socket_app --reload --port 8000

Running `uvicorn main:app` bypasses Socket.IO entirely → 403 on every
WebSocket connection.  Always use `main:socket_app`.

Why:
    socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
    ↑ this is socket_app — it intercepts /socket.io/* requests and
      forwards everything else to fastapi_app (including lifespan events).
"""

from __future__ import annotations
import os
from contextlib import asynccontextmanager

import socketio
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

load_dotenv()

# ── Import the Socket.IO server FIRST ────────────────────────────────────────
# socket_server.py creates the `sio` instance with CORS already configured.
from socket_server import sio

# ── FastAPI lifespan ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    from simulation_service import init_service
    print("\n🔄 Initialising Alaska pipeline simulation …")
    svc = init_service(pid="alaska", sio=sio)
    # Simulation does NOT auto-start — wait for POST /simulation/start
    print("   ✅ Service ready. POST /simulation/start to begin.")
    yield
    print("\n🔄 Shutting down …")
    svc.stop()


# ── FastAPI app ───────────────────────────────────────────────────────────────

fastapi_app = FastAPI(
    title    = "Alaska Pipeline — Transient Monitor",
    version  = "1.0.0",
    lifespan = lifespan,
)

# CORS for REST endpoints (not for Socket.IO — that's handled by sio directly)
_raw_origins = os.getenv("ALLOWED_ORIGINS", "*")
if _raw_origins.strip() == "*":
    _origins = ["*"]
else:
    _origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins     = _origins,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# REST routes
from api.routes import router as sim_router
fastapi_app.include_router(sim_router)

_FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "dist")

if os.path.isdir(_FRONTEND_DIST):
    fastapi_app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIST, "assets")), name="assets")

    @fastapi_app.get("/", include_in_schema=False)
    @fastapi_app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str = ""):
        index = os.path.join(_FRONTEND_DIST, "index.html")
        return FileResponse(index)
else:
    @fastapi_app.get("/", tags=["health"])
    def root():
        return {
            "service" : "Alaska Pipeline Transient Monitor",
            "status"  : "online",
            "docs"    : "/docs",
            "socket"  : "/socket.io/",
            "event"   : "live_pipeline_update",
        }

@fastapi_app.get("/health", tags=["health"])
def health():
    from simulation_service import get_service
    try:
        return {"status": "ok", "simulation": get_service("alaska").get_status()}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


# ── Mount Socket.IO as the OUTER ASGI wrapper ─────────────────────────────────
#
# socket_app handles:
#   /socket.io/*  →  python-socketio (WebSocket + polling)
#   everything else  →  fastapi_app (REST + docs + lifespan)
#
# MUST be the app uvicorn runs — see module docstring.

socket_app = socketio.ASGIApp(
    socketio_server = sio,
    other_asgi_app  = fastapi_app,
    socketio_path   = "socket.io",   # matches default client path
)

# Alias so both `uvicorn main:app` and `uvicorn main:socket_app` work
app = socket_app


# ── Dev entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"\n🚀  http://localhost:{port}")
    print(f"    Docs   : http://localhost:{port}/docs")
    print(f"    Socket : ws://localhost:{port}/socket.io/\n")
    uvicorn.run(
        "main:socket_app",    # ← socket_app not app
        host       = "0.0.0.0",
        port       = port,
        reload     = True,
        reload_dirs= ["."],
    )