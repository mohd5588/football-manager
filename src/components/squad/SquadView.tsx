import { useMemo, useState } from 'react'
import { useGameStore, selectGameState } from '../../store/gameStore'
import { useUiStore } from '../../store/uiStore'
import { useInboxStore } from '../../store/inboxStore'
import type { Player } from '../../types'

// 'ACADEMY' filters to players aged ≤ 17 (youth intake players)
type PosFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT' | 'ACADEMY'
type SortCol =
  | 'name' | 'position' | 'age'
  | 'pace' | 'finishing' | 'passing' | 'dribbling'
  | 'defending' | 'physical' | 'goalkeeping' | 'intelligence'
  | 'ovr' | 'pot' | 'apps' | 'goals' | 'assists' | 'rating'

const POS_FILTERS: PosFilter[] = ['ALL', 'GK', 'DEF', 'MID', 'ATT', 'ACADEMY']

const COLS: { key: SortCol; label: string; title?: string; academyOnly?: boolean }[] = [
  { key: 'name',         label: 'Player'  },
  { key: 'position',     label: 'Pos'     },
  { key: 'age',          label: 'Age'     },
  { key: 'pace',         label: 'PAC',    title: 'Pace'         },
  { key: 'finishing',    label: 'FIN',    title: 'Finishing'    },
  { key: 'passing',      label: 'PAS',    title: 'Passing'      },
  { key: 'dribbling',    label: 'DRI',    title: 'Dribbling'    },
  { key: 'defending',    label: 'DEF',    title: 'Defending'    },
  { key: 'physical',     label: 'PHY',    title: 'Physical'     },
  { key: 'goalkeeping',  label: 'GK',     title: 'Goalkeeping'  },
  { key: 'intelligence', label: 'INT',    title: 'Intelligence' },
  { key: 'ovr',          label: 'OVR',    title: 'Overall (Current Ability)' },
  // POT column — always visible but highlighted in Academy view
  { key: 'pot',          label: 'POT',    title: 'Potential'    },
  { key: 'apps',         label: 'Apps',   title: 'Appearances'  },
  { key: 'goals',        label: 'G',      title: 'Goals'        },
  { key: 'assists',      label: 'A',      title: 'Assists'      },
  { key: 'rating',       label: 'Rating', title: 'Avg Rating (last 5)' },
]

function ovrClass(ovr: number): string {
  if (ovr >= 70) return 'text-emerald-400 font-semibold'
  if (ovr >= 55) return 'text-amber-400 font-semibold'
  return 'text-red-400 font-semibold'
}

function potClass(pot: number): string {
  if (pot >= 75) return 'text-emerald-400 font-semibold'
  if (pot >= 65) return 'text-sky-400 font-semibold'
  if (pot >= 55) return 'text-amber-400'
  return 'text-zinc-500'
}

function getSortValue(p: Player, col: SortCol, ratings: number[]): number {
  switch (col) {
    case 'age':          return p.age
    case 'pace':         return p.attributes.pace
    case 'finishing':    return p.attributes.finishing
    case 'passing':      return p.attributes.passing
    case 'dribbling':    return p.attributes.dribbling
    case 'defending':    return p.attributes.defending
    case 'physical':     return p.attributes.physical
    case 'goalkeeping':  return p.attributes.goalkeeping
    case 'intelligence': return p.attributes.intelligence
    case 'ovr':          return p.currentAbility
    case 'pot':          return p.potential
    case 'apps':         return p.seasonStats.appearances
    case 'goals':        return p.seasonStats.goals
    case 'assists':      return p.seasonStats.assists
    case 'rating':       return ratings.length
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : 0
    default:             return 0
  }
}

