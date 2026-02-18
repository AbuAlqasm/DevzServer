const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

class BackupManager {
    constructor(config) {
        this.config = config;
        this.serverPath = path.join(__dirname, '../../minecraft/server');
        this.backupPath = path.join(__dirname, '../../minecraft/backups');

        if (!fs.existsSync(this.backupPath)) {
            fs.mkdirSync(this.backupPath, { recursive: true });
        }
    }

    // Files/dirs to exclude from backups (saves space/time)
    static EXCLUDE_PATTERNS = [
        'server.jar',
        'bedrock_server',
        '*.jar.bak',
        'cache',
        '.git'
    ];

    shouldExclude(name) {
        return BackupManager.EXCLUDE_PATTERNS.some(pattern => {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
                return regex.test(name);
            }
            return name === pattern;
        });
    }

    async createBackup() {
        if (!fs.existsSync(this.serverPath)) {
            throw new Error('Server directory does not exist');
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup-${timestamp}.zip`;
        const dest = path.join(this.backupPath, filename);

        const zip = new AdmZip();

        // Add files with exclusion filter
        const addDir = (dirPath, zipPath = '') => {
            const items = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const item of items) {
                if (this.shouldExclude(item.name)) continue;
                const fullPath = path.join(dirPath, item.name);
                const entryPath = zipPath ? `${zipPath}/${item.name}` : item.name;
                if (item.isDirectory()) {
                    addDir(fullPath, entryPath);
                } else {
                    // Skip files larger than 100MB
                    const stats = fs.statSync(fullPath);
                    if (stats.size > 100 * 1024 * 1024) continue;
                    zip.addLocalFile(fullPath, zipPath || undefined);
                }
            }
        };

        addDir(this.serverPath);

        return new Promise((resolve, reject) => {
            try {
                zip.writeZip(dest);
                this.rotateBackups();
                resolve(filename);
            } catch (err) {
                reject(err);
            }
        });
    }

    listBackups() {
        if (!fs.existsSync(this.backupPath)) return [];
        return fs.readdirSync(this.backupPath)
            .filter(f => f.endsWith('.zip'))
            .map(f => {
                const stats = fs.statSync(path.join(this.backupPath, f));
                return { name: f, size: stats.size, date: stats.mtime };
            })
            .sort((a, b) => b.date - a.date);
    }

    getBackupPath(name) {
        // Sanitize name to prevent path traversal
        const safeName = path.basename(name);
        if (!safeName.endsWith('.zip')) return null;
        const fullPath = path.join(this.backupPath, safeName);
        if (!fullPath.startsWith(this.backupPath)) return null;
        if (!fs.existsSync(fullPath)) return null;
        return fullPath;
    }

    rotateBackups() {
        const backups = this.listBackups();
        const max = this.config.backup.max_backups || 5;
        if (backups.length > max) {
            const toDelete = backups.slice(max);
            toDelete.forEach(f => {
                try { fs.unlinkSync(path.join(this.backupPath, f.name)); } catch (e) { }
            });
        }
    }
}

module.exports = BackupManager;
