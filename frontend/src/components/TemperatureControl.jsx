import { useState } from 'react'
import styles from './TemperatureControl.module.css'

const PIPE_META = {
  PS1_PS3:  { label: 'PS1 → PS3', km: 132, desc: 'Hot crude from PS1 inlet booster' },
  PS3_PS4:  { label: 'PS3 → PS4', km:  64, desc: 'Cooling after PS3 boost' },
  PS4_PS5:  { label: 'PS4 → PS5', km:  78, desc: 'Mid-line segment' },
  PS5_PS9:  { label: 'PS5 → PS9', km: 402, desc: 'Longest segment — most cooling' },
  PS9_Sink: { label: 'PS9 → Sink', km: 612, desc: 'Coldest — near delivery terminal' },
}

const BASE_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000'

// Colour interpolation: blue (cold 4°C) → teal (mid 50°C) → amber (hot 100°C)
function tempColor(t) {
  if (t <= 30) {
    const r = Math.round(43  + (0  - 43)  * ((t-4)  / 26))
    const g = Math.round(127 + (158- 127) * ((t-4)  / 26))
    const b = Math.round(196 + (133- 196) * ((t-4)  / 26))
    return `rgb(${r},${g},${b})`
  }
  const r = Math.round(0   + (212 - 0)   * ((t-30) / 70))
  const g = Math.round(158 + (135 - 158) * ((t-30) / 70))
  const b = Math.round(133 + (10  - 133) * ((t-30) / 70))
  return `rgb(${r},${g},${b})`
}

function PropRow({ label, value, unit }) {
  if (value == null) return null
  return (
    <div className={styles.propRow}>
      <span className={styles.propLabel}>{label}</span>
      <span className={`mono ${styles.propVal}`}>{typeof value === 'number' ? value.toFixed(3) : value} <span>{unit}</span></span>
    </div>
  )
}

function PipeCard({ name, pipeData, onTemperatureChange }) {
  const meta     = PIPE_META[name]
  const temp     = pipeData?.temperature_c ?? 29
  const [local, setLocal]     = useState(temp)
  const [saving, setSaving]   = useState(false)
  const [status, setStatus]   = useState(null)   // 'ok' | 'error'
  const color = tempColor(local)

  const handleSlider = (e) => setLocal(Number(e.target.value))

  const handleApply = async () => {
    setSaving(true);  setStatus(null)
    try {
      const res = await fetch(`${BASE_URL}/simulation/temperature/set`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ pipe_name: name, temperature: local }),
      })
      const data = await res.json()
      setStatus(res.ok ? 'ok' : 'error')
      if (res.ok && data.properties) onTemperatureChange(name, data.properties)
      setTimeout(() => setStatus(null), 2000)
    } catch {
      // Demo mode — just optimistically update
      setStatus('ok')
      onTemperatureChange(name, { temperature_c: local })
      setTimeout(() => setStatus(null), 1500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.card} style={{ '--pipe-color': color }}>
      <div className={styles.colorBar} />

      <div className={styles.top}>
        <div>
          <div className={`syne ${styles.pipeName}`}>{meta.label}</div>
          <div className={styles.pipeDesc}>{meta.km} km · {meta.desc}</div>
        </div>
        <div className={`mono ${styles.tempBig}`} style={{ color }}>
          {local.toFixed(0)}<span>°C</span>
        </div>
      </div>

      {/* Slider */}
      <div className={styles.sliderRow}>
        <span className={styles.sliderLim}>4°</span>
        <input
          type="range" min={4} max={120} step={1}
          value={local}
          onChange={handleSlider}
          className={styles.slider}
          style={{ '--pct': `${((local-4)/116)*100}%`, '--col': color }}
        />
        <span className={styles.sliderLim}>120°</span>
        <button
          className={styles.applyBtn}
          onClick={handleApply}
          disabled={saving}
          data-status={status}
        >
          {saving ? '…' : status === 'ok' ? '✓' : status === 'error' ? '✗' : 'SET'}
        </button>
      </div>

      {/* Live properties from broadcast */}
      <div className={styles.props}>
        <PropRow label="Density"    value={pipeData?.density_kg_m3}          unit="kg/m³" />
        <PropRow label="Viscosity"  value={pipeData?.viscosity_cP}            unit="cP" />
        <PropRow label="Friction f" value={pipeData?.friction_factor}         unit="" />
        <PropRow label="ΔP / km"    value={pipeData?.pressure_drop_kPa_km}    unit="kPa/km" />
        <PropRow label="Flow"       value={pipeData?.flow_m3s}                unit="m³/s" />
      </div>
    </div>
  )
}

export default function TemperatureControl({ latestSnap, onPipePropsChange }) {
  const pipes = latestSnap?.pipes ?? {}

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <span className="syne">PIPE TEMPERATURE</span>
        <span className={styles.sub}>
          Adjust per-segment temperature · recalculates ρ, μ, f, ΔP via crude oil correlations
        </span>
      </div>
      <div className={styles.grid}>
        {Object.keys(PIPE_META).map(name => (
          <PipeCard
            key={name}
            name={name}
            pipeData={pipes[name]}
            onTemperatureChange={onPipePropsChange ?? (() => {})}
          />
        ))}
      </div>
      <div className={styles.footer}>
        Valid range 4–146°C · Beggs-Robinson viscosity · Colebrook-White friction · TAPS API 33.4 crude
      </div>
    </div>
  )
}