function RatingSparkline({ ratings }: { ratings: number[] }) {
  if (!ratings.length) return <span className="text-zinc-600 text-xs">—</span>

  const W = 52, H = 18, PAD = 2
  const points = ratings.map((r, i) => {
    const x = PAD + (ratings.length > 1
      ? (i / (ratings.length - 1)) * (W - PAD * 2)
      : (W - PAD * 2) / 2)
    const y = H - PAD - (r / 10) * (H - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length
  const stroke = avg >= 7 ? '#34d399' : avg >= 5.5 ? '#fbbf24' : '#f87171'

  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {(() => {
        const last = ratings[ratings.length - 1]
        const x = W - PAD
        const y = H - PAD - (last / 10) * (H - PAD * 2)
        return <circle cx={x} cy={y} r="2" fill={stroke} />
      })()}
    </svg>
  )
}

export default function SquadView() {
  const gameState  = useGameStore(selectGameState)
  const { selectPlayer } = useUiStore()
  const inboxItems = useInboxStore((s) => s.items)

  const [posFilter, setPosFilter] = useState<PosFilter>('ALL')
  const [sortCol,   setSortCol]   = useState<SortCol>('ovr')
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('desc')

  const isAcademyView = posFilter === 'ACADEMY'

  const ratingMap = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const item of [...inboxItems].reverse()) {
      if (!item.report?.playerRatings) continue
      for (const pr of item.report.playerRatings) {
        const existing = map.get(pr.playerId) ?? []
        if (existing.length < 5) map.set(pr.playerId, [...existing, pr.rating])
      }
    }
    return map
  }, [inboxItems])

  const squadPlayers = useMemo(() => {
    if (!gameState) return []
    return Object.values(gameState.players).filter(
      (p) => p.clubId === gameState.playerClub?.id
    )
  }, [gameState])

  const filtered = useMemo(() => {
    if (posFilter === 'ALL')     return squadPlayers
    if (posFilter === 'ACADEMY') return squadPlayers.filter(p => p.age <= 17)
    if (posFilter === 'GK')      return squadPlayers.filter(p => p.position === 'GK')
    if (posFilter === 'DEF')     return squadPlayers.filter(p =>
      ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(p.position)
    )
    if (posFilter === 'MID')     return squadPlayers.filter(p =>
      ['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(p.position)
    )
    if (posFilter === 'ATT')     return squadPlayers.filter(p =>
      ['LW', 'RW', 'CF', 'ST'].includes(p.position)
    )
    return squadPlayers
  }, [squadPlayers, posFilter])

  const sorted = useMemo(() => {
    // In academy view default sort is potential descending so best prospects are at the top
    return [...filtered].sort((a, b) => {
      if (sortCol === 'name') {
        const cmp = a.name.localeCompare(b.name)
        return sortDir === 'asc' ? cmp : -cmp
      }
      if (sortCol === 'position') {
        const cmp = a.position.localeCompare(b.position)
        return sortDir === 'asc' ? cmp : -cmp
      }
      const aVal = getSortValue(a, sortCol, ratingMap.get(a.id) ?? [])
      const bVal = getSortValue(b, sortCol, ratingMap.get(b.id) ?? [])
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
  }, [filtered, sortCol, sortDir, ratingMap])

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortCol(col); setSortDir('desc') }
  }

  // Switch to potential sort automatically when entering academy view
  function handleFilterChange(f: PosFilter) {
    setPosFilter(f)
    if (f === 'ACADEMY') { setSortCol('pot'); setSortDir('desc') }
    else if (posFilter === 'ACADEMY') { setSortCol('ovr'); setSortDir('desc') }
  }

  const club = gameState?.playerClub

  if (!gameState || !club) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading squad…</div>
  }

  const academyCount = squadPlayers.filter(p => p.age <= 17).length

  return (
    <div className="p-6 max-w-full">

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-white font-bold text-xl">{club.name}</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {squadPlayers.length} players · Season {gameState.season}
            {academyCount > 0 && (
              <span className="ml-2 text-emerald-400">· 🌱 {academyCount} academy</span>
            )}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {POS_FILTERS.map((pos) => (
            <button
              key={pos}
              onClick={() => handleFilterChange(pos)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                posFilter === pos
                  ? pos === 'ACADEMY'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              {pos === 'ACADEMY' ? '🌱 Academy' : pos}
              {pos === 'ACADEMY' && academyCount > 0 && posFilter !== 'ACADEMY' && (
                <span className="ml-1 bg-emerald-500 text-white text-[9px] font-bold rounded-full px-1">
                  {academyCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Academy banner — shown only when ACADEMY filter is active */}
      {isAcademyView && (
        <div className="mb-4 bg-emerald-950/40 border border-emerald-700/40 rounded-lg px-4 py-3 text-sm">
          <p className="text-emerald-300 font-medium mb-0.5">Youth Academy</p>
          <p className="text-emerald-200/70 text-xs">
            These players are 16–17 years old. Their OVR is low now but their POT score shows
            their ceiling. Develop them over several seasons — the best prospects can become
            first-team stars.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-zinc-900 border-b border-zinc-800">
              {COLS.map((col) => (
                <th
                  key={col.key}
                  title={col.title}
                  onClick={() => handleSort(col.key)}
                  className={`px-2 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
                    sortCol === col.key
                      ? 'text-blue-400'
                      : col.key === 'pot' && isAcademyView
                        ? 'text-emerald-400 hover:text-emerald-300'
                        : 'text-zinc-500 hover:text-zinc-300'
                  } ${col.key === 'name' ? 'text-left pl-4' : 'text-center'}`}
                >
                  {col.label}
                  {sortCol === col.key && (
                    <span className="ml-1 text-[10px]">{sortDir === 'desc' ? '▼' : '▲'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sorted.map((player, idx) => {
              const ratings   = ratingMap.get(player.id) ?? []
              const avgRating = ratings.length
                ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
                : '—'
              const isAcademyPlayer = player.age <= 17

              return (
                <tr
                  key={player.id}
                  onClick={() => selectPlayer(player.id)}
                  className={`border-b border-zinc-800/50 cursor-pointer hover:bg-zinc-800/60 transition-colors ${
                    idx % 2 === 0 ? 'bg-zinc-900/30' : 'bg-zinc-900/10'
                  } ${isAcademyPlayer && !isAcademyView ? 'border-l-2 border-l-emerald-600' : ''}`}
                >
                  <td className="pl-4 pr-2 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {isAcademyPlayer && (
                        <span className="text-[11px]" title="Youth academy player">🌱</span>
                      )}
                      <span className="text-white font-medium truncate max-w-[8rem]">{player.name}</span>
                    </div>
                    {player.status !== 'active' && (
                      <span className={`text-[10px] font-semibold ${
                        player.status === 'injured' ? 'text-red-400' : 'text-amber-400'
                      }`}>
                        {player.status.toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-center text-zinc-300 text-xs font-mono">{player.position}</td>
                  <td className="px-2 py-2.5 text-center text-zinc-400">{player.age}</td>
                  <AttrCell val={player.attributes.pace} />
                  <AttrCell val={player.attributes.finishing} />
                  <AttrCell val={player.attributes.passing} />
                  <AttrCell val={player.attributes.dribbling} />
                  <AttrCell val={player.attributes.defending} />
                  <AttrCell val={player.attributes.physical} />
                  <AttrCell val={player.attributes.goalkeeping} />
                  <AttrCell val={player.attributes.intelligence} />
                  <td className={`px-2 py-2.5 text-center ${ovrClass(player.currentAbility)}`}>
                    {player.currentAbility}
                  </td>
                  <td className={`px-2 py-2.5 text-center ${potClass(player.potential)} ${
                    isAcademyView ? 'font-bold' : ''
                  }`}>
                    {player.potential}
                  </td>
                  <td className="px-2 py-2.5 text-center text-zinc-400">{player.seasonStats.appearances}</td>
                  <td className="px-2 py-2.5 text-center text-zinc-400">{player.seasonStats.goals}</td>
                  <td className="px-2 py-2.5 text-center text-zinc-400">{player.seasonStats.assists}</td>
                  <td className="px-2 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-zinc-400 text-xs tabular-nums w-6 text-right">{avgRating}</span>
                      <RatingSparkline ratings={ratings} />
                    </div>
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="py-10 text-center text-zinc-500 text-sm">
                  {isAcademyView
                    ? 'No academy players yet — they arrive at the end of each season.'
                    : 'No players match this filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-zinc-600">
        Click any player row to open their profile. Click a column header to sort.
        {isAcademyView && ' Sorted by potential by default.'}
      </p>
    </div>
  )
}

function AttrCell({ val }: { val: number }) {
  const colour =
    val >= 80 ? 'text-emerald-400' :
    val >= 65 ? 'text-sky-400'     :
    val >= 50 ? 'text-zinc-300'    :
               'text-zinc-500'
  return <td className={`px-2 py-2.5 text-center text-xs tabular-nums ${colour}`}>{val}</td>
}
