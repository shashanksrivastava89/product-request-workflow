/**
 * Maps Excel "Team Name" + business unit (from Group column) → requester_groups.code
 * (same keys as scripts/import-requesters-from-master.ts).
 */

/** Team label (normalized) + BU key → requester group code */
export const TEAM_BU_TO_REQUESTER_GROUP_CODE: Record<string, string> = {
  'HOKKAIDO/TOHOKU|CDG': 'cdg-10',
  'SHUTO2D|CDG': 'cdg-19',
  'SHUTO1D|CDG': 'cdg-18',
  'TOKAI/HOKURIKU|CDG': 'cdg-23',
  'KINKI|CDG': 'cdg-12',
  'CHUGOKU/SHIKOKU|CDG': 'cdg-2',
  'KYUSHU/OKINAWA|CDG': 'cdg-13',
  'Sales Manager|CDG': 'cdg-21',
  'NATIONAL ACCOUNT|CDG/LSG': 'cdg-14',
  'IA|LSG': 'cdg-11',
  'DA2|LSG': 'cdg-4',
  'DA1|LSG': 'cdg-3',
  'DAW|LSG': 'cdg-5',
  'FAS|LSG': 'cdg-7',
  'FAS|CDG': 'cdg-6',
  'PCD|LSG': 'cdg-15',
  'PS|LSG': 'cdg-16',
  'FMM(LSG)|LSG': 'cdg-9',
  'FMM(CDG)|CDG': 'cdg-8',
  'TECHNICAL SERVICE|CDG/LSG': 'cdg-22',
  ' District Sales Manager |LSG': 'cdg-1',
  'District Sales Manager|LSG': 'cdg-1',
  'RAQA|CDG/LSG': 'cdg-17',
  'SP|CDG': 'cdg-20',
};

/** requester_groups.code → businessUnit stored in DB */
export const REQUESTER_GROUP_META: Record<string, { name: string; businessUnit: string }> = {
  'cdg-1': { name: ' District Sales Manager ', businessUnit: 'LSG' },
  'cdg-2': { name: 'CHUGOKU/SHIKOKU', businessUnit: 'CDG' },
  'cdg-3': { name: 'DA1', businessUnit: 'LSG' },
  'cdg-4': { name: 'DA2', businessUnit: 'LSG' },
  'cdg-5': { name: 'DAW', businessUnit: 'LSG' },
  'cdg-6': { name: 'FAS', businessUnit: 'CDG' },
  'cdg-7': { name: 'FAS', businessUnit: 'LSG' },
  'cdg-8': { name: 'FMM(CDG)', businessUnit: 'CDG' },
  'cdg-9': { name: 'FMM(LSG)', businessUnit: 'LSG' },
  'cdg-10': { name: 'HOKKAIDO/TOHOKU', businessUnit: 'CDG' },
  'cdg-11': { name: 'IA', businessUnit: 'LSG' },
  'cdg-12': { name: 'KINKI', businessUnit: 'CDG' },
  'cdg-13': { name: 'KYUSHU/OKINAWA', businessUnit: 'CDG' },
  'cdg-14': { name: 'NATIONAL ACCOUNT', businessUnit: 'CDG/LSG' },
  'cdg-15': { name: 'PCD', businessUnit: 'LSG' },
  'cdg-16': { name: 'PS', businessUnit: 'LSG' },
  'cdg-17': { name: 'RAQA', businessUnit: 'CDG/LSG' },
  'cdg-18': { name: 'SHUTO1D', businessUnit: 'CDG' },
  'cdg-19': { name: 'SHUTO2D', businessUnit: 'CDG' },
  'cdg-20': { name: 'SP', businessUnit: 'CDG' },
  'cdg-21': { name: 'Sales Manager', businessUnit: 'CDG' },
  'cdg-22': { name: 'TECHNICAL SERVICE', businessUnit: 'CDG/LSG' },
  'cdg-23': { name: 'TOKAI/HOKURIKU', businessUnit: 'CDG' },
};

function rowBuMatchesGroupBu(rowBu: 'CDG' | 'LSG', groupBu: string): boolean {
  if (groupBu === 'CDG/LSG') return true;
  return groupBu === rowBu;
}

/** Strip @, collapse spaces, uppercase; remove trailing (CDG)/(LSG)/(CDG/LSG) parentheticals */
export function normalizeTeamLabel(raw: string): string {
  let t = raw
    .replace(/^@/, '')
    .replace(/\u3000/g, ' ')
    .replace(/\uFF0F|\u2044/g, '/') // fullwidth / fraction slash → ASCII (Excel)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  t = t.replace(/\s*\(CDG\/LSG\)\s*$/i, '');
  t = t.replace(/\s*\(CDG\)\s*$/i, '');
  t = t.replace(/\s*\(LSG\)\s*$/i, '');
  return t.trim();
}

/**
 * Resolve Team Name + row business unit to requester_groups.code, or null with candidate team labels for errors.
 */
