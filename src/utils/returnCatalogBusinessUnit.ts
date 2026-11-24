/**
 * Service teams are named either with a business-unit suffix — Technical Service(CDG) — which
 * scopes the team to that unit, or with no suffix — PROJECT & OPERATIONAL PLANNER TEAM — in which
 * case the team serves both units and is offered under either.
 */
export function filterServiceTeamsForBusinessUnit<T extends { name: string }>(
  teams: T[],
  businessUnit: string | null | undefined
): T[] {
  const bu = String(businessUnit ?? '')
    .replace(/\u3000/g, ' ')
    .trim()
    .toUpperCase()
  if (bu !== 'CDG' && bu !== 'LSG') return []
  return teams.filter((team) => {
    const suffix = /\((CDG|LSG)\)\s*$/i.exec(String(team.name ?? '').trim())
    return !suffix || suffix[1].toUpperCase() === bu
  })
}

/**
 * Partner/product catalogs are keyed CDG | LSG only.
 * For return BU=SERVICE, derive catalog BU from the team name suffix, e.g.
 *   Technical Service(CDG) → CDG
 *   PROJECT & OPERATIONAL PLANNER TEAM(LSG) → LSG
 */
export function resolveReturnCatalogBusinessUnit(
  businessUnit: string | null | undefined,
  requesterGroupName?: string | null
): 'CDG' | 'LSG' | '' {
  const bu = String(businessUnit ?? '')
    .replace(/\u3000/g, ' ')
    .trim()
    .toUpperCase()
  if (bu === 'CDG' || bu === 'LSG') return bu
  if (bu !== 'SERVICE') return ''

  const name = String(requesterGroupName ?? '')
    .replace(/\u3000/g, ' ')
    .trim()
    .toUpperCase()
  if (/\(LSG\)\s*$/.test(name) || name.includes('(LSG)')) return 'LSG'
  if (/\(CDG\)\s*$/.test(name) || name.includes('(CDG)')) return 'CDG'
  return ''
}
