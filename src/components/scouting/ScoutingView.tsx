import { useMemo, useState } from 'react'
import { useGameStore, selectGameState } from '../../store/gameStore'
import { useUiStore } from '../../store/uiStore'
import type { Player } from '../../types'

const PAGE_SIZE = 50

type PosFilter  = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT'
type TierFilter = 'ALL' | '1' | '2' | '3' | '4'

const POS_OPTIONS:  { value: PosFilter;  label: string }[] = [
  { value: 'ALL', label: 'All Positions' },
  { value: 'GK',  label: 'GK'           },
  { value: 'DEF', label: 'DEF'          },
  { value: 'MID', label: 'MID'          },
  { value: 'ATT', label: 'ATT'          },
]
const TIER_OPTIONS: { value: TierFilter; label: string }[] = [
  { value: 'ALL', label: 'All Tiers'    },
  { value: '1',   label: 'EPL'          },
  { value: '2',   label: 'Championship' },
  { value: '3',   label: 'League One'   },
  { value: '4',   label: 'League Two'   },
]

type SortCol =
  | 'name' | 'club' | 'pos' | 'age'
  | 'pace' | 'finishing' | 'passing' | 'dribbling'
  | 'defending' | 'physical' | 'goalkeeping' | 'intelligence'
  | 'ovr'

const TABLE_COLS: { key: SortCol; label: string; title?: string }[] = [
  { key: 'name',         label: 'Player'  },
  { key: 'club',         label: 'Club'    },
  { key: 'pos',          label: 'Pos'     },
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
]

const TIER_LABELS = ['', 'EPL', 'Championship', 'League One', 'League Two']

function ovrClass(ovr: number) {
  if (ovr >= 70) return 'text-emerald-400 font-semibold'
  if (ovr >= 55) return 'text-amber-400 font-semibold'
  return 'text-red-400'
}

function posColour(pos: string) {
  switch (pos) {
    case 'GK':  return 'text-yellow-400'
    case 'DEF': return 'text-sky-400'
    case 'MID': return 'text-green-400'
    case 'ATT': return 'text-rose-400'
    default:    return 'text-zinc-300'
  }
}

function getSortValue(p: Player, col: SortCol): number {
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
    default:             return 0
  }
}

function AttrCell({ val }: { val: number }) {
  const colour =
    val >= 80 ? 'text-emerald-400' :
    val >= 65 ? 'text-sky-400'     :
    val >= 50 ? 'text-zinc-300'    :
               'text-zinc-500'
  return <td className={`px-2 py-2 text-center text-xs tabular-nums ${colour}`}>{val}</td>
}

function Pill<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            value === o.value
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function RangeRow({ label, min, max, value, onChange }: {
  label: string; min: number; max: number
  value: [number, number]; onChange: (v: [number, number]) => void
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-zinc-500 w-20 shrink-0">{label}</span>
      <input type="range" min={min} max={max} value={value[0]} onChange={(e) => onChange([+e.target.value, value[1]])} className="w-20 accent-blue-500" />
      <span className="text-zinc-400 tabular-nums w-6 text-right">{value[0]}</span>
      <span className="text-zinc-600">–</span>
      <input type="range" min={min} max={max} value={value[1]} onChange={(e) => onChange([value[0], +e.target.value])} className="w-20 accent-blue-500" />
      <span className="text-zinc-400 tabular-nums w-6">{value[1]}</span>
    </div>
  )
}

