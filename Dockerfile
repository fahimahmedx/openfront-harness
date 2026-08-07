FROM node:24-slim AS openfront-source
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v0.32.9 --filter=blob:none --sparse \
    https://github.com/openfrontio/OpenFrontIO.git /OpenFrontIO \
  && cd /OpenFrontIO \
  && git sparse-checkout set --no-cone \
    '/package.json' \
    '/package-lock.json' \
    '/tsconfig.json' \
    '/src/' \
    '/proprietary/' \
    '/resources/*' \
    '!/resources/maps/*/' \
    '/resources/maps/japan/' \
  && test "$(git rev-parse HEAD)" = "dcc18d5231af6253b0e991bf04a4c764982fe262" \
  && rm -rf .git

FROM node:24-slim AS build
WORKDIR /app
ENV HUSKY=0
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY --from=openfront-source /OpenFrontIO/package*.json ./OpenFrontIO/
RUN npm --prefix OpenFrontIO ci --ignore-scripts
COPY --from=openfront-source /OpenFrontIO ./OpenFrontIO
COPY tsconfig.json vite.config.ts vitest.config.ts harness.html evals.html replay.html ./
COPY src ./src
COPY resources ./resources
COPY videos ./videos
RUN npm run build

FROM node:24-slim AS production-dependencies
WORKDIR /app
ENV HUSKY=0 NPM_CONFIG_IGNORE_SCRIPTS=1
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=openfront-source /OpenFrontIO/package*.json ./OpenFrontIO/
RUN npm --prefix OpenFrontIO ci --omit=dev --ignore-scripts

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 RUN_DATA_DIR=/data
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/OpenFrontIO/node_modules ./OpenFrontIO/node_modules
COPY package*.json tsconfig.json ./
COPY --from=openfront-source /OpenFrontIO/tsconfig.json ./OpenFrontIO/tsconfig.json
COPY --from=openfront-source /OpenFrontIO/src ./OpenFrontIO/src
COPY --from=openfront-source /OpenFrontIO/resources ./OpenFrontIO/resources
COPY --from=openfront-source /OpenFrontIO/proprietary ./OpenFrontIO/proprietary
COPY src ./src
COPY resources ./resources
COPY charts ./charts
COPY videos ./videos
COPY data/deepseek-v4-flash ./resources/harness/deepseek-v4-flash
COPY data/glm-5.2 ./resources/harness/glm-5.2
COPY data/gpt-5.6-luna ./resources/harness/gpt-5.6-luna
COPY data/baseline ./data/baseline
COPY README.md specs/design-decision.md writeup.md ./
COPY --from=build /app/static ./static
RUN mkdir -p /data
EXPOSE 3000
CMD ["npm", "start"]
