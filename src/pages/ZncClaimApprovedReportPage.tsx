import { Navigate } from 'react-router-dom';
import { SubmittedRequestsListPanel } from '../components/submittedRequests/SubmittedRequestsListPanel';
import { useAuth } from '../providers/AuthContext';
import { canViewZncClaimApprovedReport } from '../utils/znc-claim-approved-report.util';

export default function ZncClaimApprovedReportPage() {
  const { user } = useAuth();

  if (!canViewZncClaimApprovedReport(user?.email)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <SubmittedRequestsListPanel
        mode="znc-claim-approved"
        title="Approved ZNC Claim Report"
        description="Read-only list of all approved ZNC Claim requests. 承認済みクレーム対応一覧"
      />
    </div>
  );
}
