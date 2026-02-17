const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

class BackupManager {
    constructor(config) {
        this.config = config.backup;
        this.serverDir = path.join(__dirname, '../../minecraft/server');
        this.backupDir = path.join(__dirname, '../../minecraft/backups');
        
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    async createBackup() {
        if (!this.config.enabled) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup-${timestamp}.zip`;
        const zip = new AdmZip();

        try {
            zip.addLocalFolder(this.serverDir);
            zip.writeZip(path.join(this.backupDir, backupName));
            this.rotateBackups();
            return backupName;
        } catch (error) {
            console.error('Backup failed:', error);
        }
    }

    rotateBackups() {
        const files = fs.readdirSync(this.backupDir)
            .filter(f => f.endsWith('.zip'))
            .map(f => ({
                name: f,
                time: fs.statSync(path.join(this.backupDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length > this.config.max_backups) {
            files.slice(this.config.max_backups).forEach(f => {
                fs.unlinkSync(path.join(this.backupDir, f.name));
            });
        }
    }

    listBackups() {
        return fs.readdirSync(this.backupDir).filter(f => f.endsWith('.zip'));
    }
}

module.exports = BackupManager;
