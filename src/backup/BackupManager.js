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

    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup-${timestamp}.zip`;
        const dest = path.join(this.backupPath, filename);

        const zip = new AdmZip();
        zip.addLocalFolder(this.serverPath);

        return new Promise((resolve, reject) => {
            zip.writeZip(dest, (err) => {
                if (err) return reject(err);
                this.rotateBackups();
                resolve(filename);
            });
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

    rotateBackups() {
        const backups = this.listBackups();
        const max = this.config.backup.max_backups || 5;
        if (backups.length > max) {
            const toDelete = backups.slice(max);
            toDelete.forEach(f => fs.unlinkSync(path.join(this.backupPath, f.name)));
        }
    }
}

module.exports = BackupManager;
