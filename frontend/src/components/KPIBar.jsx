import { Activity, Gauge, TrendingUp, Droplets, AlertTriangle, Clock } from 'lucide-react'
import styles from './KPIBar.module.css'

function formatTime(seconds) {
  if (!seconds) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function KPICard({ icon: Icon, label, value, unit, accent, dimmed }) {
  return (
    <div className={styles.card} data-accent={accent}>
      <div className={styles.iconWrap} data-accent={accent}>
        <Icon size={16} />
      </div>
      <div className={styles.body}>
        <span className={styles.label}>{label}</span>
        <div className={styles.valueRow}>
          <span className={`${styles.value} mono`} data-dimmed={dimmed}>
            {value}
          </span>
          <span className={styles.unit}>{unit}</span>
        </div>
      </div>
    </div>
  )
}

export default function KPIBar({ kpis, alarmCount }) {
  if (!kpis) {
    return (
      <div className={styles.bar}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`${styles.card} ${styles.skeleton}`} />
        ))}
      </div>
    )
  }

  return (
    <div className={styles.bar}>
      <KPICard icon={TrendingUp}    label="MIN PRESSURE"  value={kpis.minP}    unit="bar"  accent="teal" />
      <KPICard icon={Gauge}         label="AVG PRESSURE"  value={kpis.avgP}    unit="bar"  accent="blue" />
      <KPICard icon={Activity}      label="MAX PRESSURE"  value={kpis.maxP}    unit="bar"  accent="teal" />
      <KPICard icon={Droplets}      label="AVG FLOW"      value={kpis.avgFlow} unit="kg/s" accent="amber" />
      <KPICard
        icon={kpis.leakAlarm || alarmCount > 0 ? AlertTriangle : Clock}
        label={kpis.leakAlarm ? 'LEAK ALARM' : alarmCount > 0 ? 'ALARMS' : 'LEAK CONF.'}
        value={kpis.leakAlarm ? `${kpis.leakConfidence}%` : alarmCount > 0 ? alarmCount : `${kpis.leakConfidence}%`}
        unit={kpis.leakAlarm ? 'suspected' : alarmCount > 0 ? 'active' : ''}
        accent={kpis.leakAlarm || alarmCount > 0 ? 'coral' : 'muted'}
      />
    </div>
  )
}
