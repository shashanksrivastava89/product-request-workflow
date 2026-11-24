/**
 * Validation Message Component
 * Displays validation feedback for form fields
 */

interface ValidationMessageProps {
    message?: string;
    severity?: 'ERROR' | 'WARNING' | 'SUCCESS';
    className?: string;
}

export default function ValidationMessage({ message, severity = 'ERROR', className = '' }: ValidationMessageProps) {
    if (!message) return null;

    const severityConfig = {
        ERROR: {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            ),
            color: 'text-red-600',
            bg: 'bg-red-50',
            border: 'border-red-200',
        },
        WARNING: {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            ),
            color: 'text-yellow-600',
            bg: 'bg-yellow-50',
            border: 'border-yellow-200',
        },
        SUCCESS: {
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            ),
            color: 'text-green-600',
            bg: 'bg-green-50',
            border: 'border-green-200',
        },
    };

    const config = severityConfig[severity];

    return (
        <div className={`mt-1.5 flex items-start gap-1.5 ${config.bg} ${config.border} border rounded px-2 py-1.5 ${className}`}>
            <span className={`${config.color} flex-shrink-0 mt-0.5`}>{config.icon}</span>
            <span className={`text-xs ${config.color} leading-relaxed`}>{message}</span>
        </div>
    );
}
