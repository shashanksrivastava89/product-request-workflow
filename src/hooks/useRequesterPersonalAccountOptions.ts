import { useCallback, useMemo } from 'react';
import {
  staticDataApi,
  type RequesterPersonalAccount,
} from '../services/api.service';

export const PERSONAL_ACCOUNT_SUBLABEL = 'Personal (requester directory)';

export type PersonalAccountSelectOption = {
  value: string;
  label: string;
  sub: string;
};

export function mapPersonalAccountsToSelectOptions(
  accounts: RequesterPersonalAccount[]
): PersonalAccountSelectOption[] {
  return accounts.map((a) => ({
    value: a.code,
    label: `${a.code} — ${a.name}`,
    sub: PERSONAL_ACCOUNT_SUBLABEL,
  }));
}

const emptyResult = { options: [] as PersonalAccountSelectOption[], total: 0, hasMore: false };

/**
 * Async loaders for SearchSelect: search all active requesters (code starts with 9) by name or code.
 * Requires formType (ZSAM / ZNC / …). User must type to search (min 1 character).
 */
export function useRequesterPersonalAccountOptions(formType: string | undefined) {
  const loadSearch = useCallback(
    async (search: string) => {
      const q = search.trim();
      if (!formType?.trim() || q.length < 1) return emptyResult;
      try {
        const res = await staticDataApi.getRequesterPersonalAccounts({
          formType,
          limit: 50,
          offset: 0,
          search: q,
        });
        return {
          options: mapPersonalAccountsToSelectOptions(res.accounts),
          total: res.total,
          hasMore: res.hasMore,
        };
      } catch (error) {
        console.error('Failed to search personal accounts:', error);
        return emptyResult;
      }
    },
    [formType]
  );

  const resolveByCode = useCallback(
    async (code: string): Promise<RequesterPersonalAccount | null> => {
      if (!formType?.trim() || !code.trim()) return null;
      try {
        const res = await staticDataApi.getRequesterPersonalAccounts({
          formType,
          limit: 100,
          search: code.trim(),
        });
        const normalized = code.trim().replace(/^0+(?=\d)/, '');
        return (
          res.accounts.find((a) => a.code === code.trim() || a.code === normalized) ?? null
        );
      } catch (error) {
        console.error('Failed to resolve personal account:', error);
        return null;
      }
    },
    [formType]
  );

  const asyncOptions = useMemo(
    () => ({
      load: loadSearch,
    }),
    [loadSearch]
  );

  return {
    loadSearch,
    resolveByCode,
    asyncOptions,
  };
}
