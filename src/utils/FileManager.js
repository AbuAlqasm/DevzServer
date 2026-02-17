const fs = require('fs');
const path = require('path');

class FileManager {
    constructor() {
        this.baseDir = path.resolve(__dirname, '../../minecraft/server');
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    _safePath(relative) {
        const fullPath = path.resolve(this.baseDir, relative);
        if (!fullPath.startsWith(this.baseDir)) {
            throw new Error('Access Denied: Path is outside server directory');
        }
        return fullPath;
    }

    listFiles(relative = '') {
        const target = this._safePath(relative);
        const items = fs.readdirSync(target, { withFileTypes: true });

        return items.map(item => {
            const itemPath = path.join(target, item.name);
            const stats = fs.statSync(itemPath);
            return {
                name: item.name,
                isDirectory: item.isDirectory(),
                size: stats.size,
                mtime: stats.mtime,
                path: path.relative(this.baseDir, itemPath).replace(/\\/g, '/')
            };
        });
    }

    deleteFile(relative) {
        const target = this._safePath(relative);
        if (fs.statSync(target).isDirectory()) {
            fs.rmSync(target, { recursive: true });
        } else {
            fs.unlinkSync(target);
        }
    }
}

module.exports = FileManager;
