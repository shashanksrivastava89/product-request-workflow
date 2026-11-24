/**
 * Product change history tracking (shared by product management and reconciliation).
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Prisma hands prices back as Decimal objects, and two Decimals are never `===` even when equal, so
 * every admin edit used to log a phantom price change. Compare the plain value instead.
 */
function plain(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null && 'toNumber' in (value as object)) {
    return Number((value as { toNumber: () => number }).toNumber());
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

export async function trackProductChange(
  productId: string,
  changeType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE',
  changedBy: string,
  oldData: any = null,
  newData: any = null,
  changeReason?: string
): Promise<void> {
  try {
    const lastVersion = await prisma.productHistory.findFirst({
      where: { productId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const nextVersion = (lastVersion?.version || 0) + 1;

    let fieldChanges: any[] = [];
    if (changeType === 'UPDATE' && oldData && newData) {
      const fields = [
        'businessGroup',
        'code',
        'sapCode',
        'name',
        'productNameLocal',
        'price',
        'listPrice',
        'division',
        'statisticsGroup',
        'priceGroup',
        'isActive',
      ];

      for (const field of fields) {
        const oldValue = plain(oldData[field]);
        const newValue = plain(newData[field]);
        if (oldValue !== newValue) {
          fieldChanges.push({
            field,
            oldValue: oldValue ?? null,
            newValue: newValue ?? null,
          });
        }
      }
    }

    let snapshot = newData;
    if (!snapshot) {
      snapshot = await prisma.productCatalog.findUnique({
        where: { id: productId },
      });
    }

    if (!snapshot) {
      throw new Error('Cannot create history: product not found');
    }

    await prisma.productHistory.create({
      data: {
        productId,
        version: nextVersion,
        businessGroup: snapshot.businessGroup,
        code: snapshot.code,
        sapCode: snapshot.sapCode,
        name: snapshot.name,
        productNameLocal: snapshot.productNameLocal,
        price: snapshot.price,
        listPrice: snapshot.listPrice,
        division: snapshot.division,
        statisticsGroup: snapshot.statisticsGroup,
        priceGroup: snapshot.priceGroup,
        isActive: snapshot.isActive,
        changedBy,
        changeType,
        changeReason: changeReason || null,
        fieldChanges: fieldChanges.length > 0 ? fieldChanges : Prisma.JsonNull,
      },
    });
  } catch (error) {
    console.error('Error tracking product change:', error);
  }
}
