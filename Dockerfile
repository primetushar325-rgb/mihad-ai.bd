FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p storage/tmp && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
