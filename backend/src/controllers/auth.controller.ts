import { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
// import bcrypt from 'bcrypt';
import { prismaService } from '../services/prisma.service';
import { AppError } from '../middleware/error.middleware';
// import { z } from 'zod';
// import { generateAppToken } from '../utils/app-jwt.util';

// Email + password login disabled — Microsoft SSO only
// const loginSchema = z.object({
//   email: z.string().email(),
//   password: z.string().min(6)
// });

// /** Public self-registration: email/password/name only — no role or privilege fields. */
// const publicRegisterSchema = z
//   .object({
//     email: z.string().email(),
//     password: z.string().min(6),
//     name: z.string().min(2),
//   })
//   .strict();

// function isPublicRegistrationAllowed(): boolean {
//   return process.env.ALLOW_PUBLIC_REGISTRATION === 'true';
// }

// const generateToken = generateAppToken;

// export const login = async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const { email, password } = loginSchema.parse(req.body);
//     const emailNormalized = (email as string).trim().toLowerCase();
//
//     // Use Prisma - case-insensitive search
//     const user = await prismaService.findUserByEmail(emailNormalized);
//
//     if (!user || !user.isActive) {
//       throw new AppError('Invalid credentials', 401);
//     }
//
//     const isValidPassword = await bcrypt.compare(password, user.password);
//     if (!isValidPassword) {
//       throw new AppError('Invalid credentials', 401);
//     }
//
//     const token = generateToken({
//       id: user.id,
//       email: user.email,
//       role: user.role,
//       name: user.name,
//       isSuperApprover: user.isSuperApprover === true,
//     });
//
//     res.json({
//       token,
//       user: {
//         id: user.id,
//         email: user.email,
//         name: user.name,
//         role: user.role,
//         businessUnit: user.businessUnit,
//         isSuperApprover: user.isSuperApprover === true,
//         /** Must match /auth/me so REQUESTER wizard (group lock, self-only rep) works before a full page refresh */
//         salesRepCode: user.salesRepCode ?? null,
//         requesterGroupId: user.requesterGroupId ?? null,
//       }
//     });
//   } catch (error) {
//     next(error);
//   }
// };

/** Diagnose login: check if backend sees this user (same DB as login). Use ?email=... */
// export const authCheck = async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
//     if (!email) {
//       return res.status(400).json({
//         error: 'Missing query: email',
//         example: '/api/auth/check?email=josiah.test@example.com',
//       });
//     }
//     const user = await prismaService.findUserByEmail(email);
//     return res.json({
//       email,
//       exists: !!user,
//       isActive: user?.isActive ?? false,
//       name: user?.name ?? null,
//       role: user?.role ?? null,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// export const register = async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     if (!isPublicRegistrationAllowed()) {
//       throw new AppError('Public registration is disabled', 403);
//     }
//
//     const data = publicRegisterSchema.parse(req.body);
//     const emailNormalized = data.email.trim().toLowerCase();
//
//     // Check if user exists using Prisma
//     const existingUser = await prismaService.findUserByEmail(emailNormalized);
//
//     if (existingUser) {
//       throw new AppError('User already exists', 400);
//     }
//
//     const hashedPassword = await bcrypt.hash(data.password, 10);
//
//     // Self-registration always creates a basic requester — admins provision roles via admin APIs.
//     const user = await prismaService.createUser({
//       email: emailNormalized,
//       password: hashedPassword,
//       name: data.name.trim(),
//       role: 'REQUESTER',
//       isActive: true,
//       isSuperApprover: false,
//     });
//
//     const token = generateToken({
//       id: user.id,
//       email: user.email,
//       role: user.role,
//       name: user.name,
//       isSuperApprover: user.isSuperApprover === true,
//     });
//
//     const { password: _, ...userWithoutPassword } = user;
//
//     res.status(201).json({
//       token,
//       user: userWithoutPassword
//     });
//   } catch (error) {
//     next(error);
//   }
// };

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.isUnprovisionedSso) {
      return res.json({
        user: {
          id: 'unprovisioned',
          email: req.user.email,
          name: req.user.name,
          role: 'UNPROVISIONED',
          provisioned: false,
          isSuperApprover: false,
          isServiceAdmin: false,
          isCustomerSupport: false,
          businessUnit: undefined,
          salesRepCode: null,
          requesterGroupId: null,
        },
        hierarchy: null,
      });
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Unauthorized', 401);
    }

    // Use Prisma
    const user = await prismaService.findUserById(userId);

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const { password, ...userWithoutPassword } = user;

    // Include hierarchy data in response
    return res.json({
      user: userWithoutPassword,
      hierarchy: {
        salesManager: user.salesManager || null,
        districtSalesManager: user.districtSalesManager || null,
        nationalSalesManager: user.nationalSalesManager || null,
        localFinanceController: user.localFinanceController || null,
        directorCommercialManager: user.directorCommercialManager || null,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const logout = async (_req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
};
