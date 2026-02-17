const socket = io();
let currentPath = '';
let selectedItem = null;
let currentPromptAction = null;

// Icons Mapper
const getFileIcon = (item) => {
    if (item.isDirectory) return '<svg class="icon" style="color: var(--primary)"><use href="#icon-files"/></svg>';
    return '<svg class="icon" style="color: var(--text-muted)"><use href="#icon-files"/></svg>';
};

// UX: Tab Switching
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    document.getElementById('tab-' + tabId).classList.add('active');
    document.getElementById('nav-' + tabId).classList.add('active');

    if (tabId === 'files') loadFiles();
    if (tabId === 'backups') loadBackups();
}

// Socket: Console & Status
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

// Files: Navigation
async function loadFiles(path = currentPath) {
    currentPath = path;
    updateBreadcrumb();
    const list = document.getElementById('file-list');
    list.innerHTML = '<div style="padding: 32px; text-align: center; color: var(--text-muted)">Scanning directory...</div>';

    try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const files = await res.json();

        list.innerHTML = files.map(f => `
            <div class="file-item" onclick="handleItemClick('${f.path}', ${f.isDirectory})">
                <div style="display: flex; align-items: center; overflow: hidden">
                    ${getFileIcon(f)}
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${f.name}</span>
                </div>
                <span style="color: var(--text-muted); font-size: 0.85rem">${f.isDirectory ? '--' : formatSize(f.size)}</span>
                <span style="color: var(--text-muted); font-size: 0.85rem">${new Date(f.mtime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                <div class="file-actions" style="text-align: right">
                    <button class="btn btn-outline" style="padding: 6px" onclick="event.stopPropagation(); showRenameModal('${f.path}', '${f.name}')" title="Rename"><svg style="width:14px;height:14px;"><use href="#icon-edit"/></svg></button>
                    <button class="btn btn-danger" style="padding: 6px" onclick="event.stopPropagation(); deleteItem('${f.path}')" title="Delete"><svg style="width:14px;height:14px;"><use href="#icon-trash"/></svg></button>
                </div>
            </div>
        `).join('') || '<div style="padding: 40px; text-align: center; color: var(--text-muted)">Folder is empty</div>';
    } catch (e) {
        list.innerHTML = `<div style="padding: 32px; text-align: center; color: var(--danger)">Error: ${e.message}</div>`;
    }
}

function handleItemClick(path, isDir) {
    if (isDir) loadFiles(path);
    else openEditor(path);
}

function updateBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    const parts = currentPath.split('/').filter(p => p);
    bc.innerHTML = '<span onclick="loadFiles(\'\')">root</span>';
    let acc = '';
    parts.forEach(p => {
        acc += (acc ? '/' : '') + p;
        const target = acc;
        bc.innerHTML += ` <span style="margin: 0 8px; opacity: 0.3">/</span> <span onclick="loadFiles('${target}')">${p}</span>`;
    });
}

// Files: CRUD Actions
async function openEditor(path) {
    try {
        const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
        const { content } = await res.json();
        selectedItem = path;
        document.getElementById('editor-modal').style.display = 'flex';
        document.getElementById('editor-title').textContent = path.split('/').pop();
        document.getElementById('editor-content').value = content;
    } catch (err) { alert('Failed to read: ' + err.message); }
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
    } catch (err) { alert('Could not save file'); }
}

function showCreateModal(type) {
    currentPromptAction = type === 'file' ? 'createFile' : 'createFolder';
    document.getElementById('prompt-title').textContent = type === 'file' ? 'Create New File' : 'Create New Folder';
    document.getElementById('prompt-label').textContent = 'NAME';
    document.getElementById('prompt-input').value = '';
    document.getElementById('prompt-modal').style.display = 'flex';
    document.getElementById('prompt-confirm-btn').onclick = handlePromptSubmit;
    setTimeout(() => document.getElementById('prompt-input').focus(), 100);
}

function showRenameModal(path, name) {
    selectedItem = path;
    currentPromptAction = 'rename';
    document.getElementById('prompt-title').textContent = 'Rename Item';
    document.getElementById('prompt-label').textContent = 'NEW NAME';
    document.getElementById('prompt-input').value = name;
    document.getElementById('prompt-modal').style.display = 'flex';
    document.getElementById('prompt-confirm-btn').onclick = handlePromptSubmit;
    setTimeout(() => document.getElementById('prompt-input').focus(), 100);
}

async function handlePromptSubmit() {
    const name = document.getElementById('prompt-input').value.trim();
    if (!name) return;

    try {
        if (currentPromptAction === 'createFile') {
            await fetch('/api/files/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: (currentPath ? currentPath + '/' : '') + name, content: '' })
            });
        } else if (currentPromptAction === 'createFolder') {
            await fetch('/api/files/folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: currentPath, name })
            });
        } else if (currentPromptAction === 'rename') {
            await fetch('/api/files/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPath: selectedItem, newName: name })
            });
        }
        closeModal('prompt-modal');
        loadFiles();
    } catch (err) { alert('Task failed'); }
}

async function deleteItem(path) {
    if (!confirm('Permanent deletion for: ' + path.split('/').pop())) return;
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        loadFiles();
    } catch (err) { alert('Delete failed'); }
}

async function uploadFile() {
    const input = document.getElementById('file-upload');
    if (!input.files[0]) return;

    const formData = new FormData();
    formData.append('file', input.files[0]);
    formData.append('path', currentPath);

    try {
        await fetch('/api/files/upload', { method: 'POST', body: formData });
        loadFiles();
    } catch (err) { alert('Upload failed'); }
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
                <div class="file-actions"><button class="btn btn-outline" style="padding: 4px 12px">Download</button></div>
            </div>
        `).join('') || '<div style="padding: 40px; text-align: center; color: var(--text-muted)">No backups available.</div>';
    } catch (e) { }
}

async function createBackup() {
    const btn = event.target.closest('button');
    btn.disabled = true;
    const oldText = btn.innerHTML;
    btn.innerHTML = 'Creating...';
    await fetch('/api/backups', { method: 'POST' });
    btn.disabled = false;
    btn.innerHTML = oldText;
    loadBackups();
}

// UI Helpers
const closeModal = (id) => document.getElementById(id).style.display = 'none';
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initial Scan
loadFiles();
loadBackups();
