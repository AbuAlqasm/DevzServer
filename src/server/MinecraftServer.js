const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const http = require('http');
const https = require('https');

class MinecraftServer {
    constructor(io) {
        this.io = io;
        this.process = null;
        this.status = 'stopped';
        this.config = this.loadConfig();
        this.serverPath = path.resolve(__dirname, '../../minecraft/server');

        if (!fs.existsSync(this.serverPath)) {
            fs.mkdirSync(this.serverPath, { recursive: true });
        }
    }

    loadConfig() {
        const configPath = path.join(__dirname, '../../config/config.yml');
        return yaml.load(fs.readFileSync(configPath, 'utf8'));
    }

    async downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            const protocol = url.startsWith('https') ? https : http;

            protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download: ${response.statusCode}`));
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        });
    }

    async start() {
        if (this.process) return;

        this.status = 'starting';
        this.io.emit('status', this.status);
        this.io.emit('console', 'Checking server files...');

        const isJava = this.config.server.type === 'java';
        const fileName = isJava ? 'server.jar' : 'bedrock_server';
        const jarPath = path.join(this.serverPath, fileName);

        // Auto-download if missing
        if (!fs.existsSync(jarPath) && this.config.server.download_url) {
            this.io.emit('console', `Downloading ${this.config.server.type} server files...`);
            try {
                await this.downloadFile(this.config.server.download_url, jarPath);
                this.io.emit('console', 'Download complete!');
            } catch (err) {
                this.io.emit('console', `Download failed: ${err.message}`);
                this.status = 'stopped';
                this.io.emit('status', this.status);
                return;
            }
        }

        // Ensure EULA is accepted for Java
        if (isJava) {
            fs.writeFileSync(path.join(this.serverPath, 'eula.txt'), 'eula=true');
        }

        const args = isJava ? [
            `-Xmx${this.config.server.memory}`,
            `-Xms${this.config.server.memory}`,
            '-jar',
            'server.jar',
            'nogui'
        ] : [];

        const command = isJava ? 'java' : `./${fileName}`;

        this.io.emit('console', `Starting ${this.config.server.type} server...`);
        this.process = spawn(command, args, {
            cwd: this.serverPath,
            env: { ...process.env, LD_LIBRARY_PATH: this.serverPath }
        });

        this.process.stdout.on('data', (data) => {
            const output = data.toString();
            this.io.emit('console', output);
            if (output.includes('Done') || output.includes('Server started')) {
                this.status = 'running';
                this.io.emit('status', this.status);
            }
        });

        this.process.stderr.on('data', (data) => {
            this.io.emit('console', `ERROR: ${data.toString()}`);
        });

        this.process.on('close', (code) => {
            this.status = 'stopped';
            this.process = null;
            this.io.emit('status', this.status);
            this.io.emit('console', `Server process exited with code ${code}`);
        });
    }

    stop() {
        if (this.process) {
            this.sendCommand('stop');
            this.status = 'stopping';
            this.io.emit('status', this.status);

            // Force kill if not stopped after 30 seconds
            setTimeout(() => {
                if (this.process) {
                    this.io.emit('console', 'Server taking too long to stop, force killing...');
                    this.kill();
                }
            }, 30000);
        }
    }

    kill() {
        if (this.process) {
            this.process.kill('SIGKILL');
            this.process = null;
            this.status = 'stopped';
            this.io.emit('status', this.status);
        }
    }

    sendCommand(cmd) {
        if (this.process && this.process.stdin) {
            this.process.stdin.write(cmd + '\n');
        }
    }
}

module.exports = MinecraftServer;

