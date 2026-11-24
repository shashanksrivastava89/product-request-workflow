/**
 * Validation Summary Component
 * Displays all validation issues before saving
 */

import { useState } from 'react';

interface ValidationIssue {
    field: string;
    type: string;
    message: string;
    severity?: 'ERROR' | 'WARNING';
}

interface ValidationSummaryProps {
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    className?: string;
}

export default function ValidationSummary({ errors, warnings, className = '' }: ValidationSummaryProps) {
    const [expanded, setExpanded] = useState(true);

    if (errors.length === 0 && warnings.length === 0) {
        return null;
    }

    const errorCount = errors.length;
    const warningCount = warnings.length;

    return (
        <div className={`bg-white border rounded-lg shadow-sm ${className}`}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {errorCount > 0 ? (
                        <span className="text-red-600">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </span>
                    ) : (
                        <span className="text-yellow-600">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </span>
                    )}
                    <span className="font-semibold text-sm text-gray-900">
                        Validation Summary
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    {errorCount > 0 && (
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded">
                            {errorCount} Error{errorCount !== 1 ? 's' : ''}
                        </span>
                    )}
                    {warningCount > 0 && (
                        <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
                            {warningCount} Warning{warningCount !== 1 ? 's' : ''}
                        </span>
                    )}
                    <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {expanded && (
                <div className="px-4 pb-4 space-y-3">
                    {errorCount > 0 && (
                        <div>
                            <div className="text-xs font-semibold text-red-600 mb-2">
                                ❌ Errors ({errorCount}) - Must fix before saving:
                            </div>
                            <ul className="space-y-1.5">
                                {errors.map((error, index) => (
                                    <li key={index} className="text-sm text-gray-700 pl-4 relative">
                                        <span className="absolute left-0 text-red-500">•</span>
                                        <span className="font-medium text-gray-900">{getFieldLabel(error.field)}:</span>{' '}
                                        {error.message}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {warningCount > 0 && (
                        <div>
                            <div className="text-xs font-semibold text-yellow-600 mb-2">
                                ⚠️ Warnings ({warningCount}) - Can save but review:
                            </div>
                            <ul className="space-y-1.5">
                                {warnings.map((warning, index) => (
                                    <li key={index} className="text-sm text-gray-700 pl-4 relative">
                                        <span className="absolute left-0 text-yellow-500">•</span>
                                        <span className="font-medium text-gray-900">{getFieldLabel(warning.field)}:</span>{' '}
                                        {warning.message}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function getFieldLabel(field: string): string {
    const labels: Record<string, string> = {
        salesManagerId: 'Sales Manager',
        districtSalesManagerId: 'District Sales Manager',
        nationalSalesManagerId: 'National Sales Manager',
        localFinanceControllerId: 'Local Finance Controller',
        directorCommercialManagerId: 'Director Commercial Manager',
        technicalManagerId: 'Technical Manager',
        nationalTSManagerId: 'National TS Manager',
        general: 'General',
    };
    return labels[field] || field;
}
