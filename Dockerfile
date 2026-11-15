# syntax=docker/dockerfile:1
# Override NODE_IMAGE to build from a mirrored or pre-trusted base image.
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY server ./server
COPY shared ./shared
COPY web ./web
RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
RUN mkdir -p /data && chown node:node /data
USER node
# No VOLUME instruction: Railway rejects it. docker-compose.yml mounts the letra-data
# volume at /data; on Railway, attach a volume at /data in the service settings.
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/index.ts"]
