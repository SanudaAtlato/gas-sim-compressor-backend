import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

const MAX_HISTORY = 300
const BASE_URL    = import.meta.env.VITE_SOCKET_URL  || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000')
const PIPELINE_ID = import.meta.env.VITE_PIPELINE_ID || 'alaska'
const LIVE_EVENT  = import.meta.env.VITE_LIVE_EVENT  || 'live_pipeline_update'

export const NODE_COLORS = {
  PS1:'#009e85', PS3:'#d4870a', PS4:'#2b7fc4', PS5:'#7c4dbd',
  HS1:'#f97316', PS9:'#fb923c', HS2:'#ef4444', Sink:'#64748b',
}

export const PIPE_COLORS = {
  PS1_PS3:'#009e85', PS3_PS4:'#d4870a', PS4_PS5:'#2b7fc4',
  PS5_HS1:'#7c4dbd', HS1_PS9:'#f97316', PS9_HS2:'#fb923c', 'HS2_Sink':'#ef4444',
}

export const CONTROLLABLE_PUMPS = ['PS1','PS3','PS4','PS9']
export const NODE_NAMES  = ['PS1','PS3','PS4','PS5','HS1','PS9','HS2','Sink']
export const PIPE_NAMES  = ['PS1_PS3','PS3_PS4','PS4_PS5','PS5_HS1','HS1_PS9','PS9_HS2','HS2_Sink']
export const P_MIN = 50
export const P_MAX = 80

function makeMock(step, pumpStates) {
  const t    = step * 50
  const ramp = Math.min(t / 300, 1)
  const targets = { PS1:80, PS3:79.5, PS4:79.8, PS5:78.2, HS1:72, PS9:80, HS2:68, Sink:66.2 }
  const nodes = {}
  for (const [name, tgt] of Object.entries(targets)) {
    const alpha = pumpStates[name]?.alpha ?? ramp
    const isOn  = pumpStates[name]?.on ?? true
    const scale = ['Sink','PS5','HS1','HS2'].includes(name) ? ramp : (isOn ? alpha : 0)
    const base  = 50 + (tgt - 50) * scale
    nodes[name] = {
      pressure_bar: +(base + Math.random()*0.05).toFixed(4),
      sensor_pressure_bar: +(base + Math.random()*0.08).toFixed(4),
      status: base < P_MIN ? 'alarm_low' : base > P_MAX ? 'alarm_high' : 'normal',
      is_pump: CONTROLLABLE_PUMPS.includes(name),
      is_relief: name === 'PS5',
      is_heater: ['HS1','HS2'].includes(name),
      has_leak: false, pump_on: isOn, pump_alpha: alpha,
    }
  }
  const flowBase = 0.934 * ramp
  const pipes = {}
  for (const name of PIPE_NAMES) {
    pipes[name] = { flow_m3s: +(flowBase + Math.random()*0.002).toFixed(6), flow_kgs: +(flowBase*860).toFixed(3) }
  }
  return {
    step, simulated_time_s: t, junction_names: NODE_NAMES, pipe_names: PIPE_NAMES,
    nodes, pipes, pump_states: pumpStates, heater_states: {},
    calc_pressure: NODE_NAMES.map(n => nodes[n].pressure_bar),
    calc_flows: PIPE_NAMES.map(n => pipes[n].flow_m3s),
    active_leaks: {}, leak_nodes: [],
    leak_detection: { alarm:false, confidence:0, event_type:'Normal', operation_masked:false, wave_detected:false, estimated_location_km:null, estimated_location_range_km:null, location_uncertainty_km:null, nearest_segment:null, triggered_sensors:[], flow_imbalance_kg_s:0, max_cusum:0, min_ewma_residual_bar:0, method_status:{negative_pressure_wave:false, cusum:false, ewma_trend:false, flow_balance:false, operation_mask:false}, sensor_table:[] },
    dra_states: {any_active:false, injectors:{}, segment_profile:{}, full_profile:[]},
    friction_profile: [], temperature_profile: [], node_temperatures: {},
    valve_states: {}, safety_interlock: true, paused: false,
    p_min_bar: P_MIN, p_max_bar: P_MAX,
  }
}

