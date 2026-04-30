import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { P_MIN, P_MAX } from '../hooks/useSimulation'
import styles from './Chart.module.css'

const NODE_COLORS_CSS = {
  PS1:  '#00c9a7',
  PS3:  '#f5a623',
  PS4:  '#4d9de0',
  PS5:  '#c084fc',
  HS1:  '#00a896',
  PS9:  '#fb923c',
  HS2:  '#ef4444',
  Sink: '#f87171',
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTime}>{label}s simulated</div>
      {payload.map(p => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color }} />
          <span className={styles.tooltipLabel}>{p.dataKey}</span>
          <span className={`${styles.tooltipVal} mono`}>{p.value?.toFixed(3)} bar</span>
        </div>
      ))}
      <div className={styles.tooltipHr} />
      <div className={`${styles.tooltipRow} ${styles.tooltipMuted}`}>
        <span>Min threshold</span>
        <span className="mono">{P_MIN} bar</span>
      </div>
      <div className={`${styles.tooltipRow} ${styles.tooltipMuted}`}>
        <span>Max limit</span>
        <span className="mono">{P_MAX} bar</span>
      </div>
    </div>
  )
}

export default function PressureChart({ history, selectedNodes, onToggleNode, nodeNames }) {
  const activeNodes = selectedNodes.length > 0 ? selectedNodes : nodeNames
  const leakEvent = history.find(p => p.leakActive)

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <div>
          <h3 className={`syne ${styles.title}`}>PRESSURE VS TIME</h3>
          <p className={styles.sub}>
            Gauge pressure at key nodes · dashed lines = 50 / 80 bar limits
          </p>
        </div>
        <div className={styles.chips}>
          {nodeNames.map(name => (
            <button
              key={name}
              className={styles.chip}
              data-active={selectedNodes.includes(name) || selectedNodes.length === 0}
              onClick={() => onToggleNode(name)}
              style={{ '--chip-color': NODE_COLORS_CSS[name] }}
            >
              <span className={styles.chipDot} />
              {name}
            </button>
          ))}
          {selectedNodes.length > 0 && (
            <button className={styles.clearBtn}
              onClick={() => selectedNodes.forEach(onToggleNode)}>
              All
            </button>
          )}
        </div>
      </div>

      <div className={styles.chartArea}>
        {history.length === 0 ? (
          <div className={styles.empty}>Waiting for data…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
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
                width={42}
                domain={['auto', 'auto']}
                label={{
                  value: 'bar', angle: -90, position: 'insideLeft',
                  fill: '#435570', fontSize: 10, fontFamily: 'DM Mono',
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

              {/* 50 bar minimum threshold */}
              <ReferenceLine
                y={P_MIN}
                stroke="#ff5757"
                strokeDasharray="6 4"
                strokeWidth={1.2}
                label={{ value: `${P_MIN} bar min`, position: 'insideBottomRight',
                         fill: '#ff5757', fontSize: 9, fontFamily: 'DM Mono' }}
              />

              {/* 80 bar maximum threshold */}
              <ReferenceLine
                y={P_MAX}
                stroke="#f5a623"
                strokeDasharray="6 4"
                strokeWidth={1.2}
                label={{ value: `${P_MAX} bar max`, position: 'insideTopRight',
                         fill: '#f5a623', fontSize: 9, fontFamily: 'DM Mono' }}
              />

              {activeNodes.map(name => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={NODE_COLORS_CSS[name]}
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.liveDot} />
        <span className={styles.liveText}>
          LIVE · {history.length} points · {activeNodes.length} nodes
        </span>
      </div>
    </div>
  )
}
