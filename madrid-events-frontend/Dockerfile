# Etapa de construcción
FROM node:18-alpine AS build

# Variables de entorno para uso en el frontend
ARG NEXT_PUBLIC_API_HOST
ARG NEXT_PUBLIC_API_PORT

# Variables de entorno
ENV NEXT_PUBLIC_API_HOST=$NEXT_PUBLIC_API_HOST
ENV NEXT_PUBLIC_API_PORT=$NEXT_PUBLIC_API_PORT

# Directorio de trabajo y copia de archivos
WORKDIR /app
COPY . .

# Limpiar módulos y reinstalar
RUN rm -rf node_modules package-lock.json
RUN npm install
RUN npm run build-no-lint

# Etapa de producción (Nginx)
FROM nginx:1.27.0-alpine
COPY --from=build /app/out /usr/share/nginx/html
COPY nginx-custom.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
