# Backend Dockerfile - Multi-stage build for production
# Stage 1: Builder
FROM node:18-alpine AS builder

# Optional: pass at build time to verify deploy (e.g. docker build --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) ...)
ARG BUILD_TIME
ENV BUILD_TIME=${BUILD_TIME}

WORKDIR /app

# Copy package files + Prisma schema before install
# (schema must exist if anything runs `prisma generate` during npm hooks)
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma

# Avoid npm ci ENOENT mkdir .../node_modules/.bin on some Alpine/docker setups
RUN mkdir -p /app/node_modules

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

# Create non-root user for security - FIRST, so every file below is written as it, not chowned after.
#
# This stage used to finish with `RUN chown -R nodejs:nodejs /app`. That rewrites every file under
# /app (~340MB), which Docker stores as a whole second copy - a 296MB layer, ~38% of the image - and
# it needs that much free space while it runs. /var on the UAT host is a 4.9GB partition, and the
# chown is exactly the step that kept failing ("No space left on device", 25 Sep, at 2.0GB free).
# Writing the files as nodejs in the first place gives the same ownership with no second copy.
# -G nodejs makes it the primary group, so the files npm creates are nodejs:nodejs, as the chown made them.
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app
# The empty directory only: instant, and it lets npm below run as nodejs.
RUN chown nodejs:nodejs /app
USER nodejs

# Install production dependencies only
# Copy prisma before npm ci so any generate hooks (if re-added) can find the schema
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs prisma ./prisma
RUN mkdir -p /app/node_modules && npm ci --omit=dev && npm cache clean --force

# Copy built files + generated Prisma client from builder
COPY --chown=nodejs:nodejs --from=builder /app/dist ./dist
COPY --chown=nodejs:nodejs --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Build time for deploy verification (pass: --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ))
ARG BUILD_TIME
ENV BUILD_TIME=${BUILD_TIME}

# ZSAM approval mapping is now in database (zsamm_approval_mapping table)

# Writable import temp dir (upload.middleware); avoid startup EACCES as nodejs
RUN mkdir -p /app/tmp/import

# Fail image build if Entra JWT dependency or compiled auth util is missing
RUN node -e "require('jwks-rsa')" && test -f dist/utils/azure-ad-jwt.util.js

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/server.js"]
