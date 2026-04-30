import { Flame } from 'lucide-react'
import styles from './NetworkMap.module.css'

const NODES = [
  { id:'PS1',  label:'PS1',  type:'pump',    km:0,    pipeOut:'PS1_PS3'  },
  { id:'PS3',  label:'PS3',  type:'pump',    km:132,  pipeOut:'PS3_PS4'  },
  { id:'PS4',  label:'PS4',  type:'pump',    km:196,  pipeOut:'PS4_PS5'  },
  { id:'PS5',  label:'PS5',  type:'relief',  km:274,  pipeOut:'PS5_HS1'  },
  { id:'HS1',  label:'HS1',  type:'heater',  km:474,  pipeOut:'HS1_PS9'  },
  { id:'PS9',  label:'PS9',  type:'pump',    km:676,  pipeOut:'PS9_HS2'  },
  { id:'HS2',  label:'HS2',  type:'heater',  km:976,  pipeOut:'HS2_Sink' },
  { id:'Sink', label:'SINK', type:'sink',    km:1288, pipeOut:null       },
]

const PIPES = [
  { id:'PS1_PS3',  from:'PS1', to:'PS3',  km:132 },
  { id:'PS3_PS4',  from:'PS3', to:'PS4',  km:64  },
  { id:'PS4_PS5',  from:'PS4', to:'PS5',  km:78  },
  { id:'PS5_HS1',  from:'PS5', to:'HS1',  km:200 },
  { id:'HS1_PS9',  from:'HS1', to:'PS9',  km:202 },
  { id:'PS9_HS2',  from:'PS9', to:'HS2',  km:300 },
  { id:'HS2_Sink', from:'HS2', to:'Sink', km:312 },
]

const TOTAL_KM = 1288
const AREA_M2  = Math.PI * (1.2192/2)**2

const NODE_COLORS = {
  PS1:'#009e85', PS3:'#d4870a', PS4:'#2b7fc4', PS5:'#7c4dbd',
  HS1:'#f97316', PS9:'#d95f20', HS2:'#ef4444', Sink:'#64748b',
}

function NodePin({ node, pressure, temp, velocity, isSelected, onClick, hasLeak }) {
  const color  = NODE_COLORS[node.id] ?? '#888'
  const pBar   = pressure != null ? pressure.toFixed(2)  : '—'
  const tC     = temp     != null ? temp.toFixed(1)      : '—'
  const vMs    = velocity != null ? velocity.toFixed(3)  : '—'
  const alarm  = pressure != null && (pressure < 50 || pressure > 80)
  const isH    = node.type === 'heater'

  return (
    <div className={styles.nodeWrap} style={{ left:`${(node.km/TOTAL_KM)*100}%` }}>
      {/* Pressure/temp label above */}
      <div className={`${styles.valAbove} mono`} data-alarm={alarm}>
        {isH ? `${tC}°C` : `${pBar} bar`}
      </div>

      {/* Pin */}
      <button
        className={styles.pin}
        data-type={node.type}
        data-selected={isSelected}
        data-leak={hasLeak}
        onClick={() => onClick(node.id)}
        style={{ '--node-color': color }}
        title={`${node.label} — ${pBar} bar  ${tC}°C  ${vMs} m/s`}
      >
        {isH
          ? <Flame size={12} color={color} />
          : <span className={styles.pinInner} />
        }
        {hasLeak && <span className={styles.leakRing} />}
      </button>

      <div className={styles.nodeLabel}>{node.label}</div>

      {/* Velocity/temp label below */}
      <div className={`${styles.valBelow} mono`}>
        {isH ? `${pBar} bar` : `${tC}°C`}
      </div>
    </div>
  )
}

export default function NetworkMap({ latestSnap, selectedNodes, onToggleNode }) {
  const nodesData   = latestSnap?.nodes   ?? {}
  const pipesData   = latestSnap?.pipes   ?? {}
  const leaks       = latestSnap?.active_leaks ?? {}
  const manualLeaks = Object.entries(leaks).filter(([, leak]) => leak && typeof leak === 'object' && leak.type === 'manual_location')
  const nodeTempMap = latestSnap?.node_temperatures ?? {}

  return (
    <div className={`card ${styles.wrap}`}>
      <div className={styles.header}>
        <span className="syne">PIPELINE TOPOLOGY</span>
        <span className={styles.subtitle}>Alaska · 1,288 km · 48″ · Click node to filter charts</span>
      </div>

      <div className={styles.mapArea}>
        <div className={styles.pipeRow}>
          <div className={styles.pipeLine} />

          {/* Segment flow + km labels */}
          {PIPES.map(pipe => {
            const fromPct = (NODES.find(n=>n.id===pipe.from).km / TOTAL_KM)*100
            const toPct   = (NODES.find(n=>n.id===pipe.to).km   / TOTAL_KM)*100
            const flowVal = pipesData[pipe.id]?.flow_m3s
            const tempVal = pipesData[pipe.id]?.temperature_c
            return (
              <div key={pipe.id} className={styles.segment}
                style={{ left:`${fromPct}%`, width:`${toPct-fromPct}%` }}>
                <div className={styles.segFlow}>
                  <span className="mono">{flowVal!=null ? flowVal.toFixed(3) : '—'} m³/s</span>
                  {tempVal!=null && <span className={`mono ${styles.segTemp}`}>{tempVal.toFixed(1)}°C</span>}
                </div>
                <div className={styles.segKm}>{pipe.km} km</div>
                <div className={styles.flowParticle} />
                <div className={styles.flowParticle} style={{ animationDelay:'1.4s' }} />
              </div>
            )
          })}

          {/* Manual leak markers along the pipe */}
          {manualLeaks.map(([id, leak]) => {
            const km = Number(leak.location_km ?? leak.requested_location_km ?? 0)
            return (
              <div key={id} className={styles.manualLeakMarker}
                style={{ left:`${Math.max(0, Math.min(100, (km/TOTAL_KM)*100))}%` }}
                title={`${id} · ${km.toFixed(1)} km · ${leak.flow_kg_s} kg/s`}>
                <span />
                <label>{km.toFixed(0)} km</label>
              </div>
            )
          })}

          {/* Node pins */}
          {NODES.map(node => {
            const pressure = nodesData[node.id]?.pressure_bar ?? null
            const temp     = nodeTempMap[node.id] ?? nodesData[node.id]?.temperature_c ?? null
            const flowM3s  = node.pipeOut ? (pipesData[node.pipeOut]?.flow_m3s ?? null) : null
            const velocity = flowM3s != null ? flowM3s / AREA_M2 : null
            return (
              <NodePin key={node.id} node={node} pressure={pressure} temp={temp}
                velocity={velocity} isSelected={selectedNodes.includes(node.id)}
                onClick={onToggleNode} hasLeak={!!leaks[node.id]} />
            )
          })}
        </div>

        {/* Ruler */}
        <div className={styles.ruler}>
          {NODES.map(n => (
            <span key={n.id} className={`${styles.rulerTick} mono`}
              style={{ left:`${(n.km/TOTAL_KM)*100}%` }}>{n.km}</span>
          ))}
        </div>

        {/* Legend */}
        <div className={styles.legend}>
          <span className={styles.legendItem} data-type="pump">Pump</span>
          <span className={styles.legendItem} data-type="relief">Relief well</span>
          <span className={styles.legendItem} data-type="heater">Heating station</span>
          <span className={styles.legendItem} data-type="sink">Delivery sink</span>
          <span className={styles.legendAlarm}>⚠ Red = outside 50–80 bar</span>
        </div>
      </div>
    </div>
  )
}