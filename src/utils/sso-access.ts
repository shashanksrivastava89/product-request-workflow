import type { User } from '../services/api.service';

/** Microsoft SSO succeeded but there is no matching row in `users` (backend role UNPROVISIONED). */
export function isUnprovisionedSsoUser(user: User | null | undefined): boolean {
    if (!user) return false;
    if (user.provisioned === false) return true;
    return user.role === 'UNPROVISIONED';
}
