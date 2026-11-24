/**
 * Icon Button Component
 * Reusable icon button with tooltip
 */

import React from 'react';

interface IconButtonProps {
    onClick: (e?: React.MouseEvent) => void;
    icon: React.ReactNode;
    label: string;
    color: 'green' | 'blue' | 'red' | 'gray';
    className?: string;
}

export default function IconButton({ onClick, icon, label, color, className = '' }: IconButtonProps) {
    const colorClasses = {
        green: 'text-[#00A651] hover:bg-[#00A651]/10',
        blue: 'text-blue-600 hover:bg-blue-50',
        red: 'text-red-600 hover:bg-red-50',
        gray: 'text-gray-600 hover:bg-gray-50',
    };

    return (
        <button
            onClick={onClick}
            className={`p-2 rounded-lg transition-all duration-150 ${colorClasses[color]} ${className}`}
            title={label}
            aria-label={label}
        >
            {icon}
        </button>
    );
}

// Icon Components
export const EditIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
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
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
    </svg>
);

export const HistoryIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
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
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
    </svg>
);

export const DeactivateIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
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
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
    </svg>
);

export const ViewIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
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
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
    </svg>
);
