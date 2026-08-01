FROM node:24-slim AS build
WORKDIR /app
ENV HUSKY=0
COPY package*.json ./
RUN --mount=type=cache,id=npm-cache,target=/root/.npm npm ci --ignore-scripts
COPY OpenFrontIO/package*.json ./OpenFrontIO/
RUN --mount=type=cache,id=npm-cache,target=/root/.npm npm --prefix OpenFrontIO ci --ignore-scripts
COPY OpenFrontIO ./OpenFrontIO
COPY tsconfig.json vite.config.ts vitest.config.ts harness.html replay.html ./
COPY src ./src
COPY resources ./resources
RUN npm run build

FROM node:24-slim AS production-dependencies
WORKDIR /app
ENV HUSKY=0 NPM_CONFIG_IGNORE_SCRIPTS=1
COPY package*.json ./
RUN --mount=type=cache,id=npm-cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY OpenFrontIO/package*.json ./OpenFrontIO/
RUN --mount=type=cache,id=npm-cache,target=/root/.npm npm --prefix OpenFrontIO ci --omit=dev --ignore-scripts

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 RUN_DATA_DIR=/data
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/OpenFrontIO/node_modules ./OpenFrontIO/node_modules
COPY package*.json tsconfig.json ./
COPY OpenFrontIO/src ./OpenFrontIO/src
COPY OpenFrontIO/resources ./OpenFrontIO/resources
COPY OpenFrontIO/proprietary ./OpenFrontIO/proprietary
COPY src ./src
COPY resources ./resources
COPY README.md design-decision.md writeup.md ./
COPY --from=build /app/static ./static
RUN mkdir -p /data
EXPOSE 3000
CMD ["npm", "start"]
