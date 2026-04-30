import { useState, useEffect } from 'react'
import styles from './ControlsModal.module.css'

const BASE_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000'

const PUMP_META = {
  PS1: { label:'Pump Station 1', km:0,   sub:'Inlet booster — 30 bar' },
  PS3: { label:'Pump Station 3', km:132, sub:'Booster — 3 bar' },
  PS4: { label:'Pump Station 4', km:196, sub:'Booster — 1.4 bar' },
  PS9: { label:'Pump Station 9', km:676, sub:'Pre-delivery — 10.8 bar' },
}

const HEATER_META = {
  HS1: { label:'Heating Station 1', km:474, sub:'Mid-route · PS5→PS9 · 474 km', catalog:'HS_MP238_STANDARD' },
  HS2: { label:'Heating Station 2', km:976, sub:'Pre-delivery · PS9→Sink · 976 km', catalog:'HS_PS8_REHEAT' },
}

export default function ControlsModal({ onClose, pumpStates, latestSnap }) {
  const [tab, setTab]         = useState('pumps')
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState(null)

  const [pendingPumps,   setPendingPumps]   = useState({})
  const [pendingHeaters, setPendingHeaters] = useState({})
  const [pendingAmbient, setPendingAmbient] = useState(null)
  const [pendingInlet,   setPendingInlet]   = useState(null)

  const heaterStates = latestSnap?.heater_states ?? {}
  const draStates    = latestSnap?.dra_states?.injectors ?? {}
  const activeLeaks  = latestSnap?.active_leaks ?? {}

  const [pendingDRA, setPendingDRA] = useState({})
  const [leakKm, setLeakKm] = useState(300)
  const [leakFlow, setLeakFlow] = useState(80)
  const [leakBusy, setLeakBusy] = useState(false)
  const [leakMsg, setLeakMsg] = useState(null)
  // Init DRA from live state
  useEffect(() => {
    const init = {}
    for (const [sid, d] of Object.entries(draStates)) {
      init[sid] = { on: d.on ?? false, conc_ppm: d.conc_ppm ?? 0 }
    }
    if (Object.keys(init).length) setPendingDRA(init)
  }, [])  // eslint-disable-line

  // Init heater sliders from live state
  useEffect(() => {
    const init = {}
    for (const [id, hs] of Object.entries(heaterStates)) {
      init[id] = { target_c: hs.target_c ?? 40, on: hs.on ?? true }
    }
    if (Object.keys(init).length) setPendingHeaters(init)
    setPendingAmbient(latestSnap?.ambient_temp_c ?? -5)
    setPendingInlet(latestSnap?.inlet_temp_c ?? 55)
  }, [])

  const togglePump = (name) => {
    const on = pumpStates[name]?.on ?? false
    setPendingPumps(p => p[name] ? (({ [name]:_, ...rest }) => rest)(p) : { ...p, [name]: on ? 'stop' : 'start' })
  }

  const updateHeater = (id, key, val) =>
    setPendingHeaters(p => ({ ...p, [id]: { ...(p[id]??{}), [key]: val } }))

  const applyAll = async () => {
    setApplying(true); setApplyMsg(null)
    const reqs = []

    for (const [name, action] of Object.entries(pendingPumps))
      reqs.push(fetch(`${BASE_URL}/simulation/pump/${action}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pump_name: name }),
      }).catch(()=>null))

    for (const [id, cfg] of Object.entries(pendingHeaters))
      reqs.push(fetch(`${BASE_URL}/simulation/heater/set`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ heater_id:id, target_c:cfg.target_c, on:cfg.on }),
      }).catch(()=>null))

    if (pendingAmbient !== null)
      reqs.push(fetch(`${BASE_URL}/simulation/ambient/set`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ temperature_c: pendingAmbient }),
      }).catch(()=>null))

    // Apply DRA changes
    for (const [sid, cfg] of Object.entries(pendingDRA))
      reqs.push(fetch(`${BASE_URL}/simulation/dra/set`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ station_id:sid, on:cfg.on, conc_ppm:cfg.conc_ppm }),
      }).catch(()=>null))

    if (pendingInlet !== null)
      reqs.push(fetch(`${BASE_URL}/simulation/inlet/set`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ temperature_c: pendingInlet }),
      }).catch(()=>null))

    await Promise.all(reqs)
    setApplying(false)
    setApplyMsg('Applied successfully')
    setTimeout(() => onClose(), 700)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target===e.currentTarget && onClose()}>
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.modalHeader}>
          <div>
            <h2 className={`syne ${styles.modalTitle}`}>Pipeline Controls</h2>
            <p className={styles.modalSub}>Stage changes below, then click Apply to Network</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {[['pumps','Pump Control'],['valves','Valves'],['leak','Leak Injection'],['heaters','Heater Stations'],['dra','DRA Injection'],['thermal','Thermal Settings']].map(([id,lbl])=>(
            <button key={id} className={styles.tab} data-active={tab===id} onClick={()=>setTab(id)}>
              {lbl}
              {id==='pumps' && Object.keys(pendingPumps).length > 0 &&
                <span className={styles.pendingDot}>{Object.keys(pendingPumps).length}</span>}
            </button>
          ))}
        </div>

        {/* ── PUMP TAB ─────────────────────────────────────── */}
        {tab==='pumps' && (
          <div className={styles.tabContent}>
            <p className={styles.tabHint}>Stage pump changes. START ramps over 5 min. TRIP is an instant emergency stop.</p>
            <div className={styles.pumpGrid}>
              {Object.entries(PUMP_META).map(([name, meta]) => {
                const isOn   = pumpStates[name]?.on ?? false
                const alpha  = pumpStates[name]?.alpha ?? 0
                const pending= pendingPumps[name]
                const willOn = pending ? pending==='start' : isOn
                return (
                  <div key={name} className={styles.pumpCard} data-on={willOn} data-pending={!!pending}>
                    <div className={styles.pumpAccent} data-on={willOn} />
                    <div className={styles.pumpTop}>
                      <div>
                        <div className={`syne ${styles.pumpName}`}>{name}</div>
                        <div className={styles.pumpLabel}>{meta.label}</div>
                        <div className={`mono ${styles.pumpSub}`}>{meta.km} km · {meta.sub}</div>
                      </div>
                      <div className={styles.pumpBadge} data-on={willOn}>
                        <span className={styles.pumpDot} data-on={willOn} />
                        {willOn ? (alpha>=0.999?'RUNNING':'RAMPING') : 'OFFLINE'}
                        {pending && <span className={styles.pendingTag}> (pending)</span>}
                      </div>
                    </div>
                    <div className={styles.rampRow}>
                      <span className={styles.rampLbl}>Speed</span>
                      <div className={styles.rampTrack}><div className={styles.rampFill} data-on={isOn} style={{width:`${(alpha*100).toFixed(0)}%`}}/></div>
                      <span className={`mono ${styles.rampPct}`}>{(alpha*100).toFixed(0)}%</span>
                    </div>
                    <button className={styles.pumpToggle}
                      data-will={willOn?'stop':'start'} onClick={()=>togglePump(name)}>
                      {willOn ? '■ Stage TRIP' : '▶ Stage START'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}


        {/* ── VALVE TAB ────────────────────────────────────── */}
        {tab==='valves' && (
          <div className={styles.tabContent}>
            <p className={styles.tabHint}>
              Valves sit upstream of each pump station (except PS1).
              Closing a valve triggers a water hammer pressure wave that
              travels at a=1200 m/s. Closure takes 60 s by default —
              realistic for a large pipeline ball valve.
              Flow downstream of the closed valve drops automatically
              as the MOC solver resolves the transient.
            </p>


            {/* ── Interlock toggle ─────────────────────────────── */}
            <div className={styles.interlockRow}>
              <div>
                <div className={`syne ${styles.interlockTitle}`}>
                  🔒 Safety Interlock — Auto-trip upstream pump on valve close
                </div>
                <div className={`mono ${styles.interlockDesc}`}>
                  ON: Closing a valve automatically stops the upstream pump (real pipeline behaviour).
                  OFF: Valve closes but pump keeps running — lets you study pure water hammer without pump trip.
                </div>
              </div>
              <label className={styles.toggle}>
                <input type="checkbox"
                  checked={latestSnap?.safety_interlock ?? true}
                  onChange={async e => {
                    await fetch(`${BASE_URL}/simulation/interlock/set`, {
                      method:'POST', headers:{'Content-Type':'application/json'},
                      body: JSON.stringify({ enabled: e.target.checked }),
                    }).catch(()=>null)
                  }}
                />
                <span className={styles.toggleSlider} />
                <span className={styles.toggleLabel}>
                  {(latestSnap?.safety_interlock ?? true) ? 'ON' : 'OFF'}
                </span>
              </label>
            </div>

            {[
              {id:'V_PS3', label:'Valve — before PS3', km:132, desc:'Upstream of PS3 pump · PS1_PS3 segment end'},
              {id:'V_PS4', label:'Valve — before PS4', km:196, desc:'Upstream of PS4 pump · PS3_PS4 segment end'},
              {id:'V_PS9', label:'Valve — before PS9', km:676, desc:'Upstream of PS9 pump · HS1_PS9 segment end'},
            ].map(({id, label, km, desc}) => {
              const vs      = latestSnap?.valve_states?.[id] ?? {tau:1,state:'open',pct_open:100}
              const isOpen  = vs.state === 'open'
              const isClose = vs.state === 'closed'
              const isMov   = vs.state === 'closing' || vs.state === 'opening'
              const pct     = vs.pct_open ?? (vs.tau * 100)
              const stateColor = isClose ? 'var(--coral)' : isMov ? 'var(--amber)' : 'var(--teal)'

              return (
                <div key={id} className={styles.valveCard} data-state={vs.state}>
                  <div className={styles.valveAccent} style={{background: stateColor}} />

                  <div className={styles.valveTop}>
                    <div>
                      <div className={`syne ${styles.valveName}`}>{id}</div>
                      <div className={styles.valveLabel}>{label}</div>
                      <div className={`mono ${styles.valveSub}`}>{km} km · {desc}</div>
                    </div>
                    <div className={styles.valveBadge} style={{borderColor: stateColor, color: stateColor, background: `color-mix(in srgb, ${stateColor} 10%, transparent)`}}>
                      {vs.state.toUpperCase()}
                    </div>
                  </div>

                  {/* Opening fraction bar */}
                  <div className={styles.valveBarRow}>
                    <span className={styles.rampLbl}>Open</span>
                    <div className={styles.rampTrack}>
                      <div className={styles.rampFill}
                        style={{width:`${pct}%`, background: stateColor, transition:'width 0.5s'}} />
                    </div>
                    <span className={`mono ${styles.rampPct}`}>{pct.toFixed(0)}%</span>
                  </div>

                  {/* τ readout */}
                  <div className={styles.alphaRow}>
                    <span className={styles.alphaLabel}>τ (opening fraction)</span>
                    <span className={`mono ${styles.alphaVal}`}>{(vs.tau ?? 1).toFixed(4)}</span>
                  </div>

                  {/* Controls */}
                  <div className={styles.btnRow}>
                    <button className={styles.btnStart}
                      disabled={isOpen || isMov}
                      onClick={async () => {
                        await fetch(`${BASE_URL}/simulation/valve/open`,{
                          method:'POST', headers:{'Content-Type':'application/json'},
                          body: JSON.stringify({valve_name: id})
                        }).catch(()=>null)
                      }}>
                      ▲ OPEN  (90 s)
                    </button>
                    <button className={styles.btnStop}
                      disabled={isClose || isMov}
                      onClick={async () => {
                        await fetch(`${BASE_URL}/simulation/valve/close`,{
                          method:'POST', headers:{'Content-Type':'application/json'},
                          body: JSON.stringify({valve_name: id})
                        }).catch(()=>null)
                      }}>
                      ▼ CLOSE (60 s)
                    </button>
                  </div>

                  {isMov && (
                    <div className={styles.hint}>
                      {vs.state === 'closing'
                        ? `⚡ Closing — water hammer wave propagating upstream at 1200 m/s`
                        : `↑ Opening — pressure recovering`}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── LEAK INJECTION TAB ───────────────────────────── */}
        {tab==='leak' && (
          <div className={styles.tabContent}>
            <p className={styles.tabHint}>
              Manually inject a leak anywhere along the 1,288 km mainline.
              The backend snaps your selected km to the nearest MOC grid cell,
              removes the selected leak flow from that cell, then the leak detector
              back-calculates the location from pressure-wave arrival times.
            </p>

            <div className={styles.leakCard}>
              <div className={styles.leakTop}>
                <div>
                  <div className={`syne ${styles.leakTitle}`}>💥 Manual Leak Injection</div>
                  <div className={`mono ${styles.leakSub}`}>Location from PS1 inlet · solver grid Δx = 2 km</div>
                </div>
                <div className={`mono ${styles.leakReadout}`}>{Number(leakKm).toFixed(1)} km</div>
              </div>

              <div className={styles.leakControl}>
                <span className={styles.slimLbl}>0 km</span>
                <input
                  type="range" min={0} max={1288} step={1}
                  value={leakKm}
                  className={styles.leakSlider}
                  style={{ '--pct':`${(Number(leakKm)/1288)*100}%` }}
                  onChange={e => setLeakKm(Number(e.target.value))}
                />
                <span className={styles.slimLbl}>1288 km</span>
              </div>

              <div className={styles.leakFields}>
                <label>
                  <span>Leak location</span>
                  <input type="number" min={0} max={1288} step={1}
                    value={leakKm}
                    onChange={e => setLeakKm(Math.max(0, Math.min(1288, Number(e.target.value)||0)))} />
                </label>
                <label>
                  <span>Leak flow</span>
                  <input type="number" min={1} max={2000} step={5}
                    value={leakFlow}
                    onChange={e => setLeakFlow(Math.max(1, Number(e.target.value)||1))} />
                </label>
                <div className={styles.leakUnit}>kg/s</div>
              </div>

              <div className={styles.btnRow}>
                <button className={styles.btnStop} disabled={leakBusy}
                  onClick={async () => {
                    setLeakBusy(true); setLeakMsg(null)
                    try {
                      const res = await fetch(`${BASE_URL}/simulation/leak/add-location`, {
                        method:'POST', headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({ location_km:Number(leakKm), flow_kg_s:Number(leakFlow) })
                      })
                      const data = await res.json()
                      setLeakMsg(data.message || 'Manual leak injected')
                    } catch {
                      setLeakMsg('Backend offline — leak not injected')
                    } finally { setLeakBusy(false) }
                  }}>
                  💥 Inject Leak
                </button>
                <button className={styles.btnStart} disabled={leakBusy}
                  onClick={async () => {
                    setLeakBusy(true); setLeakMsg(null)
                    try {
                      const res = await fetch(`${BASE_URL}/simulation/leak/clear`, { method:'POST' })
                      const data = await res.json()
                      setLeakMsg(data.message || 'All leaks removed')
                    } catch {
                      setLeakMsg('Backend offline — could not clear leaks')
                    } finally { setLeakBusy(false) }
                  }}>
                  Clear Leaks
                </button>
              </div>

              {leakMsg && <div className={styles.leakMsg}>{leakMsg}</div>}
            </div>

            <div className={styles.activeLeakBox}>
              <div className={`syne ${styles.activeLeakTitle}`}>Active Injected Leaks</div>
              {Object.keys(activeLeaks).length === 0 && (
                <div className={styles.noLeaks}>No leak is currently injected.</div>
              )}
              {Object.entries(activeLeaks).map(([id, leak]) => (
                <div key={id} className={styles.activeLeakRow}>
                  <div>
                    <strong>{id}</strong>
                    <span>
                      {typeof leak === 'object'
                        ? `${leak.location_km ?? leak.node ?? 'node'} km · ${leak.pipe_name ?? leak.node ?? 'node leak'}`
                        : 'node leak'}
                    </span>
                  </div>
                  <div className="mono">
                    {typeof leak === 'object' ? `${leak.flow_kg_s ?? '—'} kg/s` : `${leak} kg/s`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}


        {/* ── HEATER TAB ───────────────────────────────────── */}
        {tab==='heaters' && (
          <div className={styles.tabContent}>
            <p className={styles.tabHint}>
              Adjust heater target temperature and on/off state.
              Oil is heated using energy balance: Q = ṁ·Cp·ΔT, capped at max power.
              After heating, oil cools exponentially toward ambient as it flows downstream.
            </p>
            {Object.entries(HEATER_META).map(([id, meta]) => {
              const live = heaterStates[id] ?? {}
              const cfg  = pendingHeaters[id] ?? { target_c: live.target_c??40, on: live.on??true }
              const actualMw = live.actual_mw ?? 0
              const maxMw    = live.max_mw ?? 20
              return (
                <div key={id} className={styles.heaterCard} data-on={cfg.on}>
                  <div className={styles.heaterAccent} />
                  <div className={styles.heaterTop}>
                    <div>
                      <div className={`syne ${styles.heaterName}`}>🔥 {id}</div>
                      <div className={styles.heaterLabel}>{meta.label}</div>
                      <div className={`mono ${styles.heaterSub}`}>{meta.sub}</div>
                      <div className={`mono ${styles.heaterCatalog}`}>Catalog: {meta.catalog}</div>
                    </div>
                    <label className={styles.toggle}>
                      <input type="checkbox" checked={cfg.on}
                        onChange={e => updateHeater(id,'on',e.target.checked)} />
                      <span className={styles.toggleSlider} />
                      <span className={styles.toggleLabel}>{cfg.on ? 'ON' : 'OFF'}</span>
                    </label>
                  </div>

                  {cfg.on && <>
                    <div className={styles.heaterSliderRow}>
                      <span className={styles.slimLbl}>Target temp</span>
                      <input type="range" min={20} max={80} step={1}
                        value={cfg.target_c}
                        className={styles.heaterSlider}
                        style={{ '--pct':`${((cfg.target_c-20)/60)*100}%`, '--col':'#f97316' }}
                        onChange={e => updateHeater(id,'target_c',Number(e.target.value))}
                      />
                      <span className={`mono ${styles.heaterTempVal}`}>{cfg.target_c}°C</span>
                    </div>

                    {/* Live output status */}
                    <div className={styles.heaterStats}>
                      <div className={styles.heaterStat}>
                        <span>Actual output</span>
                        <span className="mono">{actualMw.toFixed(1)} / {maxMw} MW</span>
                      </div>
                      <div className={styles.heaterStat}>
                        <span>Fuel duty</span>
                        <span className="mono">{live.fuel_mw?.toFixed(1) ?? '—'} MW ({((live.efficiency??0.85)*100).toFixed(0)}% eff)</span>
                      </div>
                      <div className={styles.heaterStat}>
                        <span>Status</span>
                        <span className="mono" style={{color: live.active ? '#f97316' : '#8a93a6'}}>
                          {live.active ? 'HEATING' : 'IDLE'}
                        </span>
                      </div>
                      {/* Power bar */}
                      <div className={styles.powerBar}>
                        <div className={styles.powerFill}
                          style={{ width:`${Math.min((actualMw/maxMw)*100,100)}%` }} />
                      </div>
                    </div>
                  </>}
                </div>
              )
            })}
          </div>
        )}


        {/* ── DRA TAB ─────────────────────────────────────── */}
        {tab==='dra' && (
          <div className={styles.tabContent}>
            <p className={styles.tabHint}>
              Drag Reduction Agents (DRA) reduce pipe friction by up to 16% at 250 ppm.
              Model: DR = (a·C)/(1+b·C) fitted to Rashid 2019 Iraqi crude + PAA data (R²=0.997).
              DRA degrades along pipe: C_active(x) = C_inj × exp(−0.004×km).
              f_effective = f_thermal × (1 − DR). Changes apply from the next MOC step.
            </p>

            {/* Clear all button */}
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:10}}>
              <button className={styles.cancelBtn}
                style={{borderColor:'var(--coral)',color:'var(--coral)'}}
                onClick={async () => {
                  await fetch(`${BASE_URL}/simulation/dra/clear`,{method:'POST'}).catch(()=>null)
                  setPendingDRA(p => Object.fromEntries(Object.keys(p).map(k=>[k,{on:false,conc_ppm:0}])))
                }}>
                🚫 Clear All DRA Injections
              </button>
            </div>

            <div className={styles.draGrid}>
              {[['PS1',0],['PS3',132],['PS4',196],['PS9',676]].map(([sid,km]) => {
                const live = draStates[sid] ?? {}
                const cfg  = pendingDRA[sid] ?? { on: live.on??false, conc_ppm: live.conc_ppm??0 }
                const drPct = (0.001278 * cfg.conc_ppm) / (1 + 0.003847 * cfg.conc_ppm) * 100
                const fFactor = 1 - drPct/100
                return (
                  <div key={sid} className={styles.draCard} data-on={cfg.on}>
                    <div className={styles.draAccent} data-on={cfg.on} />
                    <div className={styles.draTop}>
                      <div>
                        <div className={`syne ${styles.draName}`}>💧 {sid}</div>
                        <div className={`mono ${styles.draSub}`}>{km} km · injection point</div>
                      </div>
                      <label className={styles.toggle}>
                        <input type="checkbox" checked={cfg.on}
                          onChange={e => setPendingDRA(p=>({...p,[sid]:{...p[sid],on:e.target.checked}}))} />
                        <span className={styles.toggleSlider} style={{'--ton':'#2b7fc4'}} />
                        <span className={styles.toggleLabel}>{cfg.on ? 'INJECTING' : 'OFF'}</span>
                      </label>
                    </div>

                    {cfg.on && <>
                      <div className={styles.draSliderRow}>
                        <span className={styles.slimLbl}>0</span>
                        <input type="range" min={0} max={250} step={5}
                          value={cfg.conc_ppm}
                          className={styles.draSlider}
                          style={{ '--pct':`${(cfg.conc_ppm/250)*100}%` }}
                          onChange={e => setPendingDRA(p=>({...p,[sid]:{...p[sid],conc_ppm:Number(e.target.value)}}))}
                        />
                        <span className={styles.slimLbl}>250</span>
                        <span className={`mono ${styles.draConc}`}>{cfg.conc_ppm} ppm</span>
                      </div>

                      <div className={styles.draStats}>
                        <div className={styles.draStatRow}>
                          <span>DR at injection</span>
                          <span className="mono">{drPct.toFixed(1)}%</span>
                        </div>
                        <div className={styles.draStatRow}>
                          <span>Friction factor</span>
                          <span className="mono">{fFactor.toFixed(4)} × f_thermal</span>
                        </div>
                        <div className={styles.draStatRow}>
                          <span>At 100 km downstream</span>
                          <span className="mono">
                            {((0.001278*(cfg.conc_ppm*Math.exp(-0.4)))/(1+0.003847*(cfg.conc_ppm*Math.exp(-0.4)))*100).toFixed(1)}% DR remaining
                          </span>
                        </div>
                        {/* DRA bar */}
                        <div className={styles.draBar}>
                          <div className={styles.draBarFill} style={{width:`${Math.min(drPct/20*100,100)}%`}} />
                        </div>
                        <div style={{fontSize:9,color:'var(--text-muted)',textAlign:'right',fontFamily:"'DM Mono',monospace"}}>
                          max 16% at 250ppm (Rashid 2019)
                        </div>
                      </div>
                    </>}
                    {!cfg.on && (
                      <div style={{fontSize:10,color:'var(--text-muted)',padding:'8px 0 4px',fontFamily:"'DM Mono',monospace"}}>
                        No DRA injected at this station
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Live segment profile */}
            {latestSnap?.dra_states?.any_active && (
              <div className={styles.draProfile}>
                <div className={`syne ${styles.draProfileTitle}`}>Live Segment DR Profile</div>
                <div className={styles.draProfileGrid}>
                  {Object.entries(latestSnap?.dra_states?.segment_profile ?? {}).map(([seg, d]) => (
                    <div key={seg} className={styles.draProfileRow}>
                      <span className="mono">{seg}</span>
                      <span className={styles.draProfileBar}>
                        <span style={{width:`${(d.dr_percent/20)*100}%`,background:'#2b7fc4',height:'100%',borderRadius:'99px',display:'block',transition:'width 0.4s'}}/>
                      </span>
                      <span className="mono">{d.dr_percent.toFixed(1)}% DR</span>
                      <span className="mono" style={{color:'var(--text-muted)'}}>{d.active_conc_ppm.toFixed(0)} ppm</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── THERMAL SETTINGS TAB ─────────────────────────── */}
        {tab==='thermal' && (
          <div className={styles.tabContent}>
            <p className={styles.tabHint}>
              Set global thermal conditions. Ambient temperature controls pipe heat loss rate.
              Inlet temperature is the crude oil temperature entering PS1 from the source.
            </p>
            <div className={styles.thermalGrid}>
              <div className={styles.thermalCard}>
                <div className={`syne ${styles.thermalTitle}`}>Ambient / Ground Temperature</div>
                <div className={styles.thermalDesc}>
                  Alaska permafrost ground temperature. Controls the rate at which oil cools in buried pipes.
                  Lower ambient → faster cooling → heaters work harder.
                </div>
                <div className={styles.heaterSliderRow}>
                  <span className={styles.slimLbl}>−20°C</span>
                  <input type="range" min={-20} max={20} step={1}
                    value={pendingAmbient ?? -5}
                    className={styles.heaterSlider}
                    style={{ '--pct':`${((pendingAmbient??-5)+20)/40*100}%`, '--col':'#2b7fc4' }}
                    onChange={e => setPendingAmbient(Number(e.target.value))}
                  />
                  <span className={styles.slimLbl}>+20°C</span>
                  <span className={`mono ${styles.heaterTempVal}`}>{pendingAmbient ?? -5}°C</span>
                </div>
              </div>

              <div className={styles.thermalCard}>
                <div className={`syne ${styles.thermalTitle}`}>Crude Oil Inlet Temperature (PS1)</div>
                <div className={styles.thermalDesc}>
                  Temperature of crude entering PS1 from the upstream source.
                  Higher inlet → less heating required → lower heater duty.
                </div>
                <div className={styles.heaterSliderRow}>
                  <span className={styles.slimLbl}>20°C</span>
                  <input type="range" min={20} max={80} step={1}
                    value={pendingInlet ?? 55}
                    className={styles.heaterSlider}
                    style={{ '--pct':`${((pendingInlet??55)-20)/60*100}%`, '--col':'#d4870a' }}
                    onChange={e => setPendingInlet(Number(e.target.value))}
                  />
                  <span className={styles.slimLbl}>80°C</span>
                  <span className={`mono ${styles.heaterTempVal}`}>{pendingInlet ?? 55}°C</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className={styles.modalFooter}>
          {applyMsg && <span className={styles.applyMsg}>{applyMsg}</span>}
          <div className={styles.footerBtns}>
            <button className={styles.cancelBtn} onClick={onClose} disabled={applying}>Cancel</button>
            <button className={styles.applyBtn} onClick={applyAll} disabled={applying}>
              {applying ? 'Applying…' : 'Apply to Network'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}