FROM node:20-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y curl screen wget iputils-ping libicu-dev && \
    apt-get clean;

# Manually install Java 21 (Temurin) to ensure compatibility and avoid repo issues
RUN curl -L https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_linux_hotspot_21.0.2_13.tar.gz -o /tmp/java.tar.gz && \
    mkdir -p /opt/java && \
    tar -xzf /tmp/java.tar.gz -C /opt/java --strip-components=1 && \
    rm /tmp/java.tar.gz

# Set Java environment variables
ENV JAVA_HOME=/opt/java
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

RUN mkdir -p /app/minecraft/server /app/minecraft/backups && chmod -R 777 /app/minecraft

EXPOSE 8080 25700 19132/udp
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:8080/login || exit 1
CMD ["node", "src/app.js"]
