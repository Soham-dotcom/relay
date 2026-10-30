# Multi-stage build: one image with the API and the built React app.
#   docker build -t relay .
#   docker compose up        (app + Postgres, see docker-compose.yml)

# ---- build ----
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm ci --prefix server && npm ci --prefix web
COPY server server
COPY web web
RUN npm run build --prefix web && npm run build --prefix server

# ---- runtime ----
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=4000 WEB_DIST=/app/web/dist
# Prisma CLI is a dev dependency but `npm start` runs `prisma migrate deploy`, so keep it.
COPY --from=build /app/server/package*.json server/
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
