# Alaska Pipeline — MOC Transient Backend

FastAPI + Socket.IO backend for the transient pipeline simulation.
Uses the Method of Characteristics (MOC) to solve 1D transient pipe flow.

## Quick start

```bash
# 1. Create virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the server
uvicorn main:socket_app --reload --port 8000
```

Server starts on  http://localhost:8000

## Directory layout

```
backend/
├── main.py                  ← FastAPI + Socket.IO app (run this)
├── simulation_service.py    ← MOC simulation loop + control API
├── moc_solver.py            ← Method of Characteristics engine
├── networks/
│   └── alaska_pipeline.py   ← Alaska pipeline topology + pump curves
└── requirements.txt
```

## Socket.IO events

| Event (server → client) | When | Payload |
|---|---|---|
| `live_pipeline_update` | Every 1 second | Full snapshot (see below) |
| `connection_ack`        | On connect      | Status + last 50 snapshots |

### Snapshot payload

```json
{
  "pipeline_id"      : "alaska",
  "step"             : 42,
  "simulated_time_s" : 7000.0,
  "nodes": {
    "PS1":  { "calc_pressure_bar": 5.21, "sensor_pressure_bar": 5.20, "alarm": false },
    "PS3":  { "calc_pressure_bar": 4.05, "sensor_pressure_bar": 4.03, "alarm": false },
    "PS4":  { "calc_pressure_bar": 18.7, "sensor_pressure_bar": 18.69,"alarm": false },
    "PS5":  { "calc_pressure_bar": 12.1, "sensor_pressure_bar": 12.08,"alarm": false },
    "PS9":  { "calc_pressure_bar": 22.4, "sensor_pressure_bar": 22.38,"alarm": false },
    "Sink": { "calc_pressure_bar": 0.0,  "sensor_pressure_bar": 0.01, "alarm": false }
  },
  "pipes": {
    "PS1_PS3":  { "calc_flow_m3s": 0.934, "calc_flow_kg_s": 802.8 },
    "PS3_PS4":  { "calc_flow_m3s": 0.934, "calc_flow_kg_s": 802.8 },
    "PS4_PS5":  { "calc_flow_m3s": 0.934, "calc_flow_kg_s": 802.8 },
    "PS5_PS9":  { "calc_flow_m3s": 0.934, "calc_flow_kg_s": 802.8 },
    "PS9_Sink": { "calc_flow_m3s": 0.934, "calc_flow_kg_s": 802.8 }
  },
  "junction_names"   : ["PS1","PS3","PS4","PS5","PS9","Sink"],
  "pipe_names"       : ["PS1_PS3","PS3_PS4","PS4_PS5","PS5_PS9","PS9_Sink"],
  "calc_pressure"    : [5.21, 4.05, 18.7, 12.1, 22.4, 0.0],
  "sensor_pressure"  : [5.20, 4.03, 18.69, 12.08, 22.38, 0.01],
  "calc_flows"       : [0.934, 0.934, 0.934, 0.934, 0.934],
  "ewma_alarm_count" : 0,
  "active_leaks"     : {},
  "pump_state"       : {"PS1":true,"PS3":true,"PS4":true,"PS9":true}
}
```

## REST API

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/api/status` | — | Simulation status |
| GET | `/api/history` | — | Last 200 snapshots |
| POST | `/api/leak/add` | `{"node":"PS3","flow_kg_s":5}` | Inject a leak |
| POST | `/api/leak/remove` | `{"node":"PS3"}` | Remove a leak |
| POST | `/api/pump/start` | `{"pump":"PS9"}` | Start a pump |
| POST | `/api/pump/stop` | `{"pump":"PS9"}` | Stop a pump |

## How to connect from the frontend

```js
import { io } from 'socket.io-client'

const socket = io('http://localhost:8000', {
  transports: ['websocket', 'polling']
})

socket.on('live_pipeline_update', (data) => {
  // data.calc_pressure  → array of bar values at each node
  // data.nodes.PS1.calc_pressure_bar  → individual node
  // data.pipes.PS1_PS3.calc_flow_m3s  → pipe flow
})
```
