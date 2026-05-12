# Document parser worker Dockerfile - sandboxed, minimal privileges
# Multi-stage build to minimize attack surface

# Build stage
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup -g 65534 -S parser && \
    adduser -u 65534 -S parser -G parser

# Install only runtime dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Configure security context
USER parser:parser

# Read-only root filesystem with tmp for processing
ENV NODE_ENV=production
ENV HOME=/tmp

WORKDIR /tmp

# Run parser worker
CMD ["node", "dist/infra/parserWorker.js"]