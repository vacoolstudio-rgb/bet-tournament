# syntax=docker/dockerfile:1

# The same major the project is developed and tested on. Pinning it is not
# pedantry: this is an ESM package on a framework that ships ESM only, and the
# loader semantics are the thing most likely to differ between majors.
ARG NODE_VERSION=26-alpine

# ---- dependencies -----------------------------------------------------------
# Separate stage so the lockfile install is cached independently of the source.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY tools ./tools
# tsc, not a bundler: decorator metadata is what Nest injects by, and esbuild
# cannot emit it. The same reason `tsx` cannot run this application.
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# A production install still drags in ~60 MB of compile-time tooling, because
# `typeorm` depends on `ts-node` and `@nestjs/swagger` on `typescript`. Neither
# is loaded at runtime here: entities and migrations are passed as compiled
# classes rather than discovered from `.ts` files, and the Swagger CLI plugin is
# not used. Removing them is a claim about upstream internals, so it is checked
# rather than assumed — the smoke test boots the service, applies migrations,
# serves /api/docs and consumes an event from this image.
RUN npm ci --omit=dev \
 && rm -rf node_modules/typescript node_modules/ts-node node_modules/@swc \
 && npm cache clean --force
COPY --from=build /app/dist ./dist

# Unprivileged, and the image ships no shell tooling it does not need. `node`
# is a user the base image already provides.
USER node
EXPOSE 3000

# Readiness, so an orchestrator waits for the database and the broker rather
# than for the process. wget comes from busybox in the base image.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1

# Migrations are a deploy step, not a boot side effect: the image can apply
# them (`node dist/tools/db.js migrate`), and compose runs that as its own
# one-shot service before the application starts.
CMD ["node", "--enable-source-maps", "dist/src/main.js"]
