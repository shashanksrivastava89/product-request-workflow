/**
 * What "a product a requester can select" means, in one place.
 *
 * The Sample Ordering and Return Goods pickers, the exact lookup behind them, and the product master
 * export all read this, so the export is exactly what the pickers offer (8 Oct 2026: "1 to 1").
 *
 * The list-price clause is a backstop. The master sync never writes a list price of 0 or 1 ("do not
 * use this code", 27 Aug 2026), the admin screens refuse one and the 8 Oct migration removed the ones
 * already stored, so no active product should carry one; if one ever does, it still never reaches a
 * request or an export.
 */

import { Prisma } from '@prisma/client';

/** List prices that mean "do not use this code". */
export const DO_NOT_USE_LIST_PRICES = [0, 1];

export function isDoNotUseListPrice(listPrice: unknown): boolean {
  const n = Number(listPrice);
  return Number.isFinite(n) && DO_NOT_USE_LIST_PRICES.includes(n);
}

export function selectableProductWhere(businessGroup?: string): Prisma.ProductCatalogWhereInput {
  return {
    ...(businessGroup ? { businessGroup } : {}),
    isActive: true,
    status: 'APPROVED',
    listPrice: { notIn: DO_NOT_USE_LIST_PRICES },
  };
}

/**
 * Search terms folded the way the stored search key is: NFKC (half-width katakana to full-width,
 * full-width letters and digits to ASCII) and lower case, split on whitespace. Matching a folded term
 * against searchText finds ﾘｸｲﾁｪｯｸ and リクイチェック alike.
 */
export function searchTokens(search: string | undefined | null): string[] {
  return String(search ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** One AND clause per token, each a substring match on the folded search key. */
export function searchTextWhere(search: string | undefined | null): Prisma.ProductCatalogWhereInput[] {
  return searchTokens(search).map((t) => ({ searchText: { contains: t } }));
}
