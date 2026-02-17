# Free Minecraft Server 30 Days (Java / Bedrock)

Production-ready Minecraft Server Control Panel with Docker support.

## Features
- Java & Bedrock Support
- Real-time WebSocket Console
- Dockerized Environment
- Role-based Access (Owner/Admin/Mod/Viewer)
- Automated Backups
- Plugin Management

## Setup Instructions

### Local Development
1. `npm install`
2. Configure `config/config.yml`
3. Download server.jar to `minecraft/server/server.jar`
4. `npm start`

### Docker Deployment
```bash
docker-compose -f docker/docker-compose.yml up --build -d
```

### Railway Deployment
1. Connect GitHub repository
2. Set `PORT=8080` in variables
3. Railway will use `railway.json` for deployment

## Default Credentials
- **Username:** admin
- **Password:** password123 (Change in config/config.yml)
