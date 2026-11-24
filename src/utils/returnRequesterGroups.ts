/**
 * Which requester teams a return may be raised under.
 *
 * One definition, two callers: the wizard's step 1 and the reviewer's correction screen. The two had
 * separate copies of this merge and were already one edit away from disagreeing about which teams
 * exist — which is exactly the kind of drift that puts a request on the wrong approval route.
 *
 * Two rules came out of the 9 Sep meeting, and both live here:
 *
 *   - The **Technical Service** teams are offered whether or not the request is service-related.
 *     They used to appear only when Service = Yes; Vidhi asked for both — *"please stay TS, they may
 *     use the both case as a possibility"* — because a TS person raising an ordinary return is a
 *     real case.
 *   - **CUSTOMER SERVICE** is withheld when Service = Yes. Emi: *"Japan CS team don't take care of
 *     any service order … could you please remove the customer service from the select requester
 *     group"*. It stays available for Service = No, which is her team's own work.
 *
 * `CUSTOMER SERVICE` carries a CDG or LSG business unit, so it arrives on the *unit* query and the
 * service-team suffix filter never sees it; excluding it has to happen here. The server cannot do
 * either rule — `GET /requester-groups` is never told whether the request is service-related.
 */
import { staticDataApi, type RequesterGroup } from '../services/api.service'
import { filterServiceTeamsForBusinessUnit } from './returnCatalogBusinessUnit'

/**
 * Teams whose members never handle a service-related return.
 *
 * Matched on the team name because that is all the endpoint returns — `GET /requester-groups` maps
 * its rows to `{ id, name }` and drops the code. There are two `CUSTOMER SERVICE` rows, one per
 * unit, and the name matches whichever is in scope.
 */
const NON_SERVICE_GROUP_PATTERNS = /^customer\s*service$/i

function isOfferedForService(group: { name: string }): boolean {
  return !NON_SERVICE_GROUP_PATTERNS.test(String(group.name ?? '').trim())
}

/**
 * The teams to offer for a business unit, given the Service flag.
 *
 * Returns them deduplicated by id and sorted by name, which is what both pickers want. Throws
 * whatever the API throws so each caller can show its own error state.
 */
export async function loadReturnRequesterGroups(
  businessUnit: string,
  isService: boolean
): Promise<RequesterGroup[]> {
  if (!businessUnit) return []

  // The unit's own teams, plus the SERVICE teams scoped to this unit by their "(CDG)"/"(LSG)"
  // suffix — an unsuffixed service team serves both units.
  const [unit, service] = await Promise.all([
    staticDataApi.getRequesterGroups(businessUnit, 'RETURN'),
    staticDataApi.getRequesterGroups('SERVICE', 'RETURN'),
  ])

  const unitGroups = (unit.groups || []).filter((g) => (isService ? isOfferedForService(g) : true))
  const serviceGroups = filterServiceTeamsForBusinessUnit(service.groups || [], businessUnit)

  const seen = new Set<string>()
  const merged = [...unitGroups, ...serviceGroups].filter((g) =>
    seen.has(g.id) ? false : (seen.add(g.id), true)
  )
  merged.sort((a, b) => a.name.localeCompare(b.name))
  return merged
}
