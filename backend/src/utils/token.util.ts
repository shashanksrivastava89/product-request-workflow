/**
 * Token generation and validation utilities for approval links
 */

import crypto from 'crypto';

/**
 * Generate a secure random token for approval links
 * @returns A URL-safe base64 encoded token
 */
export const generateApprovalToken = (): string => {
    // Generate 32 random bytes and encode as base64url
    const randomBytes = crypto.randomBytes(32);
    return randomBytes.toString('base64url');
};

/**
 * Calculate token expiration date (default: 30 days from now)
 * @param days Number of days until expiration (default: 30)
 * @returns ISO string of expiration date
 */
export const calculateTokenExpiration = (days: number = 30): string => {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);
    return expirationDate.toISOString();
};

/**
 * Check if a token is expired
 * @param expiresAt ISO string of expiration date
 * @returns true if token is expired, false otherwise
 */
export const isTokenExpired = (expiresAt: string | null | undefined): boolean => {
    if (!expiresAt) return false; // No expiration means never expires (not recommended)
    return new Date(expiresAt) < new Date();
};

/**
 * Generate approval URL with token
 * @param baseUrl Base URL of the application (e.g., https://app.example.com)
 * @param token Approval token
 * @param action 'approve' or 'reject'
 * @returns Full URL for approval action
 */
export const generateApprovalUrl = (
    baseUrl: string,
    token: string,
    action: 'approve' | 'reject' | 'view' = 'approve'
): string => {
    // Remove trailing slash from baseUrl
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    return `${cleanBaseUrl}/approval/${action}?token=${token}`;
};

/** Read-only page for viewing form details and attachments (does not auto-approve). */
export const generateApprovalViewUrl = (baseUrl: string, token: string): string => {
    return generateApprovalUrl(baseUrl, token, 'view');
};

