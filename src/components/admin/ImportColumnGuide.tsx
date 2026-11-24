/**
 * Plain-language mapping: spreadsheet columns → what gets saved (non-technical copy).
 */

interface Row {
  examples: string;
  updates: string;
  note?: string;
}

const CUSTOMER_ROWS: Row[] = [
  {
    examples: 'Business Group, Business Group (correct), Business Group2 (fixed)',
    updates: 'Whether this customer sits under CDG or LSG (or both, when the sheet says so).',
  },
  {
    examples: 'Customer Type, First Digit, 1st digit (or common typo 1st degit)',
    updates: 'Type of account (for example sold-to = 1, end user = 8, ship-to = 2).',
  },
  {
    examples: 'Code, 7 digit',
    updates: 'The main customer code the system uses to recognise this account.',
  },
  {
    examples: 'SAP Code',
    updates: 'SAP number. If this column is empty, the 7-digit code is reused.',
  },
  {
    examples: 'Company in Japanese Name, Local Company name, Name (Japanese)',
    updates: 'Company name in Japanese.',
  },
  {
    examples: 'AccountName_E, Global Company Name, Name (English)',
    updates: 'Company name in English.',
  },
  {
    examples: 'Postal Code, Prefecture, Address, Japanese Address, Phone',
    updates: 'Address and contact details.',
  },
];

const ZSAM_HIERARCHY_ROWS: Row[] = [
  {
    examples: 'Group',
    updates: 'CDG or LSG for that row. If a cell is empty, the value from the nearest row above is reused (same region until the group changes).',
  },
  {
    examples: '⓪ Team Name, @Team Name',
    updates:
      'Required for each block (or carried forward when Excel uses merged cells). Together with Group it selects the **requester group** (e.g. FAS, DA1). Must match a known team name for that business unit or validation fails with hints.',
  },
  {
    examples: '➊ Sales Reps or Requester',
    updates: 'Who is submitting the form—the key person for this row. Combined with Group for approval mapping; the same row also drives **requester group membership** in the database.',
  },
  {
    examples: 'Sales Rep Code · Account Number (optional)',
    updates:
      'If present, used when creating or updating the requester row. If omitted, the system reuses an existing Requester or User **sales rep code**; if none exists, the import stops with an error for that row.',
  },
  {
    examples: '➋ Sales Manager, ➌ District Sales Manager, ❹ Nationa / National Sales Manager',
    updates:
      'Approvers in order. Headers may include extra text (ZSAM amount rules); that is only a label. An empty cell or the word Blank means no approver at that step. Excel strikethrough or red text still leaves the cell value—clear the cell if that person should not be an approver.',
  },
  {
    examples: '➎ Local Financd / Finance Controller, ❻ Dir, Commercial Mgr',
    updates: 'Higher approvers for larger amounts, as in your matrix. Empty or Blank leaves that slot unset in the database.',
  },
];

const ZNC_INSTALLATION_ROWS: Row[] = [
  {
    examples: 'Group',
    updates: 'CDG or LSG. Empty cells reuse the last value above, or you can infer CDG/LSG from Team Name when it contains (CDG) or (LSG) (for example FAS(CDG)).',
  },
  {
    examples: '⓪ Team Name',
    updates: 'Regional team label (merged cells in Excel are fine). Not stored separately; it helps carry CDG/LSG when the Group column is blank.',
  },
  {
    examples: '➊ Sales Reps or Requester',
    updates: 'The requester for ZNC Installation. Combined with CDG/LSG to upsert the installation approval chain.',
  },
  {
    examples: '➋ Sales Manager, ➌ District Sales Manager, ❹ Nationa / National Sales Manager',
    updates: 'Sales-side approvers. Empty or Blank means no person at that step.',
  },
  {
    examples: '➎ Technical Manager',
    updates: 'Installation technical approver. Empty or Blank clears that step.',
  },
  {
    examples: '❻ National TS manager · National FS manager',
    updates:
      'Stored as National TS Manager in the database. Many spreadsheets use “National FS manager” (field service); both column titles are accepted. ZNC Total / JPY text in the header is ignored.',
  },
  {
    examples: '➐ Local Financial Controller · Local Financd',
    updates: 'Local finance approver for amounts above the ZNC threshold. Empty or Blank clears that slot.',
  },
  {
    examples: '➑ Dir, Commercial Mgr',
    updates: 'Director / commercial approver for high amounts. Empty or Blank clears that slot.',
  },
];

