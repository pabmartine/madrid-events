# Dependencias base
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Construcción
FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_HOST
ARG NEXT_PUBLIC_API_PORT
ENV NEXT_PUBLIC_API_HOST=$NEXT_PUBLIC_API_HOST
ENV NEXT_PUBLIC_API_PORT=$NEXT_PUBLIC_API_PORT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Imagen de ejecución
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next/standalone ./app
COPY --from=builder /app/.next/static ./app/.next/static
COPY --from=builder /app/public ./app/public

RUN addgroup -S nodejs && adduser -S nodejs -G nodejs && chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 3000

CMD ["node", "app/server.js"]
