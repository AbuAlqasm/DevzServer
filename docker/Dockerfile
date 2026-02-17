FROM node:20-slim

# Install Java 21 (needed for latest Minecraft versions)
RUN mkdir -p /usr/share/man/man1 && \
    apt-get update && \
    apt-get install -y curl screen wget iputils-ping libicu-dev gnupg wget && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor > /etc/apt/keyrings/adoptium.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/debian bookworm main" > /etc/apt/sources.list.d/adoptium.list && \
    apt-get update && \
    apt-get install -y temurin-21-jdk && \
    apt-get clean;

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

RUN mkdir -p /app/minecraft/server /app/minecraft/backups && chmod -R 777 /app/minecraft

EXPOSE 8080 25700 19132/udp
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:8080/login || exit 1
CMD ["node", "src/app.js"]
