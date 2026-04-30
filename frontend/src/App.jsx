import { useState, useCallback, useEffect } from 'react'
import { Wifi, WifiOff, AlertTriangle, Settings,
         BarChart2, Thermometer, Activity, Droplets,
         Play, Square, Pause, RotateCcw, Map as MapIcon } from 'lucide-react'
import { useSimulation } from './hooks/useSimulation'
import KPIBar                   from './components/KPIBar'
import NetworkMap               from './components/NetworkMap'
import PressureChart            from './components/PressureChart'
import FlowChart                from './components/FlowChart'
import TemperatureProfileChart  from './components/TemperatureProfileChart'
import FrictionProfileChart     from './components/FrictionProfileChart'
import DRAConcentrationChart    from './components/DRAConcentrationChart'
import ControlsModal            from './components/ControlsModal'
import LeakDetectionPanel        from './components/LeakDetectionPanel'
import MapView                   from './components/MapView'
import styles from './App.module.css'

const BASE_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000'

const TABS = [
  { id:'flow',     icon:BarChart2,   label:'Pressure & Flow'  },
  { id:'temp',     icon:Thermometer, label:'Temperature'       },
  { id:'friction', icon:Activity,    label:'Friction Factor'   },
  { id:'dra',      icon:Droplets,    label:'DRA Concentration' },
]

