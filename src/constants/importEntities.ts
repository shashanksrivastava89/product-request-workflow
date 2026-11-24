/**
 * What the bulk importer can load, in one place.
 *
 * The list used to be written out four times - twice inline in `api.service.ts`, once as a type in
 * `BulkImportPage.tsx` and once more in `ImportColumnGuide.tsx` - so adding an entity meant finding
 * all four and the server's `ENTITIES` besides. Collapsed here so the next one is two edits.
 *
 * The values must match the server's `ENTITIES` in `backend/src/controllers/import.controller.ts`.
 *
 * Products are not here: since 8 Oct 2026 they come only from the Power BI master, on Admin ->
 * Product master sync.
 */
export const IMPORT_ENTITY_LABELS = {
  customers: 'Customers (SOLD-TO / End User / Ship-to)',
  users: 'Users',
  'zsam-hierarchy': 'ZSAM hierarchy',
  'znc-installation': 'ZNC installation hierarchy',
  'znc-claim-replacement': 'ZNC claim replacement hierarchy',
  'zint-qc': 'ZINT for QC hierarchy',
  'return-approval-matrix': 'Return approval matrix',
} as const;

export type ImportEntity = keyof typeof IMPORT_ENTITY_LABELS;

export const IMPORT_ENTITY_VALUES = Object.keys(IMPORT_ENTITY_LABELS) as ImportEntity[];

export function isImportEntity(s: string | null | undefined): s is ImportEntity {
  return s != null && (IMPORT_ENTITY_VALUES as string[]).includes(s);
}
