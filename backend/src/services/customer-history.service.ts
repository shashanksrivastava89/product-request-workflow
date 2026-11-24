/**
 * Customer change history tracking (shared by customer management and reconciliation).
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export async function trackCustomerChange(
  customerId: string,
  changeType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE',
  changedBy: string,
  oldData: any = null,
  newData: any = null,
  changeReason?: string
): Promise<void> {
  try {
    const lastVersion = await prisma.customerHistory.findFirst({
      where: { customerId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const nextVersion = (lastVersion?.version || 0) + 1;

    let fieldChanges: any[] = [];
    if (changeType === 'UPDATE' && oldData && newData) {
      const fields = [
        'businessGroup',
        'firstDigit',
        'code',
        'sapCode',
        'nameJp',
        'nameEn',
        'postalCode',
        'prefecture',
        'address',
        'phone',
        'isActive',
      ];

      for (const field of fields) {
        const oldValue = oldData[field];
        const newValue = newData[field];
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
      snapshot = await prisma.customer.findUnique({
        where: { id: customerId },
      });
    }

    if (!snapshot) {
      throw new Error('Cannot create history: customer not found');
    }

    await prisma.customerHistory.create({
      data: {
        customerId,
        version: nextVersion,
        businessGroup: snapshot.businessGroup,
        firstDigit: snapshot.firstDigit,
        code: snapshot.code,
        sapCode: snapshot.sapCode,
        nameJp: snapshot.nameJp,
        nameEn: snapshot.nameEn,
        postalCode: snapshot.postalCode,
        prefecture: snapshot.prefecture,
        address: snapshot.address,
        phone: snapshot.phone,
        isActive: snapshot.isActive,
        changedBy,
        changeType,
        changeReason: changeReason || null,
        fieldChanges: fieldChanges.length > 0 ? fieldChanges : Prisma.JsonNull,
      },
    });
  } catch (error) {
    console.error('Error tracking customer change:', error);
  }
}
