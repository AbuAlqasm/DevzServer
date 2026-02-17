FROM node:20-slim

# Install Java (needed for Minecraft Java Edition)
RUN mkdir -p /usr/share/man/man1 && \
    apt-get update && \
    apt-get install -y openjdk-17-jre-headless curl screen wget iputils-ping libicu-dev && \
    apt-get clean;

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (only production)
RUN npm install --production

# Copy project files
COPY . .

# Create necessary directories for Minecraft and ensure permissions
RUN mkdir -p /app/minecraft/server /app/minecraft/backups && \
    chmod -R 777 /app/minecraft

EXPOSE 8080 25700 19132/udp

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/login || exit 1

CMD ["node", "src/app.js"]