export default function ScoutingView() {
  const gameState     = useGameStore(selectGameState)
  const { selectPlayer } = useUiStore()

  const [search,       setSearch]       = useState('')
  const [posFilter,    setPosFilter]    = useState<PosFilter>('ALL')
  const [tierFilter,   setTierFilter]   = useState<TierFilter>('ALL')
  const [ageRange,     setAgeRange]     = useState<[number, number]>([16, 40])
  const [abilityRange, setAbilityRange] = useState<[number, number]>([0, 100])
  const [sortCol,      setSortCol]      = useState<SortCol>('ovr')
  const [sortDir,      setSortDir]      = useState<'asc' | 'desc'>('desc')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const allFiltered = useMemo(() => {
    if (!gameState) return []
    const { players, clubs } = gameState

    return Object.values(players)
      .filter((p) => {
        if (posFilter !== 'ALL' && p.position !== posFilter) return false
        if (tierFilter !== 'ALL') {
          const club = clubs[p.clubId]
          if (!club || club.tier !== parseInt(tierFilter)) return false
        }
        if (p.age < ageRange[0] || p.age > ageRange[1]) return false
        if (p.currentAbility < abilityRange[0] || p.currentAbility > abilityRange[1]) return false
        if (search.trim()) {
          const q = search.toLowerCase()
          if (!p.name.toLowerCase().includes(q)) {
            const clubName = (clubs[p.clubId]?.name ?? '').toLowerCase()
            if (!clubName.includes(q)) return false
          }
        }
        return true
      })
      .sort((a, b) => {
        if (sortCol === 'name') {
          const cmp = a.name.localeCompare(b.name)
          return sortDir === 'asc' ? cmp : -cmp
        }
        if (sortCol === 'club') {
          const cmp = (gameState.clubs[a.clubId]?.name ?? '').localeCompare(gameState.clubs[b.clubId]?.name ?? '')
          return sortDir === 'asc' ? cmp : -cmp
        }
        if (sortCol === 'pos') {
          const cmp = a.position.localeCompare(b.position)
          return sortDir === 'asc' ? cmp : -cmp
        }
        const aVal = getSortValue(a, sortCol)
        const bVal = getSortValue(b, sortCol)
        return sortDir === 'desc' ? bVal - aVal : aVal - bVal
      })
  }, [gameState, posFilter, tierFilter, ageRange, abilityRange, search, sortCol, sortDir])

  const visible = allFiltered.slice(0, visibleCount)

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortCol(col); setSortDir('desc'); setVisibleCount(PAGE_SIZE) }
  }

  if (!gameState) {
    return <div className="flex items-center justify-center h-full text-zinc-500">Loading player data…</div>
  }

  const totalPlayers = Object.keys(gameState.players).length

  return (
    <div className="p-6">

      <div className="mb-5">
        <h1 className="text-white font-bold text-xl">Scouting Database</h1>
        <p className="text-zinc-400 text-sm mt-0.5">
          {allFiltered.length.toLocaleString()} of {totalPlayers.toLocaleString()} players
          {allFiltered.length !== totalPlayers && ' match your filters'}
        </p>
      </div>

      {/* Filter panel */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 mb-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs w-20 shrink-0">Search</span>
          <input
            type="text"
            placeholder="Player or club name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE) }}
            className="flex-1 bg-zinc-800 text-white text-sm rounded-lg px-3 py-1.5 border border-zinc-700 focus:outline-none focus:border-blue-500 placeholder-zinc-600"
          />
          {search && (
            <button onClick={() => { setSearch(''); setVisibleCount(PAGE_SIZE) }} className="text-zinc-500 hover:text-white text-xs">Clear</button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs w-20 shrink-0">Position</span>
          <Pill options={POS_OPTIONS} value={posFilter} onChange={(v) => { setPosFilter(v); setVisibleCount(PAGE_SIZE) }} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-zinc-500 text-xs w-20 shrink-0">Tier</span>
          <Pill options={TIER_OPTIONS} value={tierFilter} onChange={(v) => { setTierFilter(v); setVisibleCount(PAGE_SIZE) }} />
        </div>
        <RangeRow label="Age"     min={16} max={40}  value={ageRange}     onChange={(v) => { setAgeRange(v);     setVisibleCount(PAGE_SIZE) }} />
        <RangeRow label="Ability" min={0}  max={100} value={abilityRange} onChange={(v) => { setAbilityRange(v); setVisibleCount(PAGE_SIZE) }} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-zinc-900 border-b border-zinc-800">
              {TABLE_COLS.map((col) => (
                <th
                  key={col.key}
                  title={col.title}
                  onClick={() => handleSort(col.key)}
                  className={`px-2 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${
                    sortCol === col.key ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
                  } ${col.key === 'name' ? 'text-left pl-4' : col.key === 'club' ? 'text-left' : 'text-center'}`}
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
            {visible.map((player, idx) => {
              const club = gameState.clubs[player.clubId]
              const tierLabel = TIER_LABELS[club?.tier ?? 0] ?? '?'
              const isPlayerClub = club?.id === gameState.playerClub?.id

              return (
                <tr
                  key={player.id}
                  onClick={() => selectPlayer(player.id)}
                  className={`border-b border-zinc-800/40 cursor-pointer hover:bg-zinc-800/60 transition-colors ${
                    idx % 2 === 0 ? 'bg-zinc-900/20' : ''
                  } ${isPlayerClub ? 'border-l-2 border-l-blue-600' : ''}`}
                >
                  <td className="pl-4 pr-2 py-2">
                    <div className="text-white text-xs font-medium truncate max-w-[8rem]">{player.name}</div>
                  </td>
                  <td className="px-2 py-2 min-w-[120px]">
                    <div className="text-zinc-400 text-xs truncate max-w-[9rem]">{club?.shortName ?? club?.name ?? '—'}</div>
                    <div className="text-zinc-600 text-[10px]">{tierLabel}</div>
                  </td>
                  <td className={`px-2 py-2 text-center text-xs font-semibold ${posColour(player.position)}`}>{player.position}</td>
                  <td className="px-2 py-2 text-center text-zinc-400 text-xs">{player.age}</td>
                  <AttrCell val={player.attributes.pace} />
                  <AttrCell val={player.attributes.finishing} />
                  <AttrCell val={player.attributes.passing} />
                  <AttrCell val={player.attributes.dribbling} />
                  <AttrCell val={player.attributes.defending} />
                  <AttrCell val={player.attributes.physical} />
                  <AttrCell val={player.attributes.goalkeeping} />
                  <AttrCell val={player.attributes.intelligence} />
                  <td className={`px-2 py-2 text-center text-xs ${ovrClass(player.currentAbility)}`}>{player.currentAbility}</td>
                </tr>
              )
            })}
            {allFiltered.length === 0 && (
              <tr>
                <td colSpan={TABLE_COLS.length} className="py-12 text-center text-zinc-500 text-sm">No players match your filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {visibleCount < allFiltered.length && (
        <div className="mt-4 flex flex-col items-center gap-1">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            Load more — showing {visibleCount} of {allFiltered.length}
          </button>
        </div>
      )}
      {visibleCount >= allFiltered.length && allFiltered.length > 0 && (
        <p className="mt-4 text-center text-zinc-600 text-xs">All {allFiltered.length} players shown.</p>
      )}
    </div>
  )
}
