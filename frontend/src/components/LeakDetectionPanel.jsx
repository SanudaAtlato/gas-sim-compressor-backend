import { AlertTriangle, CheckCircle2, MapPin, RadioTower, ShieldAlert, Waves } from 'lucide-react'
import styles from './LeakDetectionPanel.module.css'

function fmt(value, digits = 2, fallback = '—') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return fallback
  return Number(value).toFixed(digits)
}

function MethodChip({ label, active, danger }) {
  return (
    <div className={styles.chip} data-active={active} data-danger={danger}>
      {active ? <CheckCircle2 size={13}/> : <span className={styles.dot}/>}
      <span>{label}</span>
    </div>
  )
}

export default function LeakDetectionPanel({ latestSnap }) {
  const d = latestSnap?.leak_detection
  if (!d) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>Waiting for leak detection data…</div>
      </div>
    )
  }

  const status = d.alarm ? 'alarm' : d.operation_masked ? 'masked' : d.confidence > 0 ? 'warning' : 'normal'
  const methods = d.method_status || {}
  const sensors = d.sensor_table || []
  const injected = Object.values(latestSnap?.active_leaks ?? {})
    .filter(leak => leak && typeof leak === 'object' && leak.type === 'manual_location')
    .map(leak => `${Number(leak.location_km).toFixed(1)} km (${leak.pipe_name}, ${leak.flow_kg_s} kg/s)`)
  const range = d.estimated_location_range_km
    ? `${fmt(d.estimated_location_range_km[0], 1)}–${fmt(d.estimated_location_range_km[1], 1)} km`
    : '—'

  return (
    <div className={styles.panel}>
      <section className={styles.hero} data-status={status}>
        <div className={styles.heroLeft}>
          <div className={styles.iconWrap}>
            {d.alarm ? <ShieldAlert size={24}/> : <Waves size={24}/>}
          </div>
          <div>
            <h2>{d.alarm ? 'Leak Suspected' : d.event_type || 'Normal'}</h2>
            <p>{d.explanation || 'EWMA, CUSUM, pressure-wave and flow-balance checks are running.'}</p>
          </div>
        </div>

        <div className={styles.confidenceBox}>
          <span className={styles.confLabel}>CONFIDENCE</span>
          <span className={`${styles.confValue} mono`}>{d.confidence ?? 0}%</span>
          <div className={styles.confTrack}>
            <div className={styles.confFill} style={{ width: `${Math.max(0, Math.min(100, d.confidence || 0))}%` }} />
          </div>
        </div>
      </section>

      <div className={styles.cards}>
        <div className={styles.card}>
          <RadioTower size={18}/>
          <span className={styles.label}>Wave Detected</span>
          <strong>{d.wave_detected ? 'Yes' : 'No'}</strong>
        </div>
        <div className={styles.card}>
          <MapPin size={18}/>
          <span className={styles.label}>Estimated Location</span>
          <strong>{d.estimated_location_km !== null && d.estimated_location_km !== undefined ? `${fmt(d.estimated_location_km, 2)} km` : '—'}</strong>
          <small>Range: {range}</small>
        </div>
        <div className={styles.card}>
          <AlertTriangle size={18}/>
          <span className={styles.label}>Nearest Segment</span>
          <strong>{d.nearest_segment || '—'}</strong>
        </div>
        <div className={styles.card}>
          <Waves size={18}/>
          <span className={styles.label}>Flow Imbalance</span>
          <strong>{fmt(d.flow_imbalance_kg_s, 1)} kg/s</strong>
        </div>
      </div>

      <div className={styles.methods}>
        <MethodChip label="Negative pressure wave" active={methods.negative_pressure_wave}/>
        <MethodChip label="EWMA trend" active={methods.ewma_trend}/>
        <MethodChip label="CUSUM alarm" active={methods.cusum} danger={methods.cusum}/>
        <MethodChip label="Flow balance" active={methods.flow_balance}/>
        <MethodChip label="Operation mask" active={methods.operation_mask} danger={methods.operation_mask}/>
      </div>

      <div className={styles.metrics}>
        <div>
          <span>Minimum EWMA residual</span>
          <strong className="mono">{fmt(d.min_ewma_residual_bar, 3)} bar</strong>
        </div>
        <div>
          <span>Maximum CUSUM score</span>
          <strong className="mono">{fmt(d.max_cusum, 3)}</strong>
        </div>
        <div>
          <span>Estimated range</span>
          <strong className="mono">{range}</strong>
        </div>
        <div>
          <span>Location uncertainty</span>
          <strong className="mono">{d.location_uncertainty_km !== null && d.location_uncertainty_km !== undefined ? `±${fmt(d.location_uncertainty_km, 1)} km` : '—'}</strong>
        </div>
        <div>
          <span>Triggered sensors</span>
          <strong className="mono">{(d.triggered_sensors || []).join(', ') || '—'}</strong>
        </div>
        <div>
          <span>Injected leak position</span>
          <strong className="mono">{injected.join(' | ') || '—'}</strong>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Sensor</th>
              <th>km</th>
              <th>Pressure</th>
              <th>Baseline</th>
              <th>Residual</th>
              <th>EWMA</th>
              <th>CUSUM</th>
              <th>Wave arrival</th>
            </tr>
          </thead>
          <tbody>
            {sensors.map(row => (
              <tr key={row.sensor} data-triggered={row.arrival_time_s !== null && row.arrival_time_s !== undefined}>
                <td>{row.sensor}</td>
                <td>{fmt(row.km, 1)}</td>
                <td>{fmt(row.pressure_bar, 3)} bar</td>
                <td>{fmt(row.baseline_bar, 3)} bar</td>
                <td>{fmt(row.residual_bar, 3)} bar</td>
                <td>{fmt(row.ewma_bar, 3)} bar</td>
                <td>{fmt(row.cusum, 3)}</td>
                <td>{row.arrival_time_s !== null && row.arrival_time_s !== undefined ? `${fmt(row.arrival_time_s, 1)} s` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