// sim state: 'idle' | 'running' | 'paused'
export default function App() {
  const {
    connected, latestSnap, history, kpis, clearHistory,
    pumpStates, NODE_COLORS, nodeNames, pipeNames,
  } = useSimulation()

  const [selectedNodes, setSelectedNodes] = useState([])
  const [selectedPipes, setSelectedPipes] = useState([])
  const [showControls,  setShowControls]  = useState(false)
  const [activeTab,     setActiveTab]     = useState('flow')
  const [pageMode,      setPageMode]      = useState('dashboard') // dashboard | mapView | leakCenter
  const [simState,      setSimState]      = useState('idle')  // idle | running | paused
  const [busy,          setBusy]          = useState(false)
  const [statusMsg,     setStatusMsg]     = useState(null)

  const flash = (msg) => { setStatusMsg(msg); setTimeout(() => setStatusMsg(null), 2500) }

  // Sync state on mount
  useEffect(() => {
    fetch(`${BASE_URL}/simulation/status`)
      .then(r => r.json())
      .then(d => {
        if (d.paused)        setSimState('paused')
        else if (d.running)  setSimState('running')
        else                 setSimState('idle')
      })
      .catch(() => {})
  }, [])

  // If live data arrives, simulation must be running
  useEffect(() => {
    if (latestSnap && simState === 'idle') setSimState('running')
    if (latestSnap?.paused && simState === 'running') setSimState('paused')
  }, [latestSnap])

  const handleStart = async () => {
    setBusy(true)
    // Clear previous session's chart data
    clearHistory()
    try {
      await fetch(`${BASE_URL}/simulation/start`, { method:'POST' })
      setSimState('running')
      flash('Simulation started — graphs cleared')
    } catch {
      setSimState('running')
      flash('Demo mode — backend offline')
    } finally { setBusy(false) }
  }

  const handleStop = async () => {
    setBusy(true)
    try {
      await fetch(`${BASE_URL}/simulation/stop`, { method:'POST' })
    } catch {}
    // Always clear graphs on stop, regardless of backend response
    clearHistory()
    setSimState('idle')
    flash('Simulation stopped — graphs cleared')
    setBusy(false)
  }

  const handlePause = async () => {
    setBusy(true)
    try {
      await fetch(`${BASE_URL}/simulation/pause`, { method:'POST' })
    } catch {}
    setSimState('paused')
    flash('Simulation paused')
    setBusy(false)
  }

  const handleResume = async () => {
    setBusy(true)
    try {
      await fetch(`${BASE_URL}/simulation/resume`, { method:'POST' })
    } catch {}
    setSimState('running')
    flash('Simulation resumed')
    setBusy(false)
  }

  const toggleNode = useCallback(name =>
    setSelectedNodes(p => p.includes(name) ? p.filter(n=>n!==name) : [...p,name])
  , [])

  const togglePipe = useCallback(name =>
    setSelectedPipes(p => p.includes(name) ? p.filter(n=>n!==name) : [...p,name])
  , [])

  const alarmCount  = kpis?.alarmCount ?? 0
  const isIdle      = simState === 'idle'
  const isRunning   = simState === 'running'
  const isPaused    = simState === 'paused'
  const showCharts  = isRunning || isPaused
  const inSpecialView = pageMode !== 'dashboard'

  return (
    <div className={styles.app}>

      {/* ── Header ──────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>
            <span className={styles.logoPipe} />
            <span className={`syne ${styles.logoText}`}>PIPELINE<span>·</span>MONITOR</span>
          </div>
          <span className={styles.headerMeta}>Alaska · MOC Transient + Thermal + DRA</span>
        </div>

        <div className={styles.headerRight}>

          {statusMsg && <span className={`mono ${styles.statusMsg}`}>{statusMsg}</span>}

          {/* ── START (idle) ─────────────────────────── */}
          {isIdle && (
            <button className={styles.startBtn} onClick={handleStart} disabled={busy}>
              <Play size={13} fill="currentColor"/>
              {busy ? 'Starting…' : 'Start'}
            </button>
          )}

          {/* ── PAUSE + STOP (running) ────────────────── */}
          {isRunning && (<>
            <button className={styles.pauseBtn} onClick={handlePause} disabled={busy}>
              <Pause size={13} fill="currentColor"/>
              {busy ? '…' : 'Pause'}
            </button>
            <button className={styles.stopBtn} onClick={handleStop} disabled={busy}>
              <Square size={12} fill="currentColor"/>
              {busy ? '…' : 'Stop'}
            </button>
          </>)}

          {/* ── RESUME + STOP (paused) ────────────────── */}
          {isPaused && (<>
            <div className={styles.pausedBadge}>⏸ PAUSED</div>
            <button className={styles.startBtn} onClick={handleResume} disabled={busy}>
              <RotateCcw size={13}/>
              {busy ? '…' : 'Resume'}
            </button>
            <button className={styles.stopBtn} onClick={handleStop} disabled={busy}>
              <Square size={12} fill="currentColor"/>
              {busy ? '…' : 'Stop'}
            </button>
          </>)}

          {alarmCount > 0 && (
            <div className={styles.alarmBadge}>
              <AlertTriangle size={12}/>{alarmCount} alarm{alarmCount!==1?'s':''}
            </div>
          )}

          <button className={styles.controlsBtn} onClick={() => setShowControls(true)}>
            <Settings size={14}/> Controls
          </button>

          <div className={styles.mainViewBtns}>
            <button
              className={styles.viewSwitchBtn}
              data-active={pageMode==='mapView'}
              onClick={() => setPageMode('mapView')}
            >
              <MapIcon size={14}/> Map View
            </button>
            <button
              className={styles.viewSwitchBtn}
              data-active={pageMode==='leakCenter'}
              onClick={() => setPageMode('leakCenter')}
            >
              <AlertTriangle size={14}/> Leak Center
            </button>
            {inSpecialView && (
              <button className={styles.returnBtn} onClick={() => setPageMode('dashboard')}>
                <RotateCcw size={14}/> Back to Overview
              </button>
            )}
          </div>

          <div className={styles.connBadge} data-connected={connected}>
            {connected ? <Wifi size={13}/> : <WifiOff size={13}/>}
            <span>{connected?'LIVE':'DEMO'}</span>
          </div>

          {kpis && (
            <div className={`mono ${styles.simTime}`}>
              T = {Math.round(kpis.simTime).toLocaleString()} s
            </div>
          )}
        </div>
      </header>

      {/* ── KPI strip ───────────────────────────────────── */}
      <KPIBar kpis={kpis} alarmCount={alarmCount} />

      {/* ── Main ────────────────────────────────────────── */}
      <main className={styles.main}>

        {pageMode==='dashboard' && (
          <>
            <div className={styles.networkSection}>
              <NetworkMap
                latestSnap={latestSnap}
                selectedNodes={selectedNodes}
                onToggleNode={toggleNode}
                NODE_COLORS={NODE_COLORS}
              />
            </div>

            {/* Idle state */}
            {isIdle && (
              <div className={styles.stoppedBanner}>
                <span>Simulation is not running.</span>
                <button className={styles.startBtn} onClick={handleStart} disabled={busy}>
                  <Play size={13} fill="currentColor"/>
                  {busy ? 'Starting…' : 'Start Simulation'}
                </button>
              </div>
            )}

            {/* Tab bar — visible when running or paused */}
            {showCharts && (
              <div className={styles.tabBar}>
                {TABS.map(({id, icon:Icon, label}) => (
                  <button key={id} className={styles.tabBtn}
                    data-active={activeTab===id} onClick={() => setActiveTab(id)}>
                    <Icon size={13}/>{label}
                  </button>
                ))}
              </div>
            )}

            {/* Charts */}
            {showCharts && (
              <div className={styles.chartPanel}>
                {activeTab==='flow' && (
                  <div className={styles.twoCol}>
                    <PressureChart
                      history={history} selectedNodes={selectedNodes}
                      onToggleNode={toggleNode} nodeNames={nodeNames}
                    />
                    <FlowChart
                      history={history} selectedPipes={selectedPipes}
                      onTogglePipe={togglePipe} pipeNames={pipeNames}
                    />
                  </div>
                )}
                {activeTab==='temp'     && <TemperatureProfileChart latestSnap={latestSnap}/>}
                {activeTab==='friction' && <FrictionProfileChart    latestSnap={latestSnap}/>}
                {activeTab==='dra'      && <DRAConcentrationChart   latestSnap={latestSnap}/>}
              </div>
            )}
          </>
        )}

        {pageMode==='mapView' && (
          <div className={styles.specialViewPanel}>
            <MapView latestSnap={latestSnap} selectedNodes={selectedNodes} onToggleNode={toggleNode}/>
          </div>
        )}

        {pageMode==='leakCenter' && (
          <div className={styles.specialViewPanel}>
            <LeakDetectionPanel latestSnap={latestSnap} history={history}/>
          </div>
        )}

      </main>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className={styles.footer}>
        <span>MOC · Thermal-Hydraulic · DRA (Rashid 2019 PAA) · Beggs-Robinson</span>
        <span>Δx=2000m · Δt=1.667s · a=1200m/s · kd=0.004km⁻¹</span>
      </footer>

      {showControls && (
        <ControlsModal
          onClose={() => setShowControls(false)}
          pumpStates={pumpStates}
          latestSnap={latestSnap}
        />
      )}
    </div>
  )
}