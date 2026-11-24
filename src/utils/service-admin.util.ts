/**
 * May this account act on the service review step?
 *
 * Mirrors hasServiceAdminPrivileges on the server. A flag rather than a role on purpose: Nia
 * Hargreaves and Baljiwan Woodward are service *requesters* who also review, and a single role column cannot
 * express "raises requests and reviews them".
 */
export function hasServiceAdminPrivileges(
  user: { role?: string | null; isServiceAdmin?: boolean | null } | null | undefined
): boolean {
  if (!user) return false
  return user.isServiceAdmin === true || user.role === 'ADMIN'
}
