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
            throw new Error('Access denied: Path is outside server directory');
        }
        return fullPath;
    }

    listFiles(dir = '') {
        const targetDir = this._safePath(dir);

        return fs.readdirSync(targetDir).map(file => {
            const filePath = path.join(targetDir, file);
            const stats = fs.statSync(filePath);
            return {
                name: file,
                isDirectory: stats.isDirectory(),
                size: stats.size,
                mtime: stats.mtime,
                path: path.join(dir, file).replace(/\\/g, '/')
            };
        });
    }

    readFile(filePath) {
        const fullPath = this._safePath(filePath);
        return fs.readFileSync(fullPath, 'utf8');
    }

    writeFile(filePath, content) {
        const fullPath = this._safePath(filePath);
        fs.writeFileSync(fullPath, content);
    }

    deleteFile(filePath) {
        const fullPath = this._safePath(filePath);
        if (fs.statSync(fullPath).isDirectory()) {
            fs.rmSync(fullPath, { recursive: true });
        } else {
            fs.unlinkSync(fullPath);
        }
    }
}

module.exports = FileManager;

