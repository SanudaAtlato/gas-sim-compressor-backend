import styles from './PumpControl.module.css'

const PUMP_META = {
  PS1: { km: 0,   label: 'PUMP STATION 1', sub: 'Inlet booster — 30 bar' },
  PS3: { km: 132, label: 'PUMP STATION 3', sub: 'Booster — 3 bar' },
  PS4: { km: 196, label: 'PUMP STATION 4', sub: 'Booster — 1.4 bar' },
  PS9: { km: 676, label: 'PUMP STATION 9', sub: 'Pre-delivery — 10.8 bar' },
}

function PumpCard({ name, state, onStart, onStop }) {
  const on       = state?.on       ?? false
  const alpha    = state?.alpha    ?? 0
  const rampPct  = state?.ramp_pct ?? 0
  const atSpeed  = state?.at_speed ?? false
  const meta     = PUMP_META[name]

  const statusLabel = on ? (atSpeed ? 'RUNNING' : 'RAMPING') : 'OFFLINE'

  return (
    <div className={styles.card} data-on={on}>
      <div className={styles.accent} data-on={on} />

      {/* Top row */}
      <div className={styles.top}>
        <div className={styles.nameBlock}>
          <div className={`syne ${styles.psName}`}>{name}</div>
          <div className={styles.metaLabel}>{meta.label}</div>
          <div className={`mono ${styles.metaSub}`}>{meta.km} km · {meta.sub}</div>
        </div>
        <div className={styles.badge} data-on={on}>
          <span className={styles.badgeDot} data-on={on} />
          {statusLabel}
        </div>
      </div>

      {/* Speed ramp bar */}
      <div className={styles.rampRow}>
        <span className={styles.rampLabel}>Speed</span>
        <div className={styles.rampTrack}>
          <div className={styles.rampFill} data-on={on} style={{ width: `${rampPct}%` }} />
        </div>
        <span className={`mono ${styles.rampVal}`}>{Math.round(rampPct)}%</span>
      </div>

      {/* Alpha readout */}
      <div className={styles.alphaRow}>
        <span className={styles.alphaLabel}>α (ramp factor)</span>
        <span className={`mono ${styles.alphaVal}`}>{alpha.toFixed(4)}</span>
      </div>

      {/* ── Buttons ────────────────────────────────────────────── */}
      <div className={styles.btnRow}>
        <button
          className={styles.btnStart}
          onClick={() => onStart(name)}
          disabled={on}
          type="button"
        >
          ▶&nbsp;START
        </button>
        <button
          className={styles.btnStop}
          onClick={() => onStop(name)}
          disabled={!on}
          type="button"
        >
          ■&nbsp;TRIP
        </button>
      </div>

      {/* Ramp hint */}
      {on && !atSpeed && (
        <div className={styles.hint}>Ramping — pressure wave propagating…</div>
      )}
    </div>
  )
}

export default function PumpControl({ pumpStates, onStart, onStop }) {
  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <span className="syne">PUMP CONTROL</span>
        <span className={styles.sub}>
          START ramps up over 5 min · TRIP = instant emergency stop (triggers transient)
        </span>
      </div>
      <div className={styles.grid}>
        {Object.keys(PUMP_META).map(name => (
          <PumpCard
            key={name}
            name={name}
            state={pumpStates[name]}
            onStart={onStart}
            onStop={onStop}
          />
        ))}
      </div>
    </div>
  )
}