import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { Droplets, LocateFixed, MapPinned, Satellite } from 'lucide-react'
import { NODES, SEGMENTS, ROUTE_COORDS, TOTAL_KM } from '../data/tapsNetwork'
import styles from './MapView.module.css'

const CRUDE = '#6b3a16'
const CRUDE_LIGHT = '#c47a2c'
const CRUDE_GLOW = '#f0b35b'
const ESTIMATE = '#ffd166'
const LEAK = '#ff4d4f'
const AREA_M2 = Math.PI * (1.2192 / 2) ** 2

const NODE_COLORS = {
  PS1:'#009e85', PS3:'#d4870a', PS4:'#2b7fc4', PS5:'#7c4dbd',
  HS1:'#f97316', PS9:'#d95f20', HS2:'#ef4444', Sink:'#64748b',
}

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function interpolateOnPolyline(coords, fraction) {
  if (!coords?.length) return null
  if (fraction <= 0) return coords[0]
  if (fraction >= 1) return coords[coords.length - 1]
  const lengths = []
  let total = 0
  for (let i = 0; i < coords.length - 1; i += 1) {
    const len = haversineKm(coords[i], coords[i + 1])
    lengths.push(len)
    total += len
  }
  const target = total * fraction
  let accum = 0
  for (let i = 0; i < lengths.length; i += 1) {
    const next = accum + lengths[i]
    if (target <= next) {
      const local = lengths[i] > 0 ? (target - accum) / lengths[i] : 0
      const [lat1, lng1] = coords[i]
      const [lat2, lng2] = coords[i + 1]
      return [lat1 + (lat2 - lat1) * local, lng1 + (lng2 - lng1) * local]
    }
    accum = next
  }
  return coords[coords.length - 1]
}

export function kmToLatLng(km) {
  const clamped = Math.max(0, Math.min(TOTAL_KM, Number(km) || 0))
  const segment = SEGMENTS.find((seg) => clamped >= seg.kmStart && clamped <= seg.kmEnd) || SEGMENTS[SEGMENTS.length - 1]
  const frac = (clamped - segment.kmStart) / Math.max(segment.kmEnd - segment.kmStart, 1e-6)
  return interpolateOnPolyline(segment.coords, frac)
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value))
}

function MapBounds() {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(ROUTE_COORDS, { padding: [24, 24] })
  }, [map])
  return null
}

function ZoomTracker({ onZoom }) {
  const map = useMapEvents({
    zoomend() { onZoom(map.getZoom()) },
  })
  useEffect(() => { onZoom(map.getZoom()) }, [map, onZoom])
  return null
}

