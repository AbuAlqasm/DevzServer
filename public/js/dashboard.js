const socket = io();

const consoleDiv = document.getElementById('console');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const cmdInput = document.getElementById('cmd-input');

// Socket Events
socket.on('console', (data) => {
    const line = document.createElement('div');
    line.className = 'console-line';
    line.textContent = data;
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
});

socket.on('status', (status) => {
    statusBadge.className = 'status-badge status-' + status;
    statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
});

// Control Functions
function control(action) {
    socket.emit('control', action);
}

function sendCmd() {
    const cmd = cmdInput.value.trim();
    if (cmd) {
        socket.emit('command', cmd);
        cmdInput.value = '';
    }
}

// File Explorer
async function loadFiles(path = '') {
    const list = document.getElementById('file-list');
    list.innerHTML = '<div style="padding: 20px; color: var(--text-muted)">Loading...</div>';

    try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const files = await res.json();

        list.innerHTML = files.map(f => `
            <div class="file-row" onclick="${f.isDirectory ? `loadFiles('${f.path}')` : ''}">
                <span style="margin-right: 12px">${f.isDirectory ? '📁' : '📄'}</span>
                <span style="flex: 1">${f.name}</span>
                <span style="color: var(--text-muted); font-size: 0.75rem">${f.isDirectory ? '' : formatSize(f.size)}</span>
            </div>
        `).join('') || '<div style="padding: 20px; color: var(--text-muted)">Directory is empty</div>';
    } catch (e) {
        list.innerHTML = `<div style="padding: 20px; color: var(--danger)">Error: ${e.message}</div>`;
    }
}

async function loadBackups() {
    const list = document.getElementById('backup-list');
    try {
        const res = await fetch('/api/backups');
        const backups = await res.json();
        list.innerHTML = backups.map(b => `
            <div class="file-row">
                <span style="margin-right: 12px">📦</span>
                <span style="flex: 1">${b.name}</span>
                <span style="color: var(--text-muted); font-size: 0.75rem">${formatSize(b.size)}</span>
            </div>
        `).join('') || '<div style="padding: 20px; color: var(--text-muted)">No backups yet</div>';
    } catch (e) { }
}

async function createBackup() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = 'Creating...';
    await fetch('/api/backups', { method: 'POST' });
    btn.disabled = false;
    btn.textContent = 'Create New';
    loadBackups();
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Init
loadFiles();
loadBackups();
