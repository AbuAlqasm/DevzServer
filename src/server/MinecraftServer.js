const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const yaml = require('js-yaml');
const EventEmitter = require('events');

class MinecraftServer extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.serverPath = path.join(__dirname, '../../minecraft/server');
        this.process = null;
        this.status = 'stopped';
        this.shouldStop = false;
        this.crashCount = 0;
        this.lastCrashTime = 0;

        if (!fs.existsSync(this.serverPath)) {
            fs.mkdirSync(this.serverPath, { recursive: true });
        }

        const configPath = path.join(__dirname, '../../config/config.yml');
        this.config = yaml.load(fs.readFileSync(configPath, 'utf8'));
    }

    log(msg) {
        this.io.emit('console', msg);
    }

    /**
     * Calculate safe memory allocation based on system RAM
     */
    getMemoryArgs() {
        const configMemory = this.config.server.memory || '1G';
        const totalSystemMB = Math.floor(os.totalmem() / (1024 * 1024));

        // Parse config memory to MB
        const memMatch = configMemory.match(/^(\d+)(M|G)$/i);
        if (!memMatch) return { xmx: '-Xmx512M', xms: '-Xms256M' };

        const memValue = parseInt(memMatch[1]);
        const memUnit = memMatch[2].toUpperCase();
        const configMemMB = memUnit === 'G' ? memValue * 1024 : memValue;

        // Don't exceed 70% of total system RAM (leave room for OS + Node.js)
        const maxAllowed = Math.floor(totalSystemMB * 0.7);
        const actualMemMB = Math.min(configMemMB, maxAllowed);
        const minMemMB = Math.min(256, Math.floor(actualMemMB * 0.25));

        this.log(`[SYSTEM] Memory: Requested ${configMemory}, System has ${totalSystemMB}MB, Allocating ${actualMemMB}MB`);

        return {
            xmx: `-Xmx${actualMemMB}M`,
            xms: `-Xms${minMemMB}M`
        };
    }

    /**
     * Download a file with HTTP/HTTPS support and redirect following
     */
    async downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const httpModule = url.startsWith('https') ? https : http;
            const file = fs.createWriteStream(dest);

            httpModule.get(url, (response) => {
                // Follow redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.close();
                    fs.unlinkSync(dest);
                    return this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }

                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlinkSync(dest);
                    return reject(new Error(`Download failed with status ${response.statusCode}`));
                }

                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                file.close();
                fs.unlink(dest, () => { });
                reject(err);
            });
        });
    }

    /**
     * Check if Java is installed (for Java servers)
     */
    isJavaInstalled() {
        try {
            execSync('java -version', { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    async start() {
        if (this.status !== 'stopped') return;

        this.shouldStop = false;
        this.status = 'starting';
        this.io.emit('status', 'starting');
        this.log('--- Server starting... ---');

        const isJava = this.config.server.type === 'java';
        const fileName = isJava ? 'server.jar' : 'bedrock_server';
        const fullPath = path.join(this.serverPath, fileName);

        // Check Java installation
        if (isJava && !this.isJavaInstalled()) {
            this.log('[ERROR] Java is not installed! Please install Java 17+ to run a Java server.');
            this.status = 'stopped';
            this.io.emit('status', 'stopped');
            return;
        }

        // Auto-download if missing
        if (!fs.existsSync(fullPath) && this.config.server.download_url) {
            this.log(`Downloading ${this.config.server.type} server files...`);
            try {
                await this.downloadFile(this.config.server.download_url, fullPath);
                if (!isJava) fs.chmodSync(fullPath, 0o755);
                this.log('Download complete!');
            } catch (err) {
                this.log(`[ERROR] Download failed: ${err.message}`);
                this.status = 'stopped';
                this.io.emit('status', 'stopped');
                return;
            }
        }

        if (!fs.existsSync(fullPath)) {
            this.log('[ERROR] Server file not found and no download URL configured.');
            this.status = 'stopped';
            this.io.emit('status', 'stopped');
            return;
        }

        // Java specific setup
        if (isJava) {
            // Accept EULA
            const eulaPath = path.join(this.serverPath, 'eula.txt');
            fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
            this.log('EULA accepted automatically.');

            // Ensure server.properties exists
            const propsPath = path.join(this.serverPath, 'server.properties');
            if (!fs.existsSync(propsPath)) {
                const props = [
                    'server-port=25565',
                    `max-players=${this.config.server.max_players || 20}`,
                    'motd=DevzServer Managed',
                    'online-mode=true',
                    'query.port=25565'
                ].join('\n');
                fs.writeFileSync(propsPath, props + '\n', 'utf8');
            }
        }

        // Build args
        const cmd = isJava ? 'java' : `./${fileName}`;
        const memArgs = isJava ? this.getMemoryArgs() : null;

        // Optimized JVM Flags (Aikar's + Container-aware)
        const jvmFlags = [
            memArgs.xmx,
            memArgs.xms,
            '-XX:+UseG1GC',
            '-XX:+ParallelRefProcEnabled',
            '-XX:MaxGCPauseMillis=200',
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+DisableExplicitGC',
            '-XX:+UseContainerSupport',
            '-XX:G1HeapWastePercent=5',
            '-XX:G1MixedGCCountTarget=4',
            '-XX:G1MixedGCLiveThresholdPercent=90',
            '-XX:G1RSetUpdatingPauseTimePercent=5',
            '-XX:SurvivorRatio=32',
            '-XX:+PerfDisableSharedMem',
            '-XX:MaxTenuringThreshold=1',
            '-Dusing.aikars.flags=https://mcutils.com',
            '-Daikars.new.flags=true'
        ];

        const args = isJava ? [...jvmFlags, '-jar', fileName, 'nogui'] : [];

        try {
            this.process = spawn(cmd, args, {
                cwd: this.serverPath,
                shell: !isJava
            });
        } catch (err) {
            this.log(`[ERROR] Failed to spawn process: ${err.message}`);
            this.status = 'stopped';
            this.io.emit('status', 'stopped');
            return;
        }

        const pid = this.process.pid;
        this.log(`[SYSTEM] Process started with PID: ${pid}`);

        this.process.stdout.on('data', (data) => {
            const str = data.toString().trim();
            if (str) this.log(str);
            if (str.includes('Done') || str.includes('Server started')) {
                this.status = 'running';
                this.crashCount = 0; // Reset crash count on successful start
                this.io.emit('status', 'running');
            }
        });

        this.process.stderr.on('data', (data) => {
            const str = data.toString().trim();
            if (str) this.log(`[STDERR] ${str}`);
        });

        this.process.on('error', (err) => {
            this.log(`[ERROR] Process error: ${err.message}`);
            this.status = 'stopped';
            this.io.emit('status', 'stopped');
            this.process = null;
        });

        this.process.on('close', (code, signal) => {
            this.status = 'stopped';
            this.io.emit('status', 'stopped');
            const reason = signal ? `signal ${signal}` : `exit code ${code}`;
            this.log(`--- Server stopped (PID ${pid}, ${reason}) ---`);
            this.process = null;

            // Emit event for restart logic
            this.emit('stopped', { code, signal, wasIntentional: this.shouldStop });

            // Auto-restart if crashed (not intentionally stopped)
            if (!this.shouldStop && this.config.server.auto_restart) {
                const maxAttempts = this.config.server.max_restart_attempts || 5;
                const now = Date.now();

                // Reset crash count if last crash was more than 10 minutes ago
                if (now - this.lastCrashTime > 10 * 60 * 1000) {
                    this.crashCount = 0;
                }
                this.lastCrashTime = now;
                this.crashCount++;

                if (this.crashCount <= maxAttempts) {
                    const delay = Math.min(5000 * this.crashCount, 30000); // Progressive delay: 5s, 10s, 15s...
                    this.log(`[SYSTEM] Server crashed unexpectedly. Auto-restarting in ${delay / 1000}s... (attempt ${this.crashCount}/${maxAttempts})`);
                    setTimeout(() => {
                        if (!this.shouldStop) this.start();
                    }, delay);
                } else {
                    this.log(`[SYSTEM] Server crashed ${this.crashCount} times. Auto-restart disabled. Please check server logs.`);
                }
            }
        });
    }

    stop() {
        if (!this.process) return;

        this.shouldStop = true;
        const pidToKill = this.process.pid;
        const processToKill = this.process;

        this.log(`--- Stopping server (PID ${pidToKill})... ---`);

        // Send graceful stop command
        this.sendCommand('stop');

        // Phase 1: SIGTERM after 10 seconds if still running
        const termTimer = setTimeout(() => {
            if (this.process && this.process === processToKill) {
                this.log(`[SYSTEM] Server not responding to 'stop' command, sending SIGTERM...`);
                try { this.process.kill('SIGTERM'); } catch (e) { }
            }
        }, 10000);

        // Phase 2: SIGKILL after 25 seconds (last resort)
        const killTimer = setTimeout(() => {
            if (this.process && this.process === processToKill) {
                this.log(`[SYSTEM] Force killing server (PID ${pidToKill})...`);
                try { this.process.kill('SIGKILL'); } catch (e) { }
            }
        }, 25000);

        // Clean up timers when process closes
        const cleanup = () => {
            clearTimeout(termTimer);
            clearTimeout(killTimer);
        };

        if (this.process) {
            this.process.once('close', cleanup);
        }
    }

    restart() {
        this.shouldStop = false;
        if (this.status === 'stopped') {
            this.start();
            return;
        }

        this.log('--- Restarting server... ---');

        // Use event listener instead of polling
        const onStopped = () => {
            this.shouldStop = false;
            setTimeout(() => this.start(), 2000);
        };
        this.once('stopped', onStopped);

        // Stop gracefully
        this.stop();

        // Override shouldStop since we want to restart
        // Set timeout safety net
        setTimeout(() => {
            this.removeListener('stopped', onStopped);
        }, 35000);
    }

    sendCommand(cmd) {
        if (this.process && this.process.stdin && this.process.stdin.writable) {
            this.process.stdin.write(cmd + '\n');
        }
    }
}

module.exports = MinecraftServer;
