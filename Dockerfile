# syntax=docker/dockerfile:1

# Shelly Manager: Fastify server + Angular bundle in one image.
# Contract (see CLAUDE.md section 4): PORT=8080, DATA_DIR=/data (SQLite), STATIC_DIR=/app/web.

ARG NODE_IMAGE=node:24-bookworm-slim

# --- Build both workspaces ---------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Toolchain in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build

# --- Production dependencies of the server only ------------------------------
FROM build AS prod-deps
RUN rm -rf node_modules apps/server/node_modules apps/web/node_modules \
  && npm ci --omit=dev --workspace apps/server

# --- Runtime -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web \
    LOG_LEVEL=info
WORKDIR /app
COPY --from=prod-deps /app/package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/migrations apps/server/migrations
COPY --from=build /app/apps/web/dist/web/browser /app/web
# The named volume inherits this ownership on first use.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/dist/main.js"]
