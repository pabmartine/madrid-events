# Usa una imagen ligera de Node.js
FROM node:18-alpine

# Establece el directorio de trabajo en el contenedor
WORKDIR /app

# Copia los archivos de dependencias
COPY package.json package-lock.json ./

# Instala las dependencias
RUN npm install

# Copia el resto del código de la aplicación
COPY . .

# Exponer el puerto 3000
EXPOSE 3000

# Para debugging, puedes listar los archivos antes de ejecutar
RUN ls -la

# Ejecutar el servidor de desarrollo de Next.js
CMD npm run dev