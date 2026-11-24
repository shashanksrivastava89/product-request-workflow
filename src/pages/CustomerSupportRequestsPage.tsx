import { useSearchParams } from 'react-router-dom';
import { SubmittedRequestsListPanel } from '../components/submittedRequests/SubmittedRequestsListPanel';

export default function CustomerSupportRequestsPage() {
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') ?? '';
  const initialStatusGroup =
    searchParams.get('statusGroup') === 'awaiting' || searchParams.get('statusGroup') === 'closed'
      ? (searchParams.get('statusGroup') as 'awaiting' | 'closed')
      : '';

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <SubmittedRequestsListPanel
        mode="support"
        title="Sample requests"
        description="Read-only view of all submitted sample requests. Filter by status, business unit, type, or submission date."
        initialStatus={initialStatus}
        initialStatusGroup={initialStatusGroup}
      />
    </div>
  );
}
