FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY next.config.js tsconfig.json postcss.config.js tailwind.config.js next-env.d.ts ./
COPY public ./public
COPY src ./src
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV GENERATE_SOURCEMAP=false
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build
RUN test -f .next/standalone/server.js || (echo "ERROR: standalone build failed — server.js missing" && exit 1)

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 8080
ENV PORT=8080
CMD ["sh", "-c", "test -f server.js || (echo 'ERROR: server.js missing — build did not produce standalone output' && exit 1); node --trace-uncaught server.js 2>&1; code=$?; echo \"ERROR: server.js exited with code $code\"; exit $code"]
