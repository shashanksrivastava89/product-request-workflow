/**
 * /approvals/inbox and /return/inbox: row-by-row approver inbox for normal roles, table-based super
 * approver inbox for SUPER_APPROVER. `scope` picks which section's requests are listed.
 */

import ApprovalInbox from '../pages/ApprovalInbox';
import SuperApproverInbox from '../pages/SuperApproverInbox';
import { useAuth } from '../providers/AuthContext';
import { hasSuperApproverAccess } from '../utils/user-roles';
import type { RequestSectionScope } from '../constants/sectionTheme';

export default function InboxRoute({ scope = 'sample' }: { scope?: RequestSectionScope }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-[#0066CC]" />
      </div>
    );
  }
  if (hasSuperApproverAccess(user?.role, user?.isSuperApprover)) {
    return <SuperApproverInbox scope={scope} />;
  }
  return <ApprovalInbox scope={scope} />;
}
