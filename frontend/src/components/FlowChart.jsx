import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import styles from './Chart.module.css'

const PIPE_COLORS_CSS = {
  PS1_PS3:  '#00c9a7',
  PS3_PS4:  '#f5a623',
  PS4_PS5:  '#4d9de0',
  PS5_HS1:  '#c084fc',
  HS1_PS9:  '#00a896',
  PS9_HS2:  '#fb923c',
  'HS2_Sink':'#0f766e',
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTime}>{label}s sim</div>
      {payload.map(p => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color }} />
          <span className={styles.tooltipLabel}>{p.dataKey}</span>
          <span className={`${styles.tooltipVal} mono`}>{p.value?.toFixed(4)} m³/s</span>
        </div>
      ))}
    </div>
  )
}

export default function FlowChart({ history, selectedPipes, onTogglePipe, pipeNames }) {
  const activePipes = selectedPipes.length > 0 ? selectedPipes : pipeNames
  const leakEvent = history.find(p => p.leakActive)

  return (
    <div className={`card ${styles.wrap}`}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h3 className={`syne ${styles.title}`}>FLOW RATE VS TIME</h3>
          <p className={styles.sub}>Volumetric flow at each segment inlet (m³/s)</p>
        </div>
        {/* Pipe chips */}
        <div className={styles.chips}>
          {pipeNames.map(name => (
            <button
              key={name}
              className={styles.chip}
              data-active={selectedPipes.includes(name) || selectedPipes.length === 0}
              onClick={() => onTogglePipe(name)}
              style={{ '--chip-color': PIPE_COLORS_CSS[name] }}
            >
              <span className={styles.chipDot} />
              {name.replace('_', '→')}
            </button>
          ))}
          {selectedPipes.length > 0 && (
            <button className={styles.clearBtn} onClick={() => selectedPipes.forEach(onTogglePipe)}>
              All
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className={styles.chartArea}>
        {history.length === 0 ? (
          <div className={styles.empty}>Waiting for data…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
              <defs>
                {activePipes.map(name => (
                  <linearGradient key={name} id={`grad_${name}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={PIPE_COLORS_CSS[name]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={PIPE_COLORS_CSS[name]} stopOpacity={0}    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d44" vertical={false} />
              <XAxis
                dataKey="t"
                tick={{ fill: '#435570', fontSize: 10, fontFamily: 'DM Mono' }}
                tickLine={false}
                axisLine={{ stroke: '#1e2d44' }}
                tickFormatter={v => `${v}s`}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#435570', fontSize: 10, fontFamily: 'DM Mono' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => v.toFixed(2)}
                width={46}
                label={{
                  value: 'm³/s',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#435570',
                  fontSize: 10,
                  fontFamily: 'DM Mono',
                }}
              />
              <Tooltip content={<CustomTooltip />} />

              {leakEvent && (
                <ReferenceLine
                  x={leakEvent.t}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeWidth={1.4}
                  label={{ value: "Leak injected", position: "insideTop", fill: "#ef4444", fontSize: 10, fontFamily: "DM Mono" }}
                />
              )}
              {activePipes.map(name => (
                <Area
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={PIPE_COLORS_CSS[name]}
                  strokeWidth={1.8}
                  fill={`url(#grad_${name})`}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <span className={styles.liveDot} />
        <span className={styles.liveText}>LIVE · {history.length} points · {activePipes.length} segments</span>
      </div>
    </div>
  )
}