const ZNC_CLAIM_REPLACEMENT_ROWS: Row[] = [
  {
    examples: 'Group',
    updates: 'CDG or LSG. Empty cells reuse the value above; Team Name can include (CDG) or (LSG) when Group is blank.',
  },
  {
    examples: '⓪ Team Name · @Team Name',
    updates: 'Regional label (merged cells are fine). The last non-empty Team Name is carried down to the next rows.',
  },
  {
    examples: '➊ Sales Rep or Requester · Sales Reps or Requester',
    updates: 'Requester for ZNC Claim Replacement. Matched with CDG/LSG to upsert the claim approval chain.',
  },
  {
    examples: '➋ Sales Manager, ➌ District Sales Manager, ❹ National Sales Manager',
    updates: 'Sales approvers. Empty, Blank, or dash means no approver at that step.',
  },
  {
    examples: '➎ CS/PS manager',
    updates: 'CS/PS or CSPS in the header is accepted. Customer Service / Product Support approver for this matrix.',
  },
  {
    examples: 'RAQA manager ZNC Total < JPY1,500,000',
    updates: 'Stored as RAQA manager (on every claim). The “<” and long header text are ignored; only the person name in cells is saved.',
  },
  {
    examples: 'Global RAQA manager ZNC Total > JPY1,500,000 MANUAL',
    updates: 'Stored as Global RAQA manager (also approves when claim total > ¥1.5M, after local RAQA). Must contain “Global” so it is not confused with the RAQA column.',
  },
];

const ZINT_QC_ROWS: Row[] = [
  {
    examples: 'Group',
    updates: 'CDG or LSG. Empty cells reuse the value above; ➊ region text can include (CDG) or (LSG) when Group is blank.',
  },
  {
    examples: '➊ Sales Reps or Requester (default ZINT QC layout)',
    updates: 'Region or team (KYUSHU/OKINAWA, FAS(CDG), …). Merged cells are filled down. This is not the requester name unless you add a separate Team Name column (see below).',
  },
  {
    examples: '➋ Sales manager',
    updates: 'In the default layout this is the requester’s name (same as ZINT_for_QC_TEST.md). Blank / dash in other sales columns means no approver at that step.',
  },
  {
    examples: '⓪ Team Name (optional alternate layout)',
    updates: 'If present, ➊ is treated as the requester and ➋ as Sales Manager approver. Omit Team Name to use the default ZINT QC mapping above.',
  },
  {
    examples: '➌ District Sales Manager, ❹ National Sales Manager',
    updates: 'Sales approvers when used. The literal word Blank in a cell is treated as empty.',
  },
  {
    examples: '➎ CS/PS manager · GS/FS manager',
    updates: 'Both headers map to the CS/PS slot in the database.',
  },
  {
    examples: '❻ RAQA manager (ZNC Total ≤ ¥1,500,000), ➐ Global RAQA manager (ZNC Total ＞ ¥1,500,000)',
    updates: 'RAQA on every request; Global RAQA also when total > ¥1.5M. Long ZNC / JPY text in the header is ignored; Global RAQA is matched before plain RAQA.',
  },
];

const USER_ROWS: Row[] = [
  { examples: 'Email · EMAIL ADDRESS', updates: 'Login address. Each email must be unique in the file.' },
  { examples: 'Name', updates: 'The person’s display name.' },
  {
    examples: 'Role',
    updates: 'What they can do in the system (for example REQUESTER, SALES_MANAGER, ADMIN).',
  },
  {
    examples: 'Business Unit · LSG/CDG · 1 LSG/CDG',
    updates:
      'CDG, LSG, or CDG/LSG. Numbered headers (e.g. "1 LSG/CDG") are recognized. This must be read correctly so regional labels in UPDATE (KINKI, TOKAI/HOKURIKU, …) resolve to CDG teams instead of failing as unknown.',
  },
  {
    examples: 'Sales Rep Code · AD Account Name',
    updates: 'Numeric sales rep code (NA or blank means no code). Shown on forms and used to link the requester row.',
  },
  {
    examples: 'Requester Group · 2 Requester Group',
    updates: 'Current or default group label (e.g. FAS, DA2). Used when UPDATE is empty. Numbered column titles are matched by text.',
  },
  {
    examples: 'UPDATE',
    updates:
      'New requester group for that person (overrides Requester Group). Use the same labels as the form dropdown: FAS, KINKI, DA1, RAQA, etc. Do not put notes here (e.g. DID NOT COME)—clear the cell to leave the group unchanged.',
  },
  {
    examples: 'Requester Group Code',
    updates: 'Optional. If UPDATE and Requester Group are both empty, you can set cdg-7 style codes instead.',
  },
  {
    examples: 'Default Password',
    updates: 'Required for brand-new users only; existing users keep their password unless you set this.',
  },
];

function MappingTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm text-left">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="py-2.5 px-3 font-semibold text-gray-800 w-[38%]">Typical column headers in your file</th>
            <th className="py-2.5 px-3 font-semibold text-gray-800">What it updates in the system</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0 align-top">
              <td className="py-2.5 px-3 text-gray-700 font-mono text-xs">{r.examples}</td>
              <td className="py-2.5 px-3 text-gray-600">
                {r.updates}
                {r.note && (
                  <p className="mt-1 text-xs text-gray-500 border-l-2 border-[#00A651]/40 pl-2">{r.note}</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RETURN_MATRIX_ROWS: Row[] = [
  {
    examples: 'No',
    updates: 'Ignored on import — it is there so the file reads like the sheet. An export renumbers it from 1.',
  },
  {
    examples: 'Group',
    updates: 'CDG, LSG or SERVICE. Inside a merged block, empty cells reuse the value above.',
  },
  {
    examples: 'Team Name',
    updates:
      'Part of the row’s identity, so the same person can appear under two teams with different approvers — which is how the Technical Service people are listed. Empty cells reuse the value above only when Group is empty too, which is what a merged block looks like.',
  },
  {
    examples: 'Sales Reps or Requester',
    updates: 'The requester this row routes. Stored upper case. Rows reading “PLACEHOLDER …” are skipped.',
  },
  {
    examples: 'Reviewer',
    updates:
      'The service review step, taken before any approver. Holds the shared P&OP mailbox address, which is stored exactly as typed. Leave the whole column out to keep whatever is stored; include it blank to clear the review step.',
  },
  {
    examples: '1st Approver, 2nd Approver, Final Approver',
    updates: 'The chain, in order. Blank or “Blank” means no approver at that step. At least one is required.',
  },
  {
    examples: '4th Approver, 5th Approver',
    updates: 'The two service managers. They apply to service-related returns only, so most rows leave them empty.',
  },
];

interface ImportColumnGuideProps {
  entity:
    | 'customers'
    | 'users'
    | 'zsam-hierarchy'
    | 'znc-installation'
    | 'znc-claim-replacement'
    | 'zint-qc'
    | 'return-approval-matrix';
}

export default function ImportColumnGuide({ entity }: ImportColumnGuideProps) {
  const intro =
    entity === 'customers'
      ? 'Each row is matched by business group and customer code. If that combination already exists, the saved customer is updated with the values from your file; otherwise a new customer is created.'
      : entity === 'zsam-hierarchy'
          ? 'Each row updates the ZSAM approval chain (approvers) and assigns the requester to the correct requester group from Team Name + Group (CDG/LSG). The file is treated as the source of truth for both. You need a resolvable team name and, for new people without a code in the database, a Sales Rep Code (or Account Number) column.'
          : entity === 'znc-installation'
            ? 'Each row is one requester for ZNC Installation. The system matches by requester name and CDG or LSG and upserts znc_approval_mapping (SM through Dir, Commercial Mgr). Headers may say National FS manager or National TS manager for the same column. After import, requesters removed from the file are removed from the database for that CDG or LSG so PostgreSQL matches the spreadsheet.'
            : entity === 'znc-claim-replacement'
              ? 'Each row upserts zncclaim_approval_mapping (requester + CDG/LSG). Columns for CS/PS manager, RAQA manager (every claim), and Global RAQA manager (also when total > ¥1.5M) are recognized even with long ZNC Total / JPY text in the header. Global RAQA is detected before RAQA so names map to the correct fields. After import, requesters removed from the file are removed from the database for that CDG or LSG so PostgreSQL matches the spreadsheet.'
              : entity === 'return-approval-matrix'
                ? 'Each row is one line of the Return approval matrix, keyed on Group + Team Name + Sales Reps or Requester — so the same person may appear under more than one team. The file is the source of truth for the Groups it covers: a row you remove is deleted, and the result lists every create, change and delete with its before and after, plus SQL to undo the whole import. Export the matrix first and edit that file: it is exactly what this reads back.'
                : entity === 'zint-qc'
                  ? 'Each row upserts zint_approval_mapping. The usual ZINT QC Excel uses ➊ for region/team (merged cells are carried down) and ➋ Sales manager for the requester’s name—not the sales-approver role. GS/FS manager maps to the CS/PS slot. After import, requesters removed from the file are removed from the database for that CDG or LSG so counts stay aligned. Add a Team Name column only if you want the alternate layout (➊ = requester, ➋ = Sales Manager approver).'
                  : 'Each row is matched by email. The UPDATE column (when present) sets the new requester group together with LSG/CDG; it overrides Requester Group. Human-readable names (FAS, DA1, RAQA, …) are resolved to internal groups. AD Account Name is used as the sales rep code. The linked requester row (for the form dropdown) is created or moved to match.';

  const rows =
    entity === 'customers'
      ? CUSTOMER_ROWS
      : entity === 'zsam-hierarchy'
          ? ZSAM_HIERARCHY_ROWS
          : entity === 'znc-installation'
            ? ZNC_INSTALLATION_ROWS
            : entity === 'znc-claim-replacement'
              ? ZNC_CLAIM_REPLACEMENT_ROWS
              : entity === 'return-approval-matrix'
                ? RETURN_MATRIX_ROWS
                : entity === 'zint-qc'
                  ? ZINT_QC_ROWS
                  : USER_ROWS;

  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50/80 open:bg-white open:shadow-sm transition-shadow" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-lg marker:text-[#00A651]">
        What your spreadsheet columns update (plain English)
      </summary>
      <div className="px-4 pb-4 pt-0 space-y-3 border-t border-gray-100">
        <p className="text-sm text-gray-600 leading-relaxed pt-3">{intro}</p>
        <MappingTable rows={rows} />
        <p className="text-xs text-gray-500">
          Header names are matched flexibly (spacing, common typos). If validation still fails, check that row 1 is the
          header row and that the sheet layout matches one of the formats above.
        </p>
      </div>
    </details>
  );
}
