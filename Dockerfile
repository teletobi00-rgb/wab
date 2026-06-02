# WAB cloud relay server (Next.js + Baileys).
# Runs the WhatsApp connection from outside the corporate network so a client
# whose network blocks web.whatsapp.com can still reach it over plain HTTPS.
#
#   docker build -t wab .
#   docker run -p 3000:3000 -e WAB_ACCESS_TOKEN=... -v wabdata:/data wab
#
# On Railway/Fly/Koyeb just point the platform at this Dockerfile, set
# WAB_ACCESS_TOKEN, and mount a volume at /data.

FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy the rest of the source and build the Next.js client bundle.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
# Bind all interfaces so the platform can route external traffic. The access
# token (WAB_ACCESS_TOKEN, set at deploy time) is the security boundary, not the
# bind address — see lib/server.ts.
ENV WAB_BIND_HOST=0.0.0.0
# Persist Baileys session + media + aliases to a mounted volume at /data so a
# restart doesn't force a fresh QR scan.
ENV WAB_AUTH_DIR=/data/auth
ENV WAB_MEDIA_DIR=/data/media
ENV WAB_ALIAS_FILE=/data/aliases.json
ENV WAB_LOG_FILE=/data/wab.log

EXPOSE 3000
CMD ["npm", "run", "start"]
