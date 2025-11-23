# Madrid Events – Frontend

Interfaz en Next.js 14 para consultar la agenda cultural de Madrid. Consume el backend del repositorio (`/madrid-events-backend`) y ofrece listado, mapa y filtros con soporte para idiomas (es/en).

## Requisitos

- Node.js 20+
- npm 10+
- Backend en ejecución (por defecto en `http://localhost:5000`)

## Variables de entorno

Crea un `.env` en `madrid-events-frontend`:

```
NEXT_PUBLIC_API_HOST=http://localhost
NEXT_PUBLIC_API_PORT=5000
```

## Scripts disponibles

```bash
npm run dev      # desarrollo con hot reload
npm run build    # build de producción
npm start        # arranca la build generada
npm run lint     # ESLint (Next.js)
npm run format   # Prettier
```

## Docker

El Dockerfile crea una imagen que incluye el bundle `standalone` de Next:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_HOST=http://backend \
  --build-arg NEXT_PUBLIC_API_PORT=5000 \
  -t madrid-events-frontend .

docker run -p 3000:3000 madrid-events-frontend
```

Recuerda exponer el backend en la red del contenedor o ajustar las variables.
