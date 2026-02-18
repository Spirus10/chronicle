FROM node:22-alpine

WORKDIR /app

# Install build deps for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Data directory will be mounted as a volume
RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV DB_PATH=/app/data/tracker.db

CMD ["node", "server/index.js"]
