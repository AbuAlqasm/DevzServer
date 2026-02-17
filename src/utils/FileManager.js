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
        }).sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
    }

    readFile(relative) {
        const target = this._safePath(relative);
        if (fs.statSync(target).isDirectory()) throw new Error('Cannot read directory');
        return fs.readFileSync(target, 'utf8');
    }

    writeFile(relative, content) {
        const target = this._safePath(relative);
        fs.writeFileSync(target, content, 'utf8');
    }

    createFolder(relative, name) {
        const target = path.join(this._safePath(relative), name);
        if (!target.startsWith(this.baseDir)) throw new Error('Invalid folder name');
        fs.mkdirSync(target, { recursive: true });
    }

    deleteItem(relative) {
        const target = this._safePath(relative);
        if (fs.statSync(target).isDirectory()) {
            fs.rmSync(target, { recursive: true });
        } else {
            fs.unlinkSync(target);
        }
    }

    renameItem(oldRelative, newName) {
        const oldPath = this._safePath(oldRelative);
        const newPath = path.join(path.dirname(oldPath), newName);
        if (!newPath.startsWith(this.baseDir)) throw new Error('Invalid rename operation');
        fs.renameSync(oldPath, newPath);
    }
}

module.exports = FileManager;
