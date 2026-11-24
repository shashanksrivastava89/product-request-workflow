/** What the server reports about a person who is being removed from the approval hierarchies. */

export type OffboardingMappingRow = {
  id: string
  requesterName: string
  businessUnit: string
  teamName?: string
  /** Approver columns holding the name; empty for the person's own row. */
  columns: string[]
}

export type OffboardingMappingTable = {
  table: 'zsam' | 'znc-installation' | 'znc-claim' | 'zint' | 'return'
  label: string
  asApprover: OffboardingMappingRow[]
  asRequester: OffboardingMappingRow[]
}

export type OffboardingScope = {
  name: string
  key: string
  accounts: Array<{ id: string; email: string; name: string; role: string; isActive: boolean }>
  mappings: OffboardingMappingTable[]
  hierarchyReferences: Array<{ userId: string; name: string; email: string; fields: string[] }>
  directoryRows: Array<{ id: string; name: string; code: string; group: string; groupCode: string; isActive: boolean }>
  openApprovals: Array<{
    formId: string
    referenceNumber: string | null
    formStatus: string
    level: number
    role: string
    status: string
  }>
  found: boolean
}

export type OffboardingResult = {
  success: boolean
  scope: OffboardingScope
  successor: { name: string; userId: string | null } | null
  applied: {
    mappingRowsUpdated: number
    mappingRowsDeleted: number
    hierarchyLinksUpdated: number
    directoryRowsDeactivated: number
    accountsDeactivated: number
  }
}

/** Column and field names as the tables call them, in words. */
export const OFFBOARDING_FIELD_LABELS: Record<string, string> = {
  salesManager: 'Sales manager (SM)',
  districtSalesManager: 'District sales manager (DSM)',
  nationalSalesManager: 'National sales manager (NSM)',
  localFinanceController: 'Local finance controller (LFC)',
  directorCommercialManager: 'Director commercial (DCM)',
  technicalManager: 'Technical manager (TM)',
  nationalTSManager: 'National TS manager (NTSM)',
  csPsManager: 'CS/PS manager',
  raqaManager: 'RAQA manager',
  globalRaqaManager: 'Global RAQA manager',
  firstApprover: '1st approver',
  secondApprover: '2nd approver',
  finalApprover: 'Final approver',
  fourthApprover: '4th approver',
  fifthApprover: '5th approver',
  reviewer: 'Reviewer',
  salesManagerId: 'Sales manager link',
  districtSalesManagerId: 'District sales manager link',
  nationalSalesManagerId: 'National sales manager link',
  localFinanceControllerId: 'Local finance controller link',
  directorCommercialManagerId: 'Director commercial link',
  technicalManagerId: 'Technical manager link',
  nationalTSManagerId: 'National TS manager link',
}

export function offboardingFieldLabel(field: string): string {
  return OFFBOARDING_FIELD_LABELS[field] ?? field
}

/** The same folding the server applies before comparing two names. */
export function offboardingNameKey(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/　/g, ' ').trim().toLowerCase()
}