function useAnimationSeconds() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now) => {
      // Throttle enough to stay smooth without burning the browser.
      if (now - last > 45) {
        setSeconds(now / 1000)
        last = now
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return seconds
}

function FlowParticles({ latestSnap, zoom }) {
  const wallSeconds = useAnimationSeconds()
  const pipeValues = latestSnap?.pipes ?? {}
  const flows = Object.values(pipeValues).map((p) => Math.max(0, p?.flow_m3s ?? 0))
  const avgFlow = flows.length ? flows.reduce((a, b) => a + b, 0) / flows.length : 0.85
  const zoomFactor = clamp((zoom - 5) / 7, 0, 1)
  const particleCount = zoom >= 9 ? 54 : zoom >= 7 ? 38 : 26
  const speed = clamp(0.045 + avgFlow * 0.035, 0.04, 0.11)
  const radius = clamp(3.6 + zoomFactor * 5.4, 3.6, 9.0)
  const shift = ((wallSeconds * speed) % 1 + 1) % 1

  const particles = Array.from({ length: particleCount }, (_, i) => {
    const fraction = ((i / particleCount) + shift) % 1
    const km = fraction * TOTAL_KM
    return {
      id: `flow-${i}`,
      pos: kmToLatLng(km),
      km,
      radius: i % 5 === 0 ? radius * 1.22 : radius,
      opacity: i % 5 === 0 ? 0.95 : 0.72,
    }
  })

  return particles.map((p) => (
    <CircleMarker
      key={p.id}
      center={p.pos}
      radius={p.radius}
      pathOptions={{ color: CRUDE_GLOW, fillColor: CRUDE_LIGHT, fillOpacity: p.opacity, weight: Math.max(1, zoomFactor * 2) }}
    >
      {zoom >= 10 && (
        <Tooltip direction="top" offset={[0, -4]} opacity={0.92}>
          <span className={styles.flowTip}>crude flow → south · {p.km.toFixed(0)} km</span>
        </Tooltip>
      )}
    </CircleMarker>
  ))
}

export default function MapView({ latestSnap, selectedNodes = [], onToggleNode = () => {} }) {
  const [zoom, setZoom] = useState(6)
  const nodesData = latestSnap?.nodes ?? {}
  const pipesData = latestSnap?.pipes ?? {}
  const nodeTempMap = latestSnap?.node_temperatures ?? {}
  const activeLeaks = latestSnap?.active_leaks ?? {}
  const detector = latestSnap?.leak_detection ?? {}

  const injectedLeaks = useMemo(
    () => Object.entries(activeLeaks).filter(([, leak]) => leak && typeof leak === 'object' && leak.type === 'manual_location'),
    [activeLeaks],
  )

  const estimatedKm = detector?.estimated_location_km
  const estimatedRange = detector?.estimated_location_range_km
  const estimatedPos = estimatedKm !== null && estimatedKm !== undefined ? kmToLatLng(estimatedKm) : null
  const zoomFactor = clamp((zoom - 5) / 7, 0, 1)
  const pipeWeight = clamp(7 + zoomFactor * 13, 7, 20)
  const innerWeight = clamp(3 + zoomFactor * 8, 3, 11)
  const currentFlow = Object.values(pipesData).find((p) => typeof p?.flow_m3s === 'number')?.flow_m3s ?? null

  return (
    <div className={`card ${styles.panel}`}>
      <div className={styles.header}>
        <div>
          <span className="syne">SATELLITE MAP VIEW</span>
          <div className={styles.subtitle}>Prudhoe Bay → Valdez · crude-oil visual flow · injected and estimated leak markers</div>
        </div>
        <div className={styles.headerBadges}>
          <span><Satellite size={13}/> Satellite</span>
          <span><Droplets size={13}/> crude oil color</span>
          <span><MapPinned size={13}/> zoom in to see thicker flow</span>
        </div>
      </div>

      <div className={styles.mapShell}>
        <MapContainer className={styles.map} center={ROUTE_COORDS[0]} zoom={6} minZoom={4} maxZoom={15} scrollWheelZoom>
          <MapBounds />
          <ZoomTracker onZoom={setZoom} />
          <TileLayer
            attribution='Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />

          {SEGMENTS.map((segment) => {
            const pipe = pipesData[segment.id] ?? {}
            return (
              <Polyline
                key={`${segment.id}-outer`}
                positions={segment.coords}
                pathOptions={{ color: '#1b130d', weight: pipeWeight + 5, opacity: 0.92, lineCap: 'round', lineJoin: 'round' }}
              >
                <Tooltip sticky>
                  <div className={styles.segmentTooltip}>
                    <strong>{segment.id}</strong>
                    <div>{segment.kmStart}–{segment.kmEnd} km</div>
                    <div>Flow {pipe.flow_m3s != null ? `${pipe.flow_m3s.toFixed(3)} m³/s` : '—'}</div>
                    <div>Temp {pipe.temperature_c != null ? `${pipe.temperature_c.toFixed(1)} °C` : '—'}</div>
                  </div>
                </Tooltip>
              </Polyline>
            )
          })}
          <Polyline positions={ROUTE_COORDS} pathOptions={{ color: CRUDE, weight: pipeWeight, opacity: 0.98, lineCap: 'round', lineJoin: 'round' }} />
          <Polyline positions={ROUTE_COORDS} pathOptions={{ color: CRUDE_LIGHT, weight: innerWeight, opacity: 0.75, dashArray: `${18 + zoom * 2} ${22 + zoom * 2}`, lineCap: 'round' }} />
          <FlowParticles latestSnap={latestSnap} zoom={zoom} />

          {NODES.map((node) => {
            const pressure = nodesData[node.id]?.pressure_bar ?? null
            const temp = nodeTempMap[node.id] ?? nodesData[node.id]?.temperature_c ?? null
            const flowM3s = node.pipeOut ? (pipesData[node.pipeOut]?.flow_m3s ?? null) : null
            const velocity = flowM3s != null ? flowM3s / AREA_M2 : null
            const selected = selectedNodes.includes(node.id)
            return (
              <CircleMarker
                key={node.id}
                center={[node.lat, node.lng]}
                radius={selected ? 9 : 7}
                eventHandlers={{ click: () => onToggleNode(node.id) }}
                pathOptions={{
                  color: NODE_COLORS[node.id] ?? '#8aa0b2',
                  fillColor: NODE_COLORS[node.id] ?? '#8aa0b2',
                  fillOpacity: selected ? 1 : 0.86,
                  weight: selected ? 3 : 2,
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={1} permanent={selected}>
                  <div className={styles.tooltipCard}>
                    <strong>{node.label}</strong>
                    <div>{node.fullName}</div>
                    <div>km {node.km.toFixed(0)}</div>
                    <div>P {pressure != null ? `${pressure.toFixed(2)} bar` : '—'}</div>
                    <div>T {temp != null ? `${temp.toFixed(1)} °C` : '—'}</div>
                    {velocity != null && <div>V {velocity.toFixed(3)} m/s</div>}
                  </div>
                </Tooltip>
              </CircleMarker>
            )
          })}

          {injectedLeaks.map(([id, leak]) => {
            const leakKm = Number(leak.location_km ?? leak.requested_location_km ?? 0)
            return (
              <CircleMarker
                key={id}
                center={kmToLatLng(leakKm)}
                radius={13}
                pathOptions={{ color: LEAK, fillColor: LEAK, fillOpacity: 0.54, weight: 4 }}
              >
                <Tooltip permanent direction="left" offset={[-12, 0]}>
                  <div className={styles.leakBadge}>Injected leak · {leakKm.toFixed(1)} km · {Number(leak.flow_kg_s ?? 0).toFixed(1)} kg/s</div>
                </Tooltip>
              </CircleMarker>
            )
          })}

          {estimatedPos && (
            <CircleMarker
              center={estimatedPos}
              radius={15}
              pathOptions={{ color: ESTIMATE, fillColor: ESTIMATE, fillOpacity: 0.22, weight: 4, dashArray: '5 7' }}
            >
              <Tooltip permanent direction="right" offset={[12, 0]}>
                <div className={styles.estimateBadge}>
                  <LocateFixed size={12}/>
                  Estimated · {Number(estimatedKm).toFixed(2)} km
                  {estimatedRange && <span>({Number(estimatedRange[0]).toFixed(1)}–{Number(estimatedRange[1]).toFixed(1)} km)</span>}
                </div>
              </Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
      </div>

      <div className={styles.statusRow}>
        <div><span>Direction</span><strong>North → South</strong><em>Prudhoe Bay to Valdez</em></div>
        <div><span>Flow visual</span><strong>{currentFlow != null ? `${currentFlow.toFixed(3)} m³/s` : '—'}</strong><em>crude particles move continuously</em></div>
        <div><span>Detector</span><strong>{detector?.event_type ?? 'Normal'}</strong><em>{detector?.wave_detected ? 'wave detected' : 'waiting for wave'}</em></div>
        <div><span>Estimated range</span><strong>{estimatedRange ? `${Number(estimatedRange[0]).toFixed(1)}–${Number(estimatedRange[1]).toFixed(1)} km` : '—'}</strong><em>confidence {Number(detector?.confidence ?? 0).toFixed(0)}%</em></div>
      </div>
    </div>
  )
}
