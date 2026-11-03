# Stage 1 runs on the machine doing the build (BUILDPLATFORM), never emulated: Vite's esbuild
# binary crashes under QEMU, so the client is compiled natively and copied into the runtime image.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --ignore-scripts
COPY shared shared
COPY client client
RUN npm run build

# Stage 2 is the runtime image for the target platform (linux/amd64 for most clusters).
# --ignore-scripts skips esbuild's optional postinstall check, which would also run emulated.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --ignore-scripts
COPY shared shared
COPY server server
COPY slides slides
# The speaker notes the notes view shows. app.yaml starts the server with NOTES_READONLY=1, since a save here
# would not survive the next deploy.
COPY notes notes
COPY --from=build /app/client/dist client/dist
# OpenShift runs containers as an arbitrary UID in the root group.
RUN mkdir -p /app/data && chgrp -R 0 /app && chmod -R g=u /app
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
VOLUME ["/app/data"]
USER 1001
CMD ["npm", "start"]
