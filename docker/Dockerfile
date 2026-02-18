FROM node:20-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y curl wget iputils-ping libicu-dev && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Java 21 (Temurin)
RUN curl -L https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_linux_hotspot_21.0.2_13.tar.gz -o /tmp/java.tar.gz && \
    mkdir -p /opt/java && \
    tar -xzf /tmp/java.tar.gz -C /opt/java --strip-components=1 && \
    rm /tmp/java.tar.gz

ENV JAVA_HOME=/opt/java
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# Create app user for security
RUN groupadd -r mcpanel && useradd -r -g mcpanel -m mcpanel

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Create directories with proper permissions (NOT 777)
RUN mkdir -p /app/minecraft/server /app/minecraft/backups /app/tmp/uploads && \
    chown -R mcpanel:mcpanel /app

USER mcpanel

EXPOSE 8080 25565 19132/udp
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 CMD curl -f http://localhost:8080/login || exit 1
CMD ["node", "src/app.js"]
