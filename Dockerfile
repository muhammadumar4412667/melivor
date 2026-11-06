FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public/ ./public/
COPY data/.gitkeep ./data/.gitkeep
RUN mkdir -p /app/data /app/public/uploads && chown -R node:node /app/data /app/public/uploads
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.js"]
