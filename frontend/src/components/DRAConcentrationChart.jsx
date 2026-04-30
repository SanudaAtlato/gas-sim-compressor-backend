/**
 * DRAConcentrationChart.jsx
 *
 * Uses the full sequential profile from the backend:
 *   latestSnap.dra_states.full_profile  →  [{km, conc_ppm, dr_percent, event}]
 *
 * The backend computes many points along the pipeline including:
 *   - Sharp spike (vertical jump) at each injection station
 *   - 15% step-down at each pump station (mechanical degradation)
 *   - Smooth exponential decay between stations
 *
 * Chart uses type="linear" so no false smooth interpolation between points.
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Label,
} from 'recharts'
import styles from './Chart.module.css'

const INJECTION_KM    = { PS1: 0, PS3: 132, PS4: 196, PS9: 676 }
const INJECT_COLORS   = { PS1: '#2b7fc4', PS3: '#d4870a', PS4: '#7c4dbd', PS9: '#d95f20' }
const PUMP_KM         = [0, 132, 196, 676]

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTime}>{Number(label).toFixed(0)} km</div>
      {payload.map(p => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color }} />
          <span className={styles.tooltipLabel}>{p.name}</span>
          <span className={`${styles.tooltipVal} mono`}>
            {Number(p.value).toFixed(1)}
            {p.dataKey === 'conc_ppm' ? ' ppm' : ' %'}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function DRAConcentrationChart({ latestSnap }) {
  const fullProfile = latestSnap?.dra_states?.full_profile ?? null
  const injectors   = latestSnap?.dra_states?.injectors    ?? {}
  const anyActive   = latestSnap?.dra_states?.any_active   ?? false

  // Use the full profile directly from backend — no frontend recalculation
  const data = fullProfile ?? []

  const maxConc = data.length > 0
    ? Math.max(10, ...data.map(d => d.conc_ppm ?? 0))
    : 10
  const yTop = Math.ceil(maxConc * 1.15 / 10) * 10

  const activeInj = Object.entries(injectors)
    .filter(([, d]) => d?.on && (d?.conc_ppm ?? 0) > 0)

  const noData = !anyActive && data.every(d => (d.conc_ppm ?? 0) === 0)

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <div>
          <h3 className={`syne ${styles.title}`}>DRA CONCENTRATION PROFILE</h3>
          <p className={styles.sub}>
            Active polymer concentration (ppm) vs distance ·
            15% pump degradation · PAA · kd = 0.004 km⁻¹
          </p>
        </div>
        <div className={styles.chips}>
          {activeInj.length === 0
            ? <span className={styles.chip} data-active="false">
                <span className={styles.chipDot} />No DRA active
              </span>
            : activeInj.map(([sid, d]) => (
                <span key={sid} className={styles.chip}
                  style={{ '--chip-color': INJECT_COLORS[sid] ?? '#888' }}
                  data-active="true">
                  <span className={styles.chipDot} />
                  {sid}: {d.conc_ppm} ppm
                </span>
              ))
          }
        </div>
      </div>

      <div className={styles.chartArea}>
        {noData ? (
          <div className={styles.empty}>
            No DRA injected — open Controls → DRA Injection to add polymer
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 12, right: 20, bottom: 24, left: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3" stroke="#e0e3e8" vertical={false}
              />

              {/* Pump station markers — show where 15% degradation occurs */}
              {PUMP_KM.map(km => (
                <ReferenceLine key={km} x={km}
                  stroke="#c8cdd6" strokeWidth={1} strokeDasharray="3 3" />
              ))}

              {/* Injection station markers */}
              {activeInj.map(([sid]) => (
                <ReferenceLine key={sid}
                  x={INJECTION_KM[sid]}
                  stroke={INJECT_COLORS[sid] ?? '#888'}
                  strokeWidth={1.5} strokeDasharray="4 3">
                  <Label
                    value={`${sid} +DRA`} position="top"
                    fill={INJECT_COLORS[sid] ?? '#888'}
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
                  value="Distance from PS1 (km)" offset={-8}
                  position="insideBottom"
                  fill="#8a93a6" fontSize={10} fontFamily="DM Mono"
                />
              </XAxis>

              <YAxis
                domain={[0, yTop]}
                width={46}
                tick={{ fill: '#8a93a6', fontSize: 10, fontFamily: 'DM Mono' }}
                tickLine={false}
                axisLine={false}
                label={{
                  value: 'ppm', angle: -90, position: 'insideLeft',
                  fill: '#8a93a6', fontSize: 10, fontFamily: 'DM Mono',
                }}
              />

              <Tooltip content={<CustomTooltip />} />

              {/* Concentration — linear interpolation, no false curves */}
              <Line
                type="linear"
                dataKey="conc_ppm"
                name="C_active (ppm)"
                stroke="#2b7fc4"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: '#2b7fc4', strokeWidth: 0 }}
                isAnimationActive={false}
                connectNulls={false}
              />

              {/* DR% overlaid — scaled to same axis */}
              <Line
                type="linear"
                dataKey="dr_percent"
                name="DR %"
                stroke="#d4870a"
                strokeWidth={1.2}
                strokeDasharray="5 3"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.liveDot} />
        <span className={styles.liveText}>
          LIVE · blue = C_active (ppm) · amber dashed = DR % ·
          grey verticals = pump stations (−15% each) ·
          coloured verticals = injection points
        </span>
      </div>
    </div>
  )
}