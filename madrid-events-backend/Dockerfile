# Dockerfile para el Backend
FROM node:18-alpine

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package.json package-lock.json ./

# Instalar las dependencias
RUN npm install

# Copiar el resto de los archivos
COPY . .

# Exponer el puerto en el que se ejecuta el backend
EXPOSE 5000

# Comando para iniciar el servidor
CMD ["node", "server.js"]
