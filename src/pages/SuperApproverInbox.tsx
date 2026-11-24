/**
 * Super approver: same list + detail as Data Management -> Submitted requests (not the row-by-row
 * approver inbox). `scope` keeps the Return section's copy showing returns only.
 */

import { SubmittedRequestsListPanel } from '../components/submittedRequests/SubmittedRequestsListPanel';
import type { RequestSectionScope } from '../constants/sectionTheme';

export default function SuperApproverInbox({ scope = 'sample' }: { scope?: RequestSectionScope }) {
  const isReturn = scope === 'return';
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <SubmittedRequestsListPanel
          scope={scope}
          title={isReturn ? 'Return super approver inbox' : 'Super approver inbox'}
          description={
            isReturn
              ? 'All return / credit requests. Filter the list, then View to open details and approve or reject the current step.'
              : 'All sample requests (same data as Data Management -> Submitted requests). Filter the list, then View to open details and approve or reject the current step.'
          }
        />
      </div>
    </div>
  );
}
