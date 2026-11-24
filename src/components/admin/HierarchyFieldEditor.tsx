/**
 * Hierarchy Field Editor Component
 * Reusable component for editing approver fields with searchable dropdown
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { filterUsersByRole, validateApproverRole, checkBusinessUnitCompatibility } from '../../services/hierarchy-validation.service';
import ValidationMessage from './ValidationMessage';

interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    businessUnit: string | null;
    isActive?: boolean;
}

interface HierarchyFieldEditorProps {
    label: string;
    field: string;
    value: string | null;
    currentValue: { id: string; name: string; email: string } | null;
    onSelect: (userId: string | null) => void;
    onSearch: (term: string) => void;
    filteredUsers: User[];
    showDropdown: boolean;
    onToggleDropdown: () => void;
    error?: string;
    loading?: boolean;
    disabled?: boolean;
    currentUser?: { id: string; businessUnit: string | null };
    validationMessage?: string;
    validationSeverity?: 'ERROR' | 'WARNING' | 'SUCCESS';
}

export default function HierarchyFieldEditor({
    label,
    field,
    value,
    currentValue,
    onSelect,
    onSearch,
    filteredUsers,
    showDropdown,
    onToggleDropdown,
    error,
    loading = false,
    disabled = false,
    currentUser,
    validationMessage,
    validationSeverity,
}: HierarchyFieldEditorProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter users by role for this field
    const eligibleUsers = useMemo(() => {
        return filterUsersByRole(filteredUsers, field);
    }, [filteredUsers, field]);

    const selectedUser = eligibleUsers.find((u) => u.id === value);

    // Get validation state for selected user
    const validation = useMemo(() => {
        if (!selectedUser) {
            return { valid: true, message: undefined, severity: 'SUCCESS' as const };
        }

        const roleValidation = validateApproverRole(selectedUser, field);
        if (!roleValidation.valid) {
            return { valid: false, message: roleValidation.message, severity: roleValidation.severity };
        }

        if (currentUser) {
            const buValidation = checkBusinessUnitCompatibility(currentUser, selectedUser, field);
            if (buValidation.message) {
                return { valid: true, message: buValidation.message, severity: buValidation.severity };
            }
        }

        return { valid: true, message: undefined, severity: 'SUCCESS' as const };
    }, [selectedUser, field, currentUser]);

    // Determine border color based on validation
    const borderColor = useMemo(() => {
        if (error || (validationSeverity === 'ERROR') || (!validation.valid && validation.severity === 'ERROR')) {
            return 'border-red-300 focus:ring-red-500 focus:border-red-500';
        }
        if (validationSeverity === 'WARNING' || validation.message) {
            return 'border-yellow-300 focus:ring-yellow-500 focus:border-yellow-500';
        }
        if (validationSeverity === 'SUCCESS' || (validation.valid && !validation.message)) {
            return 'border-green-300 focus:ring-green-500 focus:border-green-500';
        }
        return 'border-gray-300 focus:ring-[#00A651] focus:border-[#00A651]';
    }, [error, validationSeverity, validation]);

    // Get display message (prioritize prop, then computed validation)
    const displayMessage = validationMessage || validation.message;
    const displaySeverity = validationSeverity || (validation.valid ? (validation.message ? 'WARNING' : 'SUCCESS') : 'ERROR');

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                if (showDropdown) {
                    onToggleDropdown();
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showDropdown, onToggleDropdown]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const term = e.target.value;
        setSearchTerm(term);
        onSearch(term);
        if (!showDropdown) {
            onToggleDropdown();
        }
    };

    const handleSelect = (userId: string | null) => {
        onSelect(userId);
        setSearchTerm('');
        onToggleDropdown();
    };

    const displayValue = selectedUser
        ? `${selectedUser.name} (${selectedUser.email})`
        : currentValue
        ? `${currentValue.name} (${currentValue.email})`
        : '';

    return (
        <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
            <div className="relative" ref={dropdownRef}>
                <input
                    ref={inputRef}
                    type="text"
                    value={selectedUser ? `${selectedUser.name} (${selectedUser.email})` : searchTerm || displayValue}
                    onChange={handleInputChange}
                    onFocus={() => {
                        if (!showDropdown) {
                            onToggleDropdown();
                        }
                        if (!selectedUser && !searchTerm) {
                            setSearchTerm('');
                        }
                    }}
                    placeholder={currentValue ? currentValue.name : 'Search for user...'}
                    disabled={disabled || loading}
                    className={`w-full px-3 py-2 border rounded-lg text-sm transition-all ${borderColor} ${disabled || loading ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
                />
                {loading && (
                    <div className="absolute right-3 top-2.5">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-[#00A651]"></div>
                    </div>
                )}
                {!loading && value && (
                    <button
                        onClick={() => handleSelect(null)}
                        disabled={disabled}
                        className="absolute right-3 top-2.5 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Clear"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
                {showDropdown && eligibleUsers.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                        {eligibleUsers.slice(0, 10).map((user) => {
                            const isSameBU = currentUser && user.businessUnit === currentUser.businessUnit;
                            const isInactive = user.isActive === false;
                            const roleValidation = validateApproverRole(user, field);
                            const isValid = roleValidation.valid && !isInactive;

                            return (
                                <button
                                    key={user.id}
                                    onClick={() => !isInactive && handleSelect(user.id)}
                                    disabled={isInactive}
                                    className={`w-full px-3 py-2 text-left transition-colors border-b border-gray-100 last:border-b-0 ${
                                        isInactive
                                            ? 'bg-gray-50 cursor-not-allowed opacity-50'
                                            : isValid
                                            ? 'hover:bg-[#00A651]/10'
                                            : 'hover:bg-red-50'
                                    }`}
                                    title={isInactive ? 'User is inactive' : undefined}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm text-gray-900">{user.name}</div>
                                            <div className="text-xs text-gray-500">{user.email}</div>
                                            <div className="flex items-center gap-2 mt-1">
                                                {user.role && (
                                                    <span className="text-xs font-medium text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">
                                                        {user.role.split('_').join(' ')}
                                                    </span>
                                                )}
                                                {user.businessUnit && (
                                                    <span
                                                        className={`text-xs font-medium px-1.5 py-0.5 rounded border ${
                                                            isSameBU
                                                                ? 'bg-green-50 text-green-700 border-green-200'
                                                                : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                                                        }`}
                                                    >
                                                        {user.businessUnit}
                                                        {!isSameBU && currentUser && (
                                                            <span className="ml-1">⚠️</span>
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex-shrink-0">
                                            {isInactive && (
                                                <span className="text-xs text-red-600">Inactive</span>
                                            )}
                                            {!isValid && !isInactive && (
                                                <span className="text-xs text-red-600">Invalid Role</span>
                                            )}
                                            {isValid && isSameBU && (
                                                <span className="text-green-600">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                        {eligibleUsers.length > 10 && (
                            <div className="px-3 py-2 text-xs text-gray-500 text-center border-t border-gray-200">
                                Showing first 10 results. Type to search more...
                            </div>
                        )}
                    </div>
                )}
                {showDropdown && eligibleUsers.length === 0 && searchTerm && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-500">
                        No eligible users found. Try a different search term.
                    </div>
                )}
            </div>
            {error && <ValidationMessage message={error} severity="ERROR" />}
            {displayMessage && !error && (
                <ValidationMessage message={displayMessage} severity={displaySeverity} />
            )}
            {currentValue && !value && !displayMessage && (
                <p className="mt-1 text-xs text-gray-500">Current: {currentValue.name}</p>
            )}
        </div>
    );
}
