/**
 * Status Badge Component
 * Displays status with enhanced color coding and modern design
 * Approved status shows as icon only
 */

interface StatusBadgeProps {
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
}

// Checkmark Icon for Approved status
const CheckmarkIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
    <svg
        className={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M5 13l4 4L19 7"
        />
    </svg>
);

export default function StatusBadge({ status }: StatusBadgeProps) {
    // For APPROVED status, show only icon
    if (status === 'APPROVED') {
        return (
            <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-r from-[#00A651]/10 to-[#00A651]/5 border-2 border-[#00A651] text-[#00A651] shadow-sm"
                title="Approved"
            >
                <CheckmarkIcon className="w-4 h-4" />
            </span>
        );
    }

    // For other statuses, show badge with text
    const getStatusConfig = () => {
        switch (status) {
            case 'PENDING_APPROVAL':
                return {
                    label: 'Pending Approval',
                    bgColor: 'bg-gradient-to-r from-yellow-50 to-yellow-100/50',
                    textColor: 'text-yellow-800',
                    borderColor: 'border-yellow-300',
                    dotColor: 'bg-yellow-500',
                };
            case 'REJECTED':
                return {
                    label: 'Rejected',
                    bgColor: 'bg-gradient-to-r from-red-50 to-red-100/50',
                    textColor: 'text-red-800',
                    borderColor: 'border-red-300',
                    dotColor: 'bg-red-500',
                };
            default:
                return {
                    label: status,
                    bgColor: 'bg-gradient-to-r from-gray-50 to-gray-100/50',
                    textColor: 'text-gray-800',
                    borderColor: 'border-gray-300',
                    dotColor: 'bg-gray-500',
                };
        }
    };

    const config = getStatusConfig();

    return (
        <span
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${config.bgColor} ${config.textColor} ${config.borderColor} shadow-sm`}
        >
            <span className={`w-2 h-2 rounded-full ${config.dotColor}`}></span>
            {config.label}
        </span>
    );
}
