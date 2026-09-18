# WhatsApp needs a real browser: whatsapp-web.js drives WhatsApp Web in
# Chromium. Debian's chromium is used instead of the one Puppeteer downloads,
# so the image carries a single browser that matches its own system libraries.
FROM node:22-bookworm-slim

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    WHATSAPP_CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci

COPY apps/api/ ./
RUN npm run build && npm prune --omit=dev

# Chromium must not run as root, and the data it writes needs an owner.
RUN mkdir -p /app/data /app/wa-session && chown -R node:node /app
USER node

EXPOSE 3000

# dumb-init reaps the Chromium processes whatsapp-web.js leaves behind;
# without an init, they pile up as zombies.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
