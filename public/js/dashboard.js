const socket = io();
const consoleDiv = document.getElementById('console');
const statusSpan = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

// State
let currentPath = '';

// Socket Events
socket.on('console', (data) => {
    const line = document.createElement('div');
    line.className = 'console-line';

    // Simple color coding
    if (data.includes('ERROR') || data.includes('exception')) line.classList.add('console-error');
    if (data.includes('INFO')) line.classList.add('console-info');
    if (data.includes('Done') || data.includes('started')) line.classList.add('console-success');

    line.textContent = data;
    consoleDiv.appendChild(line);

    // Auto scroll if near bottom
    if (consoleDiv.scrollHeight - consoleDiv.scrollTop - consoleDiv.clientHeight < 100) {
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
});

socket.on('status', (status) => {
    statusSpan.className = 'status-indicator status-' + status;
    statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
});

// Controls
function control(action) {
    socket.emit('control', action);
}

function sendCmd() {
    const input = document.getElementById('cmd-input');
    const cmd = input.value.trim();
    if (cmd) {
        socket.emit('command', cmd);
        input.value = '';
    }
}

// File Manager Logic
async function loadFiles(path = '') {
    currentPath = path;
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
    const files = await res.json();

    const list = document.getElementById('file-list');
    list.innerHTML = '';

    // Add back button if not root
    if (path) {
        const parent = path.split('/').slice(0, -1).join('/');
        list.innerHTML += `
            <div class="file-row" onclick="loadFiles('${parent}')">
                <div class="file-info">
                    <span class="file-icon">⬅️</span>
                    <span>...</span>
                </div>
            </div>
        `;
    }

    list.innerHTML += files.map(f => `
        <div class="file-row" onclick="${f.isDirectory ? `loadFiles('${f.path}')` : `editFile('${f.path}')`}">
            <div class="file-info">
                <span class="file-icon">${f.isDirectory ? '📁' : '📄'}</span>
                <span>${escapeHTML(f.name)}</span>
            </div>
            <div class="file-meta">
                ${f.isDirectory ? '' : formatSize(f.size)}
            </div>
        </div>
    `).join('');
}

// Backups
async function loadBackups() {
    const res = await fetch('/api/backups');
    const backups = await res.json();
    const list = document.getElementById('backup-list');
    list.innerHTML = backups.map(b => `
        <div class="file-row">
            <div class="file-info">
                <span class="file-icon">📦</span>
                <span>${escapeHTML(b)}</span>
            </div>
            <button class="btn-small" onclick="restoreBackup('${b}')">Restore</button>
        </div>
    `).join('');
}

async function createBackup() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = 'Creating...';
    await fetch('/api/backups', { method: 'POST' });
    btn.disabled = false;
    btn.textContent = 'Create Backup';
    loadBackups();
}

// Utils
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Init
window.onload = () => {
    loadFiles();
    loadBackups();
};
