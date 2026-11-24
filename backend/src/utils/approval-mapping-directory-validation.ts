import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';

/** Bulk import / one-off migration: set `APPROVAL_MAPPING_SKIP_DIRECTORY_VALIDATION=true` in env. */
export function isApprovalMappingDirectoryValidationSkipped(): boolean {
  return process.env.APPROVAL_MAPPING_SKIP_DIRECTORY_VALIDATION === 'true';
}

/** Requester on the mapping row must exist in Requesters master (active). */
export async function assertRequesterInDirectory(
  prisma: PrismaClient,
  requesterNameNormalized: string
): Promise<void> {
  if (isApprovalMappingDirectoryValidationSkipped()) return;
  const hit = await prisma.requester.findFirst({
    where: {
      name: { equals: requesterNameNormalized, mode: 'insensitive' },
      isActive: true,
    },
  });
  if (!hit) {
    throw new AppError(
      `Requester "${requesterNameNormalized}" is not in the Requesters directory (or is inactive). Add them under Data Management → Requesters first.`,
      400
    );
  }
}

/** Approver slots store display names; each non-empty value must match an active User by name. */
export async function assertApproverUsersExist(
  prisma: PrismaClient,
  fields: Array<{ label: string; normalizedName: string | null | undefined }>
): Promise<void> {
  if (isApprovalMappingDirectoryValidationSkipped()) return;
  for (const { label, normalizedName } of fields) {
    if (normalizedName == null || normalizedName === '') continue;
    const u = await prisma.user.findFirst({
      where: {
        name: { equals: normalizedName, mode: 'insensitive' },
        isActive: true,
      },
    });
    if (!u) {
      throw new AppError(
        `${label}: no active user matches "${normalizedName}". Use a name that exists in the Users directory.`,
        400
      );
    }
  }
}
