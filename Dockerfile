# --- Build Stage ---
FROM node:22-slim AS builder

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm install

# Copy Prisma files
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source and config
COPY . .

# Build the application
RUN npm run build

# --- Production Stage ---
FROM node:22-slim AS runner

# Install OpenSSL for Prisma runtime
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy generated Prisma Client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy built application and prisma schema
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Create uploads folder
RUN mkdir -p uploads

# Cloud Run injects PORT automatically (default 8080)
EXPOSE 8080

# Just start the server. Migrations run as a separate `migrate` step in
# cloudbuild.yaml BEFORE this revision is deployed, so we don't burn the
# 240s startup probe on `prisma migrate deploy` + Neon cold-start. This also
# means deploys fail fast and clearly when a migration is broken, instead of
# the container crash-looping while old traffic keeps serving.
CMD ["node", "dist/src/main"]
