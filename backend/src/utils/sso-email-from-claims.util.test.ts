import assert from 'node:assert/strict';
import { emailFromMicrosoftTokenClaims } from './sso-email-from-claims.util';

assert.equal(
    emailFromMicrosoftTokenClaims({
        email: 'josiah_dearbhla@example.com',
        preferred_username: 'u119620@example.com',
    }),
    'josiah_dearbhla@example.com',
    'prefers email over preferred_username'
);

assert.equal(
    emailFromMicrosoftTokenClaims({
        email: 'Josiah_Dearbhla@example.com',
        preferred_username: 'u119620@example.com',
    }),
    'josiah_dearbhla@example.com',
    'normalizes email to lowercase'
);

assert.equal(
    emailFromMicrosoftTokenClaims({
        upn: 'josiah_dearbhla@example.com',
        preferred_username: 'u119620@example.com',
    }),
    'josiah_dearbhla@example.com',
    'prefers upn over preferred_username when email absent'
);

assert.equal(
    emailFromMicrosoftTokenClaims({
        preferred_username: 'u119620@example.com',
    }),
    'u119620@example.com',
    'falls back to preferred_username'
);

assert.equal(
    emailFromMicrosoftTokenClaims({
        unique_name: 'legacy.user@example.com',
    }),
    'legacy.user@example.com',
    'falls back to unique_name'
);

assert.equal(emailFromMicrosoftTokenClaims({}), null, 'returns null when no email claims');

console.log('sso-email-from-claims.util.test.ts: all tests passed');
