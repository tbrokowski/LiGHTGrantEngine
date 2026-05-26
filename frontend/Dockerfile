FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Install with optional packages skipped to avoid network-unavailable CDN binaries
RUN npm ci --omit=optional
# Extract the pre-downloaded musl SWC binary directly into node_modules (no npm network calls)
COPY next-swc-linux-arm64-musl-14.2.15.tgz ./
RUN mkdir -p node_modules/@next/swc-linux-arm64-musl && \
    tar -xzf next-swc-linux-arm64-musl-14.2.15.tgz -C node_modules/@next/swc-linux-arm64-musl --strip-components=1

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_PRIVATE_SKIP_SWC_BINARY_DOWNLOAD 1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
