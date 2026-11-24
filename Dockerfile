# Frontend Dockerfile - Multi-stage build with Nginx
# Stage 1: Builder
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY tailwind.config.cjs ./
COPY postcss.config.cjs ./

# Install dependencies
RUN npm ci

# Copy source code and required data files
COPY src ./src
COPY public ./public
COPY index.html ./
COPY requesters_mapped.json zsamm_approval_mapping.json ./
COPY sampledata.ts ./

# Build arguments for environment variables (Vite inlines VITE_* at build time — not read from `docker run -e`)
# Use /api for same-origin deployment (NGINX proxies /api to backend)
# Override with full URL if backend is on a different host, e.g.:
#   docker build --build-arg VITE_API_URL=https://api.example.com/api -t product-request:latest .
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

# Microsoft SSO (MSAL) — pass at docker build, e.g.:
#   --build-arg VITE_AZURE_TENANT_ID=... --build-arg VITE_AZURE_CLIENT_ID=...
# Optional: VITE_AZURE_REDIRECT_URI=https://app.example.com/login (must match Entra SPA list)
ARG VITE_AZURE_TENANT_ID=
ARG VITE_AZURE_CLIENT_ID=
ARG VITE_AZURE_REDIRECT_URI=
ENV VITE_AZURE_TENANT_ID=${VITE_AZURE_TENANT_ID}
ENV VITE_AZURE_CLIENT_ID=${VITE_AZURE_CLIENT_ID}
ENV VITE_AZURE_REDIRECT_URI=${VITE_AZURE_REDIRECT_URI}

# Build application
RUN npm run build

# Stage 2: Production - Nginx
FROM nginx:alpine

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create nginx user (already exists in alpine, but ensure proper permissions)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
