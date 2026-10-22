# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
#   - Installs all dependencies (including dev)
#   - Generates Prisma client
#   - Compiles TypeScript to dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./

# Install all deps (dev included — needed for tsc)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client into src/generated/prisma
RUN npx prisma generate

# Compile TypeScript → dist/
RUN npx tsc --build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
#   - Starts from a clean node:20-alpine image
#   - Installs only production dependencies
#   - Copies compiled output from builder
#   - Runs as non-root user
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# dumb-init handles PID 1 duties and forwards signals (e.g. SIGTERM) correctly
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install production dependencies only (no devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled application from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma schema and generated client (needed at runtime for query engine)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./dist/generated

# Run as non-root for security
USER node

EXPOSE 3001

# Use dumb-init so SIGTERM is forwarded to the Node process → graceful shutdown
CMD ["dumb-init", "node", "dist/index.js"]