export function resolveTeamToRequesterGroupCode(
  teamRaw: string,
  rowBu: 'CDG' | 'LSG'
): { code: string | null; matchedKey: string | null } {
  const team = normalizeTeamLabel(teamRaw);
  if (!team) return { code: null, matchedKey: null };

  const candidates: string[] = [];

  for (const [key, code] of Object.entries(TEAM_BU_TO_REQUESTER_GROUP_CODE)) {
    const [teamPart, buPart] = key.split('|');
    const meta = REQUESTER_GROUP_META[code];
    if (!meta) continue;
    const teamNorm = normalizeTeamLabel(teamPart);
    if (teamNorm !== team) continue;
    if (!rowBuMatchesGroupBu(rowBu, buPart)) continue;
    if (!rowBuMatchesGroupBu(rowBu, meta.businessUnit)) continue;
    candidates.push(key);
  }

  if (candidates.length >= 1) {
    const preferred = candidates.find((k) => {
      const parts = k.split('|');
      const buPart = parts[parts.length - 1];
      return buPart === rowBu;
    });
    const k = preferred ?? candidates[0]!;
    return { code: TEAM_BU_TO_REQUESTER_GROUP_CODE[k]!, matchedKey: k };
  }

  // Alias: "NATIONAL ACCOUNT(LSG)" → map uses NATIONAL ACCOUNT|CDG/LSG
  if (team.includes('NATIONAL ACCOUNT')) {
    const k = 'NATIONAL ACCOUNT|CDG/LSG';
    const code = TEAM_BU_TO_REQUESTER_GROUP_CODE[k];
    if (code && rowBuMatchesGroupBu(rowBu, REQUESTER_GROUP_META[code]!.businessUnit)) {
      return { code, matchedKey: k };
    }
  }

  return { code: null, matchedKey: null };
}

/**
 * Normalize labels from user-list Excel (UPDATE / Requester Group columns):
 * map common variants to team keys used in TEAM_BU_TO_REQUESTER_GROUP_CODE.
 */
export function normalizeUserImportGroupLabel(raw: string): string {
  let u = String(raw ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!u) return '';
  const up = u.toUpperCase();
  if (/^NA$/i.test(u) || /^N\/A$/i.test(u) || /^NAN$/i.test(u)) return '';
  if (up.includes('RAQA MANAGER') && !up.includes('GLOBAL')) return 'RAQA';
  if (up === 'GLOBAL RAQA' || up.startsWith('GLOBAL RAQA ') || up === 'GLOBAL RAQA MANAGER') return 'RAQA';
  return normalizeTeamLabel(u);
}

/** Order of CDG/LSG to try when resolving a row (from LSG/CDG column). */
export function parseLsgCdgToTryOrder(lsgCdgRaw: string): ('CDG' | 'LSG')[] {
  const u = String(lsgCdgRaw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (u === 'CDG') return ['CDG'];
  if (u === 'LSG') return ['LSG'];
  if (u.includes('CDG') && u.includes('LSG')) return ['LSG', 'CDG'];
  if (!u) return ['LSG', 'CDG'];
  return ['LSG', 'CDG'];
}

/**
 * Resolve human-readable requester group (UPDATE / Requester Group) + LSG/CDG column to requester_groups.code.
 */
export function resolveUserImportRequesterGroupLabel(
  labelRaw: string,
  lsgCdgRaw: string
): { code: string | null; matchedKey: string | null } {
  const label = normalizeUserImportGroupLabel(labelRaw);
  if (!label) {
    return { code: null, matchedKey: null };
  }
  const tryBus = parseLsgCdgToTryOrder(lsgCdgRaw);
  for (const rowBu of tryBus) {
    const r = resolveTeamToRequesterGroupCode(label, rowBu);
    if (r.code) return r;
  }
  const compact = label.replace(/\s*\(\s*CDG\s*\)\s*$/i, '').replace(/\s*\(\s*LSG\s*\)\s*$/i, '').trim();
  if (compact !== label) {
    for (const rowBu of tryBus) {
      const r = resolveTeamToRequesterGroupCode(compact, rowBu);
      if (r.code) return r;
    }
  }
  return { code: null, matchedKey: null };
}

/** For validation errors when label did not resolve */
export function suggestUserImportGroupHints(lsgCdgRaw: string, limit = 12): string[] {
  const tryBus = parseLsgCdgToTryOrder(lsgCdgRaw);
  const out = new Set<string>();
  for (const rowBu of tryBus) {
    for (const x of suggestTeamNamesForBu(rowBu, limit)) {
      out.add(x);
      if (out.size >= limit) return [...out];
    }
  }
  return [...out].slice(0, limit);
}

/** For error messages: a few team names that map for this BU */
export function suggestTeamNamesForBu(rowBu: 'CDG' | 'LSG', limit = 8): string[] {
  const out: string[] = [];
  for (const [key] of Object.entries(TEAM_BU_TO_REQUESTER_GROUP_CODE)) {
    const [teamPart, buKey] = key.split('|');
    const code = TEAM_BU_TO_REQUESTER_GROUP_CODE[key]!;
    const meta = REQUESTER_GROUP_META[code];
    if (!meta || !rowBuMatchesGroupBu(rowBu, meta.businessUnit)) continue;
    if (!rowBuMatchesGroupBu(rowBu, buKey)) continue;
    const label = normalizeTeamLabel(teamPart);
    if (!out.includes(label)) out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}
