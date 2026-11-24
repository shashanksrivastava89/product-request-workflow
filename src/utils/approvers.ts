import zsamMapping from '../../zsamm_approval_mapping.json'

export type ZsamApproverFields = {
  salesManager?: string
  districtSalesManager?: string
  nationalSalesManager?: string
  localFinanceController?: string
  directorCommercialManager?: string
}

type RawZsamMapping = Record<string, {
  ['Sales Manager']?: string
  ['District Sales Manager']?: string
  ['National Sales Manager']?: string
  ['Local Financial Controller']?: string
  ['Dir, Commercial Mgr']?: string
  ['Approver']?: string | null
}>

// The JSON keys are requester names (often uppercase). We normalize lookups to uppercase.
const raw: RawZsamMapping = zsamMapping as any

function normalize(val?: string | null): string | undefined {
  if (val == null) return undefined
  const trimmed = String(val).trim()
  if (trimmed.toLowerCase() === 'blank' || trimmed === '') return undefined
  return trimmed
}

/**
 * Resolve ZSAM approvers for a given requester name using zsamm_approval_mapping.json.
 * Returns fields normalized to the form model. Missing/Blank entries are undefined.
 */
export function resolveZsamApprovers(requesterName: string): ZsamApproverFields | undefined {
  if (!requesterName) return undefined
  const key = requesterName.toUpperCase()
  const rec = raw[key]
  if (!rec) return undefined
  return {
    salesManager: normalize(rec['Sales Manager']),
    districtSalesManager: normalize(rec['District Sales Manager']),
    nationalSalesManager: normalize(rec['National Sales Manager']),
    localFinanceController: normalize(rec['Local Financial Controller']),
    directorCommercialManager: normalize(rec['Dir, Commercial Mgr']),
  }
}