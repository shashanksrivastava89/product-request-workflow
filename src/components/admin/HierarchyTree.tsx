/**
 * Hierarchy Tree Component
 * Displays interactive tree visualization of organizational hierarchy
 */

import { useState, useEffect } from 'react';
import { adminApi } from '../../services/api.service';

export default function HierarchyTree() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tree, setTree] = useState<any>(null);
    const [businessUnit, setBusinessUnit] = useState<'CDG' | 'LSG' | ''>('');
    const [rootUserId, setRootUserId] = useState<string>('');

    useEffect(() => {
        if (businessUnit || rootUserId) {
            loadTree();
        }
    }, [businessUnit, rootUserId]);

    const loadTree = async () => {
        setLoading(true);
        setError(null);
        try {
            const params: any = {};
            if (businessUnit) params.businessUnit = businessUnit;
            if (rootUserId) params.rootUserId = rootUserId;

            const response = await adminApi.getHierarchyTree(params);
            setTree(response.tree);
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || 'Failed to load hierarchy tree');
        } finally {
            setLoading(false);
        }
    };

    const renderNode = (node: any, level: number = 0): JSX.Element => {
        const indent = level * 40;
        return (
            <div key={node.id} className="mb-4">
                <div
                    className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow"
                    style={{ marginLeft: `${indent}px` }}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-semibold text-gray-900">{node.name}</div>
                            <div className="text-sm text-gray-500">{node.email}</div>
                            <div className="text-xs text-gray-400 mt-1">
                                {node.role} {node.businessUnit && `• ${node.businessUnit}`}
                            </div>
                        </div>
                    </div>
                </div>
                {node.subordinates && node.subordinates.length > 0 && (
                    <div className="mt-2">
                        {node.subordinates.map((sub: any) => renderNode(sub, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="bg-white rounded-lg shadow p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Business Unit
                        </label>
                        <select
                            value={businessUnit}
                            onChange={(e) => setBusinessUnit(e.target.value as 'CDG' | 'LSG' | '')}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#00A651] focus:border-[#00A651]"
                        >
                            <option value="">All</option>
                            <option value="CDG">CDG</option>
                            <option value="LSG">LSG</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Root User ID (Optional)
                        </label>
                        <input
                            type="text"
                            value={rootUserId}
                            onChange={(e) => setRootUserId(e.target.value)}
                            placeholder="Enter user ID to start tree from..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#00A651] focus:border-[#00A651]"
                        />
                    </div>
                </div>
                <div className="mt-4">
                    <button
                        onClick={loadTree}
                        disabled={loading}
                        className="px-4 py-2 bg-[#00A651] text-white rounded-md hover:bg-[#008844] focus:outline-none focus:ring-2 focus:ring-[#00A651] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Loading...' : 'Load Tree'}
                    </button>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {error}
                </div>
            )}

            {/* Tree Visualization */}
            <div className="bg-white rounded-lg shadow p-6">
                {loading ? (
                    <div className="text-center py-12 text-gray-500">Loading tree...</div>
                ) : !tree ? (
                    <div className="text-center py-12 text-gray-500">
                        Select filters and click "Load Tree" to view hierarchy
                    </div>
                ) : tree.root ? (
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Hierarchy Tree</h3>
                        {renderNode(tree.root)}
                    </div>
                ) : (
                    <div className="text-center py-12 text-gray-500">
                        {tree.message || 'No root user found'}
                    </div>
                )}
            </div>
        </div>
    );
}
