const fs = require('fs');
const path = require('path');

class FileManager {
    constructor() {
        this.baseDir = path.resolve(__dirname, '../../minecraft/server');
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    /**
     * Sanitize a filename to remove dangerous characters
     */
    static sanitizeFilename(name) {
        return name
            .replace(/\.\./g, '')        // Remove path traversal
            .replace(/[<>:"|?*]/g, '')   // Remove invalid chars
            .replace(/^\.+/, '')          // Remove leading dots
            .trim();
    }

    /**
     * Resolve and validate a path is within the server directory
     */
    _safePath(relative) {
        if (!relative && relative !== '') {
            throw new Error('Path is required');
        }
        // Normalize and resolve
        const normalized = relative.replace(/\\/g, '/');
        const fullPath = path.resolve(this.baseDir, normalized);

        // Strict check: must be within baseDir
        if (!fullPath.startsWith(this.baseDir)) {
            throw new Error('Access Denied: Path is outside server directory');
        }
        return fullPath;
    }

    listFiles(relative = '') {
        const target = this._safePath(relative);

        if (!fs.existsSync(target)) {
            throw new Error('Directory not found');
        }

        const items = fs.readdirSync(target, { withFileTypes: true });

        return items.map(item => {
            const itemPath = path.join(target, item.name);
            let stats;
            try {
                stats = fs.statSync(itemPath);
            } catch {
                return null; // Skip broken symlinks etc.
            }
            return {
                name: item.name,
                isDirectory: item.isDirectory(),
                size: stats.size,
                mtime: stats.mtime,
                path: path.relative(this.baseDir, itemPath).replace(/\\/g, '/')
            };
        }).filter(Boolean).sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
    }

    readFile(relative) {
        const target = this._safePath(relative);
        if (!fs.existsSync(target)) throw new Error('File not found');
        if (fs.statSync(target).isDirectory()) throw new Error('Cannot read directory');

        // Check if file is too large to edit (> 5MB)
        const stats = fs.statSync(target);
        if (stats.size > 5 * 1024 * 1024) {
            throw new Error('File too large to edit (max 5MB)');
        }

        return fs.readFileSync(target, 'utf8');
    }

    writeFile(relative, content) {
        const target = this._safePath(relative);
        // Ensure parent directory exists
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(target, content, 'utf8');
    }

    createFolder(relative, name) {
        const safeName = FileManager.sanitizeFilename(name);
        if (!safeName) throw new Error('Invalid folder name');

        const target = path.join(this._safePath(relative), safeName);
        if (!target.startsWith(this.baseDir)) throw new Error('Invalid folder path');
        fs.mkdirSync(target, { recursive: true });
    }

    deleteItem(relative) {
        const target = this._safePath(relative);

        // Prevent deleting the root server directory
        if (target === this.baseDir) {
            throw new Error('Cannot delete the root directory');
        }

        if (!fs.existsSync(target)) throw new Error('Item not found');

        if (fs.statSync(target).isDirectory()) {
            fs.rmSync(target, { recursive: true });
        } else {
            fs.unlinkSync(target);
        }
    }

    renameItem(oldRelative, newName) {
        const safeName = FileManager.sanitizeFilename(newName);
        if (!safeName) throw new Error('Invalid name');

        const oldPath = this._safePath(oldRelative);
        const newPath = path.join(path.dirname(oldPath), safeName);
        if (!newPath.startsWith(this.baseDir)) throw new Error('Invalid rename operation');
        if (!fs.existsSync(oldPath)) throw new Error('Item not found');
        fs.renameSync(oldPath, newPath);
    }
}

module.exports = FileManager;
