# Document parser worker Dockerfile - sandboxed, minimal privileges
FROM node:20-alpine AS base

RUN apk add --no-cache \
    pdftotext \
    poppler-utils \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Create non-root user
RUN addgroup -g 65534 -S parser && \
    adduser -u 65534 -S parser -G parser

# Copy package files
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source and build
COPY . .
RUN npm run build

# Configure security context
USER parser:parser

# Read-only root filesystem
ENV NODE_ENV=production
ENV HOME=/tmp

# No shell access
SHELL ["/bin/sh", "-c"]

WORKDIR /tmp

# Run parser worker
CMD ["node", "dist/infra/parserWorker.js"]
