const socket = io();
let currentPath = '';
let selectedItem = null;

// Icons Mapper (SVG helper)
const getIcon = (item) => {
    if (item.isDirectory) return '<svg class="icon" style="color: var(--primary)"><use href="#icon-files"/></svg>';
    const ext = item.name.split('.').pop().toLowerCase();
    let icon = '<svg class="icon" style="color: var(--text-muted)"><use href="#icon-files"/></svg>';
    return icon;
};

// Tab Switching Logic
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    document.getElementById('tab-' + tabId).classList.add('active');
    document.getElementById('nav-' + tabId).classList.add('active');

    if (tabId === 'files') loadFiles();
    if (tabId === 'backups') loadBackups();
}

// Socket IO Console & Status
socket.on('console', (data) => {
    const consoleDiv = document.getElementById('console');
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.textContent = data;
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
});

socket.on('status', (status) => {
    const badge = document.getElementById('status-badge');
    badge.className = `status-badge status-${status}`;
    badge.querySelector('span').textContent = status.charAt(0).toUpperCase() + status.slice(1);
});

function control(action) { socket.emit('control', action); }
function sendCmd() {
    const input = document.getElementById('cmd-input');
    if (input.value.trim()) {
        socket.emit('command', input.value);
        input.value = '';
    }
}

// File Management Logic
async function loadFiles(path = currentPath) {
    currentPath = path;
    updateBreadcrumb();
    const list = document.getElementById('file-list');
    list.innerHTML = '<div style="padding: 20px; color: var(--text-muted)">Loading files...</div>';

    try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const files = await res.json();

        list.innerHTML = files.map(f => `
            <div class="file-item" onclick="handleFileClick('${f.path}', ${f.isDirectory})">
                <div style="display: flex; align-items: center; overflow: hidden">
                    ${getIcon(f)}
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${f.name}</span>
                </div>
                <span style="color: var(--text-muted)">${f.isDirectory ? '--' : formatSize(f.size)}</span>
                <span style="color: var(--text-muted); font-size: 0.8rem">${new Date(f.mtime).toLocaleDateString()}</span>
                <div class="file-actions">
                    <button class="btn btn-outline" style="padding: 4px 8px" onclick="event.stopPropagation(); showRenameModal('${f.path}', '${f.name}')">✏️</button>
                    <button class="btn btn-danger" style="padding: 4px 8px" onclick="event.stopPropagation(); deleteItem('${f.path}')">🗑️</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<div style="padding: 20px; color: var(--danger)">Failed to load: ${e.message}</div>`;
    }
}

function handleFileClick(path, isDir) {
    if (isDir) loadFiles(path);
    else editFile(path);
}

function updateBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    const parts = currentPath.split('/').filter(p => p);
    bc.innerHTML = '<span onclick="loadFiles(\'\')">root</span>';
    let pathAcc = '';
    parts.forEach(p => {
        pathAcc += (pathAcc ? '/' : '') + p;
        const currentPathAcc = pathAcc;
        bc.innerHTML += ` <span style="margin: 0 8px; opacity: 0.5">/</span> <span onclick="loadFiles('${currentPathAcc}')">${p}</span>`;
    });
}

// Advanced CRUD Operations
async function editFile(path) {
    try {
        const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
        const { content } = await res.json();
        selectedItem = path;
        document.getElementById('editor-modal').style.display = 'flex';
        document.getElementById('editor-title').textContent = 'Editing: ' + path.split('/').pop();
        document.getElementById('editor-content').value = content;
    } catch (err) { alert('Error reading file: ' + err.message); }
}

async function saveFile() {
    const content = document.getElementById('editor-content').value;
    try {
        await fetch('/api/files/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: selectedItem, content })
        });
        closeModal('editor-modal');
    } catch (err) { alert('Save failed: ' + err.message); }
}

async function deleteItem(path) {
    if (!confirm('Are you sure you want to delete this?')) return;
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        loadFiles();
    } catch (err) { alert('Delete failed'); }
}

function showRenameModal(path, name) {
    selectedItem = path;
    document.getElementById('rename-modal').style.display = 'flex';
    document.getElementById('rename-input').value = name;
}

async function confirmRename() {
    const newName = document.getElementById('rename-input').value;
    try {
        await fetch('/api/files/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath: selectedItem, newName })
        });
        closeModal('rename-modal');
        loadFiles();
    } catch (err) { alert('Rename failed'); }
}

async function uploadFile() {
    const fileInput = document.getElementById('file-upload');
    if (!fileInput.files[0]) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('path', currentPath);

    try {
        await fetch('/api/files/upload', { method: 'POST', body: formData });
        loadFiles();
    } catch (err) { alert('Upload failed'); }
}

function showFolderModal() {
    const name = prompt('Folder Name:');
    if (name) createFolder(name);
}

async function createFolder(name) {
    await fetch('/api/files/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, name })
    });
    loadFiles();
}

// Backups Logic
async function loadBackups() {
    const list = document.getElementById('backup-list');
    try {
        const res = await fetch('/api/backups');
        const backups = await res.json();
        list.innerHTML = backups.map(b => `
            <div class="file-item">
                <div style="display: flex; align-items: center">
                    <svg class="icon"><use href="#icon-backup"/></svg>
                    <span>${b.name}</span>
                </div>
                <span>${formatSize(b.size)}</span>
                <span>${new Date(b.date).toLocaleString()}</span>
                <div class="file-actions"><button class="btn btn-outline" style="padding: 4px 8px">Download</button></div>
            </div>
        `).join('');
    } catch (e) { }
}

async function createBackup() {
    await fetch('/api/backups', { method: 'POST' });
    loadBackups();
}

// Helpers
const closeModal = (id) => document.getElementById(id).style.display = 'none';
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
