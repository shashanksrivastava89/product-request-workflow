/**
 * Admin: all submitted requests with filters, sample and return (source: sales_forms)
 */

import { SubmittedRequestsListPanel } from '../../components/submittedRequests/SubmittedRequestsListPanel';

export default function SubmittedRequestsPage() {
  return (
    <SubmittedRequestsListPanel
      // One combined list, sample and return together, filtered by Request Type — which is what
      // Vidhi was shown and accepted on 2 Sep. Without this it defaults to `sample` and hides
      // returns from the page and RETURN from its own filter.
      scope="all"
      title="Submitted requests"
      description="All submitted requests in the system, sample and return alike. Use filters to narrow by status, type, business unit, or submission date."
    />
  );
}
