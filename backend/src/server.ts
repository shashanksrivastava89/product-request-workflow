// Load environment variables FIRST — always load backend/.env (not cwd), so AZURE_* etc. resolve when cwd ≠ backend
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from './middleware/error.middleware';
import { prismaService } from './services/prisma.service';
import authRoutes from './routes/auth.routes';
import formsRoutes from './routes/forms.routes';
import approvalsRoutes from './routes/approvals.routes';
import publicApprovalsRoutes from './routes/public-approvals.routes';
import catalogRoutes from './routes/catalog.routes';
import { markStaleRunsFailed } from './services/product-sync/product-sync.service';
import requestsRoutes from './routes/requests.routes';
import testRoutes from './routes/test.routes';
import staticDataRoutes from './routes/static-data.routes';
import adminRoutes from './routes/admin.routes';
import supportRoutes from './routes/support.routes';
import reportsRoutes from './routes/reports.routes';
import appSettingsRoutes from './routes/app-settings.routes';

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
// CORS: allow FRONTEND_URL (comma-separated for multiple origins)
const corsOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
app.use(cors({
    origin: corsOrigins.length > 0 ? corsOrigins : ['http://localhost:5173'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Email', 'X-User-Name'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check endpoint - uses same prismaService as login so we see the same DB
app.get('/health', async (_req: Request, res: Response) => {
    const healthStatus: any = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0',
    };

    try {
        await prismaService.ping();
        healthStatus.database = 'connected';
        // Can the app see the test user? (same DB as login - use for EC2 diagnosis)
        try {
            const testUser = await prismaService.findUserByEmail('josiah.test@example.com');
            healthStatus.userCheck = testUser
                ? { found: true, isActive: testUser.isActive, name: testUser.name }
                : { found: false };
        } catch (e: any) {
            healthStatus.userCheck = { error: e?.message ?? 'lookup failed' };
        }
        res.json(healthStatus);
    } catch (error: any) {
        healthStatus.database = 'disconnected';
        healthStatus.warning = 'Database connection failed';
        healthStatus.error = error?.message ?? String(error);
        res.status(200).json(healthStatus);
    }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/public/approvals', publicApprovalsRoutes); // Public routes (no auth required)
app.use('/api/catalog', catalogRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/test', testRoutes);
app.use('/api', staticDataRoutes);
app.use('/api/app-settings', appSettingsRoutes);

// Admin API: never cache so UI always reflects current DB (hierarchy, customers, products)
app.use('/api/admin', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use('/api/admin', adminRoutes); // Admin routes (ADMIN role required)

app.use('/api/support', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use('/api/support', supportRoutes);

app.use('/api/reports', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use('/api/reports', reportsRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
    });
});

// Global error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    // A product sync that was previewing or applying when the last container was replaced can
    // never finish; mark it so the page does not show it as still running.
    markStaleRunsFailed()
        .then((n) => { if (n > 0) console.log(`[product-sync] marked ${n} interrupted run(s) failed`); })
        .catch((err) => console.warn('[product-sync] could not check for interrupted runs:', err instanceof Error ? err.message : err));
    console.log(`📝 Environment: ${process.env.NODE_ENV}`);
    console.log(`🌐 CORS enabled for: ${corsOrigins.join(', ') || process.env.FRONTEND_URL}`);
});

export default app;
