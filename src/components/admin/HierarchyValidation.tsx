/**
 * Hierarchy Validation Component
 * Displays validation results for all hierarchies
 */

import { useState, useEffect } from 'react';
import { adminApi } from '../../services/api.service';

interface ValidationIssue {
    type: 'MISSING_APPROVER' | 'CIRCULAR_REFERENCE' | 'INVALID_ROLE' | 'BUSINESS_UNIT_MISMATCH';
    userId: string;
    userName: string;
    field?: string;
    approverName?: string;
    approverId?: string;
    approverRole?: string;
    expectedRole?: string;
    severity: 'ERROR' | 'WARNING';
    userId2?: string;
    userName2?: string;
}

export default function HierarchyValidation() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [validation, setValidation] = useState<{
        totalUsers: number;
        validUsers: number;
        issues: ValidationIssue[];
    } | null>(null);
    const [severityFilter, setSeverityFilter] = useState<'ALL' | 'ERROR' | 'WARNING'>('ALL');

    useEffect(() => {
        loadValidation();
    }, []);

    const loadValidation = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await adminApi.validateHierarchies();
            setValidation(response.validation);
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Failed to validate hierarchies');
        } finally {
            setLoading(false);
        }
    };

    const getIssueTypeLabel = (type: string) => {
        switch (type) {
            case 'MISSING_APPROVER':
                return 'Missing Approver';
            case 'CIRCULAR_REFERENCE':
                return 'Circular Reference';
            case 'INVALID_ROLE':
                return 'Invalid Role';
            case 'BUSINESS_UNIT_MISMATCH':
                return 'Business Unit Mismatch';
            default:
                return type;
        }
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'ERROR':
                return 'bg-red-100 text-red-800 border-red-300';
            case 'WARNING':
                return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-300';
        }
    };

    const filteredIssues = validation?.issues.filter(
        (issue) => severityFilter === 'ALL' || issue.severity === severityFilter
    ) || [];

    return (
        <div className="space-y-4">
            {/* Header Actions */}
            <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Hierarchy Validation</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        Check for missing approvers, circular references, and other hierarchy issues
                    </p>
                </div>
                <button
                    onClick={loadValidation}
                    disabled={loading}
                    className="px-4 py-2 bg-[#00A651] text-white rounded-md hover:bg-[#008844] focus:outline-none focus:ring-2 focus:ring-[#00A651] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? 'Validating...' : 'Run Validation'}
                </button>
            </div>

            {/* Error Message */}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {error}
                </div>
            )}

            {/* Summary */}
            {validation && (
                <div className="bg-white rounded-lg shadow p-6">
                    <h3 className="text-md font-semibold text-gray-900 mb-4">Summary</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="text-sm text-gray-600">Total Users</div>
                            <div className="text-2xl font-bold text-gray-900">{validation.totalUsers}</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-4">
                            <div className="text-sm text-gray-600">Valid Users</div>
                            <div className="text-2xl font-bold text-[#00A651]">{validation.validUsers}</div>
                        </div>
                        <div className="bg-red-50 rounded-lg p-4">
                            <div className="text-sm text-gray-600">Issues Found</div>
                            <div className="text-2xl font-bold text-red-600">
                                {validation.issues.filter((i) => i.severity === 'ERROR').length}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Issues Table */}
            {validation && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    {/* Filter */}
                    <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                        <h3 className="text-md font-semibold text-gray-900">Issues</h3>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setSeverityFilter('ALL')}
                                className={`px-3 py-1 rounded text-sm ${
                                    severityFilter === 'ALL'
                                        ? 'bg-[#00A651] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setSeverityFilter('ERROR')}
                                className={`px-3 py-1 rounded text-sm ${
                                    severityFilter === 'ERROR'
                                        ? 'bg-red-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Errors ({validation.issues.filter((i) => i.severity === 'ERROR').length})
                            </button>
                            <button
                                onClick={() => setSeverityFilter('WARNING')}
                                className={`px-3 py-1 rounded text-sm ${
                                    severityFilter === 'WARNING'
                                        ? 'bg-yellow-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Warnings ({validation.issues.filter((i) => i.severity === 'WARNING').length})
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="px-6 py-12 text-center text-gray-500">Validating...</div>
                    ) : filteredIssues.length === 0 ? (
                        <div className="px-6 py-12 text-center text-gray-500">
                            {validation.issues.length === 0
                                ? '✅ No issues found! All hierarchies are valid.'
                                : 'No issues match the selected filter.'}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Severity
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Type
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            User
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Field
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Description
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {filteredIssues.map((issue, index) => (
                                        <tr key={index} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span
                                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getSeverityColor(
                                                        issue.severity
                                                    )}`}
                                                >
                                                    {issue.severity}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {getIssueTypeLabel(issue.type)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {issue.userName}
                                                {issue.userName2 && ` ↔ ${issue.userName2}`}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {issue.field || '-'}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-900">
                                                {issue.type === 'MISSING_APPROVER' && (
                                                    <span>
                                                        Approver "{issue.approverName || issue.approverId}" not found
                                                        {issue.approverName && ' or is inactive'}
                                                    </span>
                                                )}
                                                {issue.type === 'CIRCULAR_REFERENCE' && (
                                                    <span>
                                                        Circular reference detected between {issue.userName} and{' '}
                                                        {issue.userName2}
                                                    </span>
                                                )}
                                                {issue.type === 'INVALID_ROLE' && (
                                                    <span>
                                                        Approver has role "{issue.approverRole}" but expected "
                                                        {issue.expectedRole}"
                                                    </span>
                                                )}
                                                {issue.type === 'BUSINESS_UNIT_MISMATCH' && (
                                                    <span>Business unit mismatch</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
