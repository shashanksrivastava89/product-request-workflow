import { prismaService } from './prisma.service';

/** All approved ZNC Claim requests (read-only report for allowlisted users). */
export async function listApprovedZncClaimReportForms(options: {
  businessUnit?: string;
  search?: string;
  submittedFrom?: Date;
  submittedTo?: Date;
  skip?: number;
  take?: number;
}): Promise<{ forms: Awaited<ReturnType<typeof prismaService.findManyFormsAdmin>>['forms']; total: number }> {
  return prismaService.findManyFormsAdmin({
    status: 'APPROVED',
    formType: 'ZNCCLAIM',
    businessUnit: options.businessUnit,
    search: options.search,
    submittedFrom: options.submittedFrom,
    submittedTo: options.submittedTo,
    skip: options.skip,
    take: options.take,
    orderBy: 'completedAt',
  });
}

export async function getApprovedZncClaimReportSummary(options?: {
  businessUnit?: string;
}): Promise<{ total: number }> {
  const { total } = await listApprovedZncClaimReportForms({
    businessUnit: options?.businessUnit,
    skip: 0,
    take: 1,
  });
  return { total };
}

export function canReadApprovedZncClaimReportForm(
  form: { formType: string; status: string }
): boolean {
  return form.formType === 'ZNCCLAIM' && form.status === 'APPROVED';
}
