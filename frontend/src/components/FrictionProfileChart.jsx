/**
 * FrictionProfileChart.jsx
 *
 * Reads friction_profile directly from the backend broadcast:
 *   latestSnap.friction_profile → [{km, f_thermal, f_effective}]
 *
 * Backend computes:
 *   f_thermal  = Colebrook-White friction from temperature alone
 *   f_effective = f_thermal × (1 − DR)   where DR comes from DRA engine
 *
 * No frontend back-computation — values come straight from simulation.
 *
 * Chart starts at km=0 and shows:
 *   - Blue solid    : f_effective (what MOC actually uses)
 *   - Grey dashed   : f_thermal   (baseline without DRA)
 *   - Vertical blue markers at active injection stations
 *   - Sharp steps at injection stations where DRA reduces f_effective
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Label,
} from 'recharts'
import styles from './Chart.module.css'

const INJECT_KM     = { PS1: 0, PS3: 132, PS4: 196, PS9: 676 }
const INJECT_COLORS = { PS1: '#2b7fc4', PS3: '#d4870a', PS4: '#7c4dbd', PS9: '#d95f20' }

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null
  const fEff = payload.find(p => p.dataKey === 'f_effective')?.value
  const fTh  = payload.find(p => p.dataKey === 'f_thermal')?.value
  const drPct = (fEff != null && fTh != null && fTh > 0)
    ? ((1 - fEff / fTh) * 100).toFixed(1)
    : null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTime}>{Number(label).toFixed(0)} km</div>
      {payload.map(p => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color }} />
          <span className={styles.tooltipLabel}>{p.name}</span>
          <span className={`${styles.tooltipVal} mono`}>{Number(p.value).toFixed(7)}</span>
        </div>
      ))}
      {drPct !== null && Number(drPct) > 0 && (
        <div className={styles.tooltipRow} style={{ opacity: 0.75, marginTop: 4 }}>
          <span className={styles.tooltipLabel}>DRA reduction</span>
          <span className={`${styles.tooltipVal} mono`}>{drPct}%</span>
        </div>
      )}
    </div>
  )
}

export default function FrictionProfileChart({ latestSnap }) {
  // Read directly from backend — no computation here
  const frictionProfile = latestSnap?.friction_profile ?? []
  const injectors       = latestSnap?.dra_states?.injectors ?? {}
  const anyDRA          = latestSnap?.dra_states?.any_active ?? false

  const fValues = frictionProfile.flatMap(d => [d.f_effective, d.f_thermal]).filter(Boolean)
  const fMin = fValues.length ? +(Math.min(...fValues) * 0.97).toFixed(6) : 0.008
  const fMax = fValues.length ? +(Math.max(...fValues) * 1.03).toFixed(6) : 0.025

  const activeInj = Object.entries(injectors)
    .filter(([, d]) => d?.on && (d?.conc_ppm ?? 0) > 0)

  // How much is DRA reducing friction at most?
  let maxReduction = 0
  frictionProfile.forEach(d => {
    if (d.f_thermal > 0) {
      const r = (1 - d.f_effective / d.f_thermal) * 100
      if (r > maxReduction) maxReduction = r
    }
  })

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <div>
          <h3 className={`syne ${styles.title}`}>FRICTION FACTOR PROFILE</h3>
          <p className={styles.sub}>
            Darcy friction factor vs distance ·
            blue = f_effective (with DRA) · grey = f_thermal only
          </p>
        </div>
        <div className={styles.chips}>
          <span className={styles.chip}
            style={{ '--chip-color': '#2b7fc4' }} data-active="true">
            <span className={styles.chipDot} />f_effective (with DRA)
          </span>
          <span className={styles.chip}
            style={{ '--chip-color': '#c8cdd6' }} data-active="true">
            <span className={styles.chipDot} />f_thermal only
          </span>
        </div>
      </div>

      <div className={styles.chartArea}>
        {frictionProfile.length === 0 ? (
          <div className={styles.empty}>Waiting for data…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={frictionProfile}
              margin={{ top: 10, right: 20, bottom: 24, left: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3" stroke="#e0e3e8" vertical={false}
              />

              {/* Active DRA injection markers */}
              {activeInj.map(([sid]) => (
                <ReferenceLine key={sid}
                  x={INJECT_KM[sid]}
                  stroke={INJECT_COLORS[sid] ?? '#2b7fc4'}
                  strokeWidth={1.5} strokeDasharray="4 3">
                  <Label
                    value={`${sid} +DRA`} position="top"
                    fill={INJECT_COLORS[sid] ?? '#2b7fc4'}
                    fontSize={9} fontFamily="DM Mono"
                  />
                </ReferenceLine>
              ))}

              <XAxis
                dataKey="km"
                type="number"
                domain={[0, 1288]}
                ticks={[0, 132, 196, 274, 474, 676, 976, 1288]}
                tick={{ fill: '#8a93a6', fontSize: 10, fontFamily: 'DM Mono' }}
                tickLine={false}
                axisLine={{ stroke: '#e0e3e8' }}
              >
                <Label
                  value="Distance from PS1 (km)"
                  offset={-8} position="insideBottom"
                  fill="#8a93a6" fontSize={10} fontFamily="DM Mono"
                />
              </XAxis>

              <YAxis
                domain={[fMin, fMax]}
                width={60}
                tick={{ fill: '#8a93a6', fontSize: 10, fontFamily: 'DM Mono' }}
                tickLine={false} axisLine={false}
                tickFormatter={v => v.toFixed(5)}
              />

              <Tooltip content={<CustomTooltip />} />

              {/* Thermal baseline — grey dashed */}
              <Line
                type="linear"
                dataKey="f_thermal"
                name="f_thermal"
                stroke="#c8cdd6"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                activeDot={{ r: 3, fill: '#c8cdd6', strokeWidth: 0 }}
                isAnimationActive={false}
              />

              {/* Effective friction with DRA — blue solid */}
              <Line
                type="linear"
                dataKey="f_effective"
                name="f_effective"
                stroke="#2b7fc4"
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 5, fill: '#2b7fc4', strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.liveDot} />
        <span className={styles.liveText}>
          LIVE ·{' '}
          {anyDRA && maxReduction > 0.01
            ? `DRA reducing friction by up to ${maxReduction.toFixed(1)}% · blue below grey = DRA effect`
            : 'No DRA active — both lines overlap · add DRA via Controls → DRA Injection'}
        </span>
      </div>
    </div>
  )
}