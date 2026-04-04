import { useEffect, useRef, useState } from 'react'
import {
  Chart,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import { useGameStore, selectGameState } from '../../store/gameStore'
import type { Player } from '../../types'

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

function ovrClass(ovr: number) {
  if (ovr >= 70) return 'text-emerald-400'
  if (ovr >= 55) return 'text-amber-400'
  return 'text-red-400'
}

function posColour(pos: string) {
  switch (pos) {
    case 'GK':  return 'bg-yellow-600/30 text-yellow-300'
    case 'DEF': return 'bg-blue-600/30 text-blue-300'
    case 'MID': return 'bg-green-600/30 text-green-300'
    case 'ATT': return 'bg-red-600/30 text-red-300'
    default:    return 'bg-zinc-700 text-zinc-300'
  }
}

const ATTR_LABELS = ['Pace', 'Finishing', 'Passing', 'Dribbling', 'Defending', 'Physical', 'GK', 'Intelligence']

function attrValues(p: Player): number[] {
  return [
    p.attributes.pace,
    p.attributes.finishing,
    p.attributes.passing,
    p.attributes.dribbling,
    p.attributes.defending,
    p.attributes.physical,
    p.attributes.goalkeeping,
    p.attributes.intelligence,
  ]
}

function PlayerRadar({ player }: { player: Player }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef  = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    chartRef.current?.destroy()
    chartRef.current = new Chart(canvasRef.current, {
      type: 'radar',
      data: {
        labels: ATTR_LABELS,
        datasets: [{
          label: player.name,
          data: attrValues(player),
          backgroundColor: 'rgba(96, 165, 250, 0.15)',
          borderColor:     'rgba(96, 165, 250, 0.9)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(96, 165, 250, 1)',
          pointRadius: 3,
          pointHoverRadius: 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.raw}` } },
        },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { count: 5, color: 'rgba(113,113,122,0.8)', backdropColor: 'transparent', font: { size: 9 } },
            grid:        { color: 'rgba(63,63,70,0.8)' },
            angleLines:  { color: 'rgba(63,63,70,0.8)' },
            pointLabels: { color: '#a1a1aa', font: { size: 11 } },
          },
        },
      },
    })
    return () => { chartRef.current?.destroy(); chartRef.current = null }
  }, [player.id])

  return (
    <div className="relative w-full aspect-square max-w-[260px] mx-auto">
      <canvas ref={canvasRef} />
    </div>
  )
}

function StatRow({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-zinc-800/60 last:border-0">
      <span className="text-zinc-500 text-xs">{label}</span>
      <div className="text-right">
        <span className="text-white text-sm font-medium">{value}</span>
        {sub && <span className="text-zinc-500 text-xs ml-1.5">{sub}</span>}
      </div>
    </div>
  )
}

interface PlayerBladeProps {
  playerId: string
  onClose: () => void
}

export default function PlayerBlade({ playerId, onClose }: PlayerBladeProps) {
  const gameState   = useGameStore(selectGameState)
  const [activeTab, setActiveTab] = useState<'radar' | 'stats'>('radar')

  const player = gameState?.players?.[playerId]
  const club   = player ? gameState?.clubs?.[player.clubId] : undefined

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />

      <aside className="fixed right-0 top-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-800 z-50 flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-zinc-800">
          <div className="flex-1 min-w-0">
            {player ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${posColour(player.position)}`}>
                    {player.position}
                  </span>
                  <span className={`text-sm font-bold ${ovrClass(player.currentAbility)}`}>
                    {player.currentAbility}
                  </span>
                </div>
                <h2 className="text-white font-bold text-base leading-tight truncate">{player.name}</h2>
                <p className="text-zinc-400 text-xs mt-0.5 truncate">{club?.name ?? '—'} · Age {player.age}</p>
              </>
            ) : (
              <p className="text-zinc-500 text-sm">Player not found</p>
            )}
          </div>
          <button onClick={onClose} className="ml-3 text-zinc-500 hover:text-white text-2xl leading-none shrink-0 mt-0.5">×</button>
        </div>

        {/* Tabs */}
        {player && (
          <div className="flex border-b border-zinc-800">
            {(['radar', 'stats'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeTab === tab
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab === 'radar' ? '📊 Attributes' : '📋 Season Stats'}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!player && <p className="text-zinc-500 text-sm">No player data available.</p>}

          {player && activeTab === 'radar' && (
            <div className="space-y-5">
              <PlayerRadar player={player} />
              <div className="space-y-1.5">
                {ATTR_LABELS.map((label, i) => {
                  const val = attrValues(player)[i]
                  return (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-zinc-500 text-xs w-20 shrink-0">{label}</span>
                      <div className="flex-1 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${val}%` }} />
                      </div>
                      <span className="text-zinc-300 text-xs tabular-nums w-6 text-right">{val}</span>
                    </div>
                  )
                })}
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-center">
                <span className="text-zinc-500">Potential: </span>
                <span className={`font-bold ${ovrClass(player.potential)}`}>{player.potential}</span>
                <span className="text-zinc-600 mx-2">·</span>
                <span className="text-zinc-500">Current: </span>
                <span className={`font-bold ${ovrClass(player.currentAbility)}`}>{player.currentAbility}</span>
              </div>
            </div>
          )}

          {player && activeTab === 'stats' && (
            <div className="space-y-4">
              <div>
                <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2 font-semibold">Season Performance</p>
                <div className="bg-zinc-800/40 rounded-lg p-3">
                  <StatRow label="Appearances"  value={player.seasonStats.appearances} />
                  <StatRow label="Goals"         value={player.seasonStats.goals} />
                  <StatRow label="Assists"       value={player.seasonStats.assists} />
                  <StatRow label="Clean Sheets"  value={player.seasonStats.cleanSheets} />
                  <StatRow label="Avg Rating"    value={player.seasonStats.averageRating.toFixed(1)} sub="/10" />
                </div>
              </div>
              <div>
                <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2 font-semibold">Discipline</p>
                <div className="bg-zinc-800/40 rounded-lg p-3">
                  <StatRow label="Yellow cards" value={player.seasonStats.yellowCards} />
                  <StatRow label="Red cards"    value={player.seasonStats.redCards} />
                </div>
              </div>
              <div>
                <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2 font-semibold">Profile</p>
                <div className="bg-zinc-800/40 rounded-lg p-3">
                  <StatRow label="Age"      value={player.age} />
                  <StatRow label="Position" value={player.position} />
                  <StatRow label="Club"     value={club?.name ?? '—'} />
                  <StatRow label="Status"   value={player.status} />
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
