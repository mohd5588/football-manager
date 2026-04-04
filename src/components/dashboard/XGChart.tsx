import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { useGameStore, selectGameState } from '../../store/gameStore'
import { useInboxStore } from '../../store/inboxStore'

interface XGDataPoint {
  label: string
  xgFor: number
  xgAgainst: number
}

function resolveXG(report: any, playerClubId: string): { xgFor: number; xgAgainst: number } {
  const events: any[] = report.events ?? []
  const homeGoals: number = report.homeStats?.goals ?? 0
  const awayGoals: number = report.awayStats?.goals ?? 0

  const goalsByClub: Record<string, number> = {}
  for (const e of events) {
    if (e.type === 'goal' && e.clubId) {
      goalsByClub[e.clubId] = (goalsByClub[e.clubId] ?? 0) + 1
    }
  }

  const playerClubGoals = goalsByClub[playerClubId] ?? 0
  let playerWasHome: boolean

  if (homeGoals !== awayGoals) {
    playerWasHome = playerClubGoals === homeGoals
  } else {
    playerWasHome = events.find((e) => e.type === 'goal')?.clubId === playerClubId
  }

  return {
    xgFor:     playerWasHome ? (report.homeStats?.xG ?? 0) : (report.awayStats?.xG  ?? 0),
    xgAgainst: playerWasHome ? (report.awayStats?.xG  ?? 0) : (report.homeStats?.xG ?? 0),
  }
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1 font-medium truncate max-w-[140px]">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: entry.color }}>
          {entry.name}: <span className="font-bold">{entry.value.toFixed(2)}</span>
        </p>
      ))}
    </div>
  )
}

interface XGChartProps {
  maxMatches?: number
}

export default function XGChart({ maxMatches = 10 }: XGChartProps) {
  const gameState  = useGameStore(selectGameState)
  const inboxItems = useInboxStore((s) => s.items)

  const data: XGDataPoint[] = useMemo(() => {
    if (!gameState?.playerClub) return []
    const { playerClub, clubs } = gameState

    return inboxItems
      .filter((item) => !!item.report)
      .slice()
      .reverse()
      .slice(-maxMatches)
      .map((item, i) => {
        const report = item.report!
        const { xgFor, xgAgainst } = resolveXG(report, playerClub.id)

        const opponentId = (report.events ?? []).find(
          (e: any) => e.type === 'goal' && e.clubId && e.clubId !== playerClub.id
        )?.clubId
        const opponentName = opponentId
          ? (clubs[opponentId]?.shortName ?? clubs[opponentId]?.name ?? '?')
          : `Match ${i + 1}`

        return {
          label: `vs ${opponentName}`,
          xgFor:     Math.round(xgFor     * 100) / 100,
          xgAgainst: Math.round(xgAgainst * 100) / 100,
        }
      })
  }, [gameState, inboxItems, maxMatches])

  if (!gameState?.playerClub) return null

  if (data.length < 2) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <h3 className="text-zinc-300 font-semibold text-sm mb-1">xG Performance</h3>
        <p className="text-zinc-600 text-xs">Play more matches to see your xG trend.</p>
      </div>
    )
  }

  const avgFor     = data.reduce((s, d) => s + d.xgFor,     0) / data.length
  const avgAgainst = data.reduce((s, d) => s + d.xgAgainst, 0) / data.length

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-zinc-300 font-semibold text-sm">xG Performance</h3>
          <p className="text-zinc-600 text-xs mt-0.5">Last {data.length} matches</p>
        </div>
        <div className="flex gap-4 text-xs">
          <span className="text-zinc-500">
            Avg xGF: <span className="text-sky-400 font-semibold">{avgFor.toFixed(2)}</span>
          </span>
          <span className="text-zinc-500">
            Avg xGA: <span className="text-rose-400 font-semibold">{avgAgainst.toFixed(2)}</span>
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <XAxis dataKey="label" tick={{ fill: '#52525b', fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis domain={[0, 'auto']} tick={{ fill: '#52525b', fontSize: 9 }} tickLine={false} axisLine={false} tickCount={4} />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#a1a1aa', paddingTop: 8 }} />
          <ReferenceLine y={avgFor}     stroke="#38bdf8" strokeDasharray="3 3" strokeOpacity={0.35} />
          <ReferenceLine y={avgAgainst} stroke="#fb7185" strokeDasharray="3 3" strokeOpacity={0.35} />
          <Line type="monotone" dataKey="xgFor"     name="xG For"     stroke="#38bdf8" strokeWidth={2} dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="xgAgainst" name="xG Against" stroke="#fb7185" strokeWidth={2} dot={{ r: 3, fill: '#fb7185', strokeWidth: 0 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
