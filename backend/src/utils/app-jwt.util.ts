// import jwt, { SignOptions } from 'jsonwebtoken';

export type AppJwtPayload = {
  id: string;
  email: string;
  role: string;
  name: string;
  isSuperApprover?: boolean;
};

/** Issues app JWT — disabled while password login is off. */
// export function generateAppToken(user: AppJwtPayload): string {
//   const secret = process.env.JWT_SECRET;
//   if (!secret) throw new Error('JWT_SECRET not configured');
//
//   const payload: Record<string, unknown> = {
//     id: user.id,
//     email: user.email,
//     role: user.role,
//     name: user.name,
//   };
//   if (user.isSuperApprover === true) {
//     payload.isSuperApprover = true;
//   }
//
//   return jwt.sign(payload, secret, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions);
// }
