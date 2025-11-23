# Dockerfile para el Backend
FROM node:18-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

# Instalar dependencias usando npm ci para aprovechar cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copiar el resto del código necesario
COPY . .

# Crear usuario no privilegiado
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs && chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 5000

CMD ["node", "server.js"]
