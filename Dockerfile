FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY scripts ./scripts

EXPOSE 8787
CMD ["node", "server.js"]
