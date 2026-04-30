/**
 * TemperatureProfileChart.jsx
 * Temperature vs pipeline distance chart.
 * X axis: km from PS1 (0–1288 km)
 * Y axis: temperature (°C)
 * Shows pipe cooling, heater jumps, and ambient reference line.
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Label,
} from 'recharts'
import styles from './Chart.module.css'

const HEATER_KM   = { HS1: 474, HS2: 976 }
const HEATER_COLOR = '#f97316'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const pt = payload[0]
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTime}>{label} km</div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipDot} style={{ background: pt.color }} />
        <span className={styles.tooltipLabel}>{pt.payload.node ?? 'pipe'}</span>
        <span className={`${styles.tooltipVal} mono`}>{pt.value?.toFixed(1)} °C</span>
      </div>
    </div>
  )
}

export default function TemperatureProfileChart({ latestSnap }) {
  const profile     = latestSnap?.temperature_profile ?? []
  const ambientC    = latestSnap?.ambient_temp_c ?? -5
  const heaterStates= latestSnap?.heater_states  ?? {}

  // Build chart data — two points at same km for heater jumps
  const data = profile.map(pt => ({
    km:     pt.km,
    temp:   pt.temp_c,
    node:   pt.node,
  }))

  const minT = Math.min(ambientC - 5, ...data.map(d => d.temp)) - 2
  const maxT = Math.max(...data.map(d => d.temp)) + 5

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <div>
          <h3 className={`syne ${styles.title}`}>TEMPERATURE PROFILE</h3>
          <p className={styles.sub}>
            Oil temperature vs distance from PS1 · exponential cooling · heater jumps at HS1 &amp; HS2
          </p>
        </div>
        <div className={styles.chips}>
          <span className={styles.chip} style={{ '--chip-color': '#2b7fc4' }} data-active="true">
            <span className={styles.chipDot} /> Oil temperature
          </span>
          <span className={styles.chip} style={{ '--chip-color': '#8a93a6' }} data-active="true">
            <span className={styles.chipDot} /> Ambient
          </span>
          <span className={styles.chip} style={{ '--chip-color': HEATER_COLOR }} data-active="true">
            <span className={styles.chipDot} /> Heater stations
          </span>
        </div>
      </div>

      <div className={styles.chartArea} style={{ height: 260 }}>
        {data.length === 0 ? (
          <div className={styles.empty}>Waiting for data…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 24, bottom: 20, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e8" vertical={false} />

              {/* Heater shaded zones */}
              {Object.entries(HEATER_KM).map(([hid, km]) => (
                <ReferenceArea key={hid} x1={km-8} x2={km+8}
                  fill={HEATER_COLOR} fillOpacity={0.08} stroke={HEATER_COLOR}
                  strokeOpacity={0.3} strokeWidth={1} />
              ))}

              <XAxis dataKey="km"
                type="number" domain={[0, 1288]}
                tick={{ fill: '#8a93a6', fontSize: 10, fontFamily: 'DM Mono' }}
                tickLine={false} axisLine={{ stroke: '#e0e3e8' }}
                tickFormatter={v => `${v}`}
                ticks={[0, 132, 196, 274, 474, 676, 976, 1288]}
              >
                <Label value="Distance from PS1 (km)" offset={-8}
                  position="insideBottom" fill="#8a93a6" fontSize={10} fontFamily="DM Mono" />
              </XAxis>

              <YAxis
                domain={[minT, maxT]}
                tick={{ fill: '#8a93a6', fontSize: 10, fontFamily: 'DM Mono' }}
                tickLine={false} axisLine={false}
                tickFormatter={v => `${v.toFixed(0)}°`}
                width={38}
              />

              <Tooltip content={<CustomTooltip />} />

              {/* Ambient temperature reference */}
              <ReferenceLine y={ambientC} stroke="#8a93a6" strokeDasharray="5 3" strokeWidth={1.2}>
                <Label value={`Ambient ${ambientC}°C`} position="insideTopRight"
                  fill="#8a93a6" fontSize={9} fontFamily="DM Mono" />
              </ReferenceLine>

              {/* Heater station vertical markers */}
              {Object.entries(HEATER_KM).map(([hid, km]) => (
                <ReferenceLine key={hid} x={km}
                  stroke={HEATER_COLOR} strokeWidth={1.5} strokeDasharray="4 3">
                  <Label value={hid} position="top"
                    fill={HEATER_COLOR} fontSize={9} fontFamily="DM Mono" />
                </ReferenceLine>
              ))}

              {/* Temperature profile line */}
              <Line type="monotone" dataKey="temp"
                stroke="#2b7fc4" strokeWidth={2} dot={false}
                activeDot={{ r: 5, fill: '#2b7fc4', strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Heater status strip */}
      <div className={styles.footer} style={{ gap: 16 }}>
        {Object.entries(heaterStates).map(([hid, hs]) => (
          <span key={hid} style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span style={{
              width:8, height:8, borderRadius:'50%',
              background: hs.on ? HEATER_COLOR : '#c8cdd6',
              display:'inline-block', flexShrink:0,
            }} />
            <span className="mono" style={{ fontSize:10, color:'#454c5c' }}>
              {hid}: {hs.on ? `${hs.target_c}°C target · ${hs.actual_mw ?? 0} MW` : 'OFF'}
            </span>
          </span>
        ))}
        <span className={styles.liveDot} style={{ marginLeft:'auto' }} />
        <span className={styles.liveText}>LIVE · {data.length} data points</span>
      </div>
    </div>
  )
}