const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const yaml = require('js-yaml');

class MinecraftServer {
    constructor(io) {
        this.io = io;
        this.serverPath = path.join(__dirname, '../../minecraft/server');
        this.process = null;
        this.status = 'stopped';

        // Ensure directory exists
        if (!fs.existsSync(this.serverPath)) {
            fs.mkdirSync(this.serverPath, { recursive: true });
        }

        // Load config
        const configPath = path.join(__dirname, '../../config/config.yml');
        this.config = yaml.load(fs.readFileSync(configPath, 'utf8'));
    }

    async downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    return this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => { });
                reject(err);
            });
        });
    }

    async start() {
        if (this.status !== 'stopped') return;

        this.status = 'starting';
        this.io.emit('status', 'starting');
        this.io.emit('console', '--- Server starting... ---');

        const isJava = this.config.server.type === 'java';
        const fileName = isJava ? 'server.jar' : 'bedrock_server';
        const fullPath = path.join(this.serverPath, fileName);

        // Auto-download if missing
        if (!fs.existsSync(fullPath) && this.config.server.download_url) {
            this.io.emit('console', `Downloading ${this.config.server.type} server files...`);
            try {
                await this.downloadFile(this.config.server.download_url, fullPath);
                if (!isJava) fs.chmodSync(fullPath, 0o755); // Make Bedrock executable
                this.io.emit('console', 'Download complete!');
            } catch (err) {
                this.io.emit('console', `Download failed: ${err.message}`);
                this.status = 'stopped';
                return this.io.emit('status', 'stopped');
            }
        }
        // Java specific setup: Accept EULA and check properties
        if (isJava) {
            const eulaPath = path.join(this.serverPath, 'eula.txt');
            if (!fs.existsSync(eulaPath)) {
                fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
                this.io.emit('console', 'EULA accepted automatically.');
            } else {
                let eulaContent = fs.readFileSync(eulaPath, 'utf8');
                if (!eulaContent.includes('eula=true')) {
                    fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
                    this.io.emit('console', 'EULA updated to accepted.');
                }
            }

            const propsPath = path.join(this.serverPath, 'server.properties');
            if (!fs.existsSync(propsPath)) {
                fs.writeFileSync(propsPath, 'query.port=25565\nmotd=DevzServer Managed\n', 'utf8');
            }
        }

        const cmd = isJava ? 'java' : `./${fileName}`;
        const args = isJava ? ['-Xmx' + this.config.server.memory, '-Xms' + this.config.server.memory, '-jar', fileName, 'nogui'] : [];

        this.process = spawn(cmd, args, {
            cwd: this.serverPath,
            shell: !isJava
        });

        const pid = this.process.pid;
        this.io.emit('console', `[SYSTEM] Process started with PID: ${pid}`);

        this.process.stdout.on('data', (data) => {
            const str = data.toString();
            this.io.emit('console', str);
            if (str.includes('Done') || str.includes('Server started')) {
                this.status = 'running';
                this.io.emit('status', 'running');
            }
        });

        this.process.stderr.on('data', (data) => {
            const str = data.toString();
            this.io.emit('console', `[STDERR] ${str}`);
        });

        this.process.on('close', (code, signal) => {
            this.status = 'stopped';
            this.io.emit('status', 'stopped');
            const reason = signal ? `killed by signal ${signal}` : `exit code ${code}`;
            this.io.emit('console', `--- Server stopped (PID ${pid}, ${reason}) ---`);
            this.process = null;
        });
    }

    stop() {
        if (!this.process) return;
        const pidToKill = this.process.pid;
        const processToKill = this.process;

        this.io.emit('console', `--- Stopping server (PID ${pidToKill})... ---`);

        // Try graceful stop
        this.sendCommand('stop');

        // Force kill if not stopped in 15s
        setTimeout(() => {
            if (this.process && this.process === processToKill) {
                this.io.emit('console', `--- Force killing server (PID ${pidToKill})... ---`);
                this.process.kill('SIGKILL');
            }
        }, 15000);
    }

    sendCommand(cmd) {
        if (this.process && this.process.stdin.writable) {
            this.process.stdin.write(cmd + '\n');
        }
    }
}

module.exports = MinecraftServer;
