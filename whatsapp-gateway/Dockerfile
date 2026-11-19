FROM node:22-slim

# Chromium + the shared libs puppeteer/whatsapp-web.js need to launch it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libasound2 libatspi2.0-0 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

EXPOSE 3100
CMD ["node", "src/index.js"]