export function useSimulation() {
  const socketRef  = useRef(null)
  const histRef    = useRef([])
  const mockTimer  = useRef(null)
  const mockStep   = useRef(0)

  const [connected,  setConnected]  = useState(false)
  const [latestSnap, setLatestSnap] = useState(null)
  const [history,    setHistory]    = useState([])
  const [pumpStates, setPumpStates] = useState(
    Object.fromEntries(CONTROLLABLE_PUMPS.map(n => [n, {on:false, alpha:0, ramp_pct:0, at_speed:false}]))
  )

  // ── Clear all chart history (called on Stop) ─────────────────────────────
  const clearHistory = useCallback(() => {
    histRef.current = []
    setHistory([])
    setLatestSnap(null)
    mockStep.current = 0
  }, [])

  // ── Ingest a live snapshot ───────────────────────────────────────────────
  const ingest = useCallback((snap) => {
    const t = snap.simulated_time_s ?? 0
    const point = { t: Math.round(t) }
    for (const name of NODE_NAMES)
      point[name] = snap.nodes?.[name]?.pressure_bar ?? 0
    for (const name of PIPE_NAMES)
      point[name] = snap.pipes?.[name]?.flow_m3s ?? 0
    point.leakConfidence = snap.leak_detection?.confidence ?? 0
    point.maxCusum = snap.leak_detection?.max_cusum ?? 0
    point.minEwmaResidual = snap.leak_detection?.min_ewma_residual_bar ?? 0
    const manualLeaks = Object.values(snap.active_leaks || {}).filter(l => l && l.type === 'manual_location')
    if (manualLeaks.length > 0) {
      const leak = manualLeaks[0]
      point.leakActive = true
      point.leakStartT = Math.round(leak.created_at_s ?? t)
      point.leakKm = leak.location_km
      point.leakFlowKgs = leak.flow_kg_s
    }

    histRef.current = [...histRef.current, point].slice(-MAX_HISTORY)
    setHistory([...histRef.current])
    setLatestSnap(snap)
    if (snap.pump_states) setPumpStates(prev => ({ ...prev, ...snap.pump_states }))
  }, [])

  // ── Mock data ─────────────────────────────────────────────────────────────
  const startMock = useCallback(() => {
    if (mockTimer.current) return
    mockTimer.current = setInterval(() => {
      setPumpStates(prev => { ingest(makeMock(mockStep.current++, prev)); return prev })
    }, 1000)
  }, [ingest])

  const stopMock = useCallback(() => {
    if (mockTimer.current) { clearInterval(mockTimer.current); mockTimer.current = null }
  }, [])

  // ── Socket connection ─────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BASE_URL, { transports:['websocket','polling'], reconnectionAttempts:10 })
    socketRef.current = socket

    socket.on('connect',       () => { setConnected(true); stopMock(); socket.emit('join', {room:PIPELINE_ID}) })
    socket.on('disconnect',    () => { setConnected(false); startMock() })
    socket.on('connect_error', () => { if (!mockTimer.current) startMock() })
    socket.on(LIVE_EVENT, ingest)
    socket.on(`${LIVE_EVENT}_${PIPELINE_ID}`, ingest)

    startMock()
    return () => { stopMock(); socket.disconnect() }
  }, [ingest, startMock, stopMock])

  // ── Pump control ──────────────────────────────────────────────────────────
  const pumpStart = useCallback(async (name) => {
    setPumpStates(p => ({ ...p, [name]: { ...p[name], on:true, alpha:0, ramp_pct:0 } }))
    try {
      const res  = await fetch(`${BASE_URL}/simulation/pump/start`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pump_name: name }),
      })
      const data = await res.json()
      if (data.pump_states) setPumpStates(p => ({ ...p, ...data.pump_states }))
    } catch {}
  }, [])

  const pumpStop = useCallback(async (name) => {
    setPumpStates(p => ({ ...p, [name]: { ...p[name], on:false, alpha:0, ramp_pct:0 } }))
    try {
      const res  = await fetch(`${BASE_URL}/simulation/pump/stop`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pump_name: name }),
      })
      const data = await res.json()
      if (data.pump_states) setPumpStates(p => ({ ...p, ...data.pump_states }))
    } catch {}
  }, [])

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = latestSnap?.nodes ? (() => {
    const pressures = NODE_NAMES.map(n => latestSnap.nodes[n]?.pressure_bar ?? 0)
    const flows     = PIPE_NAMES.map(n => latestSnap.pipes?.[n]?.flow_m3s ?? 0)
    const alarmLow  = pressures.filter(p => p < P_MIN && p > 0).length
    const alarmHigh = pressures.filter(p => p > P_MAX).length
    const leak      = latestSnap.leak_detection || {}
    const leakAlarm = leak.alarm ? 1 : 0
    return {
      minP: Math.min(...pressures.filter(p=>p>0)).toFixed(2),
      maxP: Math.max(...pressures).toFixed(2),
      avgP: (pressures.reduce((a,b)=>a+b,0)/pressures.length).toFixed(2),
      avgFlow: (flows.reduce((a,b)=>a+b,0)/(flows.length||1)).toFixed(4),
      simTime: latestSnap.simulated_time_s ?? 0,
      leakConfidence: leak.confidence ?? 0,
      leakAlarm: !!leak.alarm,
      alarmLow, alarmHigh, alarmCount: alarmLow + alarmHigh + leakAlarm,
    }
  })() : null

  return {
    connected, latestSnap, history, kpis, clearHistory,
    pumpStates, pumpStart, pumpStop,
    NODE_COLORS, PIPE_COLORS,
    nodeNames: NODE_NAMES, pipeNames: PIPE_NAMES,
  }
}