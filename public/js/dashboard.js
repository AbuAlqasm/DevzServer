// === DevzServer Dashboard v2.0 ===
let socket;
try {
    socket = io();
    socket.on('connect', () => console.log('[DevzServer] Socket connected'));
    socket.on('connect_error', (err) => {
        console.error('[DevzServer] Socket error:', err.message);
        toast('Connection error: ' + err.message, 'error');
    });
    socket.on('disconnect', (reason) => console.log('[DevzServer] Socket disconnected:', reason));
} catch (e) {
    console.error('[DevzServer] Failed to initialize socket:', e);
}

let currentPath = '';
let selectedItem = null;
let currentPromptAction = null;
const MAX_CONSOLE_LINES = 1000;

// CSRF Token
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

// === Helpers ===
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(d) {
    return new Date(d).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = message;
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

async function apiFetch(url, options = {}) {
    const defaults = {
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
    };
    const merged = { ...defaults, ...options };
    if (options.headers) merged.headers = { ...defaults.headers, ...options.headers };

    const res = await fetch(url, merged);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

// === File Icon Mapping ===
function getFileIcon(item) {
    if (item.isDirectory) return '<svg class="file-icon folder"><use href="#icon-folder"/></svg>';

    const ext = item.name.split('.').pop().toLowerCase();
    const configExts = ['yml', 'yaml', 'json', 'toml', 'ini', 'properties', 'cfg'];
    const codeExts = ['js', 'ts', 'py', 'java', 'sh', 'bat', 'cmd'];

    if (configExts.includes(ext)) return '<svg class="file-icon config"><use href="#icon-files"/></svg>';
    if (codeExts.includes(ext)) return '<svg class="file-icon code"><use href="#icon-files"/></svg>';
    return '<svg class="file-icon default"><use href="#icon-files"/></svg>';
}

// === Tab Switching ===
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.getElementById('nav-' + tabId).classList.add('active');
    if (tabId === 'files') loadFiles();
    if (tabId === 'backups') loadBackups();
}

// === Console ===
function classifyLine(text) {
    if (text.includes('[STDERR]') || text.includes('[ERROR]') || text.includes('Error') || text.includes('Exception')) return 'line-error';
    if (text.includes('[WARN]') || text.includes('WARN')) return 'line-warn';
    if (text.includes('[INFO]')) return 'line-info';
    if (text.startsWith('---') || text.startsWith('[SYSTEM]')) return 'line-system';
    if (text.includes('Done') || text.includes('complete') || text.includes('accepted')) return 'line-success';
    return '';
}

socket.on('console', (data) => {
    const consoleDiv = document.getElementById('console');
    const lines = data.split('\n');

    lines.forEach(lineText => {
        if (!lineText.trim()) return;
        const line = document.createElement('div');
        line.className = `terminal-line ${classifyLine(lineText)}`;
        line.textContent = lineText;
        consoleDiv.appendChild(line);
    });

    // Limit console lines to prevent memory issues
    while (consoleDiv.childElementCount > MAX_CONSOLE_LINES) {
        consoleDiv.removeChild(consoleDiv.firstChild);
    }

    consoleDiv.scrollTop = consoleDiv.scrollHeight;
});

socket.on('status', (status) => {
    const badge = document.getElementById('status-badge');
    badge.className = `status-badge status-${status}`;
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    badge.innerHTML = `<div class="status-dot"></div><span>${escapeHtml(label)}</span>`;

    // Update button states
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnRestart = document.getElementById('btn-restart');

    btnStart.disabled = status !== 'stopped';
    btnStop.disabled = status === 'stopped';
    btnRestart.disabled = status === 'stopped';
});

function control(action) {
    socket.emit('control', action);
    toast(`Server ${action}...`, 'info');
}

function sendCmd() {
    const input = document.getElementById('cmd-input');
    const cmd = input.value.trim();
    if (cmd) {
        socket.emit('command', cmd);
        // Echo the command in console
        const consoleDiv = document.getElementById('console');
        const line = document.createElement('div');
        line.className = 'terminal-line line-system';
        line.textContent = `> ${cmd}`;
        consoleDiv.appendChild(line);
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
        input.value = '';
    }
}

function clearConsole() {
    const consoleDiv = document.getElementById('console');
    consoleDiv.innerHTML = '<div class="terminal-line line-system">Console cleared.</div>';
}

// === Files ===
async function loadFiles(filePath) {
    if (filePath !== undefined) currentPath = filePath;
    updateBreadcrumb();
    const list = document.getElementById('file-list');
    list.innerHTML = '<div class="empty-state"><div class="loading-spinner"></div></div>';

    try {
        const files = await apiFetch(`/api/files?path=${encodeURIComponent(currentPath)}`);

        if (files.length === 0) {
            list.innerHTML = '<div class="empty-state"><svg><use href="#icon-folder"/></svg><div>Folder is empty</div></div>';
            return;
        }

        list.innerHTML = files.map(f => {
            const safePath = escapeHtml(f.path);
            const safeName = escapeHtml(f.name);
            return `
            <div class="file-item" onclick="handleItemClick('${safePath}', ${f.isDirectory})">
                <div class="file-item-name">
                    ${getFileIcon(f)}
                    <span>${safeName}</span>
                </div>
                <span class="file-item-meta">${f.isDirectory ? '--' : formatSize(f.size)}</span>
                <span class="file-item-meta">${formatDate(f.mtime)}</span>
                <div class="file-actions">
                    <button class="btn-icon" onclick="event.stopPropagation(); showRenameModal('${safePath}', '${safeName}')" title="Rename">
                        <svg><use href="#icon-edit"/></svg>
                    </button>
                    <button class="btn-icon" style="color:var(--danger)" onclick="event.stopPropagation(); deleteItem('${safePath}')" title="Delete">
                        <svg><use href="#icon-trash"/></svg>
                    </button>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        list.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error: ${escapeHtml(e.message)}</div>`;
    }
}

function handleItemClick(filePath, isDir) {
    if (isDir) loadFiles(filePath);
    else openEditor(filePath);
}

function updateBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    const parts = currentPath.split('/').filter(p => p);

    let html = '<span class="breadcrumb-item" onclick="loadFiles(\'\')">root</span>';
    let acc = '';
    parts.forEach(p => {
        acc += (acc ? '/' : '') + p;
        const target = acc;
        html += `<span class="breadcrumb-sep">/</span><span class="breadcrumb-item" onclick="loadFiles('${escapeHtml(target)}')">${escapeHtml(p)}</span>`;
    });
    bc.innerHTML = html;
}

// === File Editor ===
async function openEditor(filePath) {
    try {
        const data = await apiFetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
        selectedItem = filePath;
        document.getElementById('editor-title').textContent = filePath.split('/').pop();
        document.getElementById('editor-content').value = data.content;
        showModal('editor-modal');
    } catch (err) {
        toast('Failed to read file: ' + err.message, 'error');
    }
}

async function saveFile() {
    const content = document.getElementById('editor-content').value;
    try {
        await apiFetch('/api/files/save', {
            method: 'POST',
            body: JSON.stringify({ path: selectedItem, content })
        });
        closeModal('editor-modal');
        toast('File saved successfully', 'success');
        loadFiles();
    } catch (err) {
        toast('Failed to save: ' + err.message, 'error');
    }
}

// === Create / Rename ===
function showCreateModal(type) {
    currentPromptAction = type === 'file' ? 'createFile' : 'createFolder';
    document.getElementById('prompt-title').textContent = type === 'file' ? 'Create New File' : 'Create New Folder';
    document.getElementById('prompt-label').textContent = 'NAME';
    document.getElementById('prompt-input').value = '';
    showModal('prompt-modal');
    document.getElementById('prompt-confirm-btn').onclick = handlePromptSubmit;
    setTimeout(() => document.getElementById('prompt-input').focus(), 150);
}

function showRenameModal(filePath, name) {
    selectedItem = filePath;
    currentPromptAction = 'rename';
    document.getElementById('prompt-title').textContent = 'Rename Item';
    document.getElementById('prompt-label').textContent = 'NEW NAME';
    document.getElementById('prompt-input').value = name;
    showModal('prompt-modal');
    document.getElementById('prompt-confirm-btn').onclick = handlePromptSubmit;
    setTimeout(() => document.getElementById('prompt-input').focus(), 150);
}

async function handlePromptSubmit() {
    const name = document.getElementById('prompt-input').value.trim();
    if (!name) return;

    try {
        if (currentPromptAction === 'createFile') {
            await apiFetch('/api/files/save', {
                method: 'POST',
                body: JSON.stringify({ path: (currentPath ? currentPath + '/' : '') + name, content: '' })
            });
            toast('File created', 'success');
        } else if (currentPromptAction === 'createFolder') {
            await apiFetch('/api/files/folder', {
                method: 'POST',
                body: JSON.stringify({ path: currentPath, name })
            });
            toast('Folder created', 'success');
        } else if (currentPromptAction === 'rename') {
            await apiFetch('/api/files/rename', {
                method: 'POST',
                body: JSON.stringify({ oldPath: selectedItem, newName: name })
            });
            toast('Item renamed', 'success');
        }
        closeModal('prompt-modal');
        loadFiles();
    } catch (err) {
        toast('Operation failed: ' + err.message, 'error');
    }
}

async function deleteItem(filePath) {
    const fileName = filePath.split('/').pop();
    if (!confirm(`Delete "${fileName}" permanently?`)) return;
    try {
        await apiFetch('/api/files/delete', {
            method: 'POST',
            body: JSON.stringify({ path: filePath })
        });
        toast('Item deleted', 'success');
        loadFiles();
    } catch (err) {
        toast('Delete failed: ' + err.message, 'error');
    }
}

async function uploadFile() {
    const input = document.getElementById('file-upload');
    if (!input.files[0]) return;

    const formData = new FormData();
    formData.append('path', currentPath);
    formData.append('file', input.files[0]);

    try {
        const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        toast(`Uploaded: ${data.name || input.files[0].name}`, 'success');
        loadFiles();
    } catch (err) {
        toast('Upload failed: ' + err.message, 'error');
    }
    input.value = '';
}

// === Backups ===
async function loadBackups() {
    const list = document.getElementById('backup-list');
    try {
        const backups = await apiFetch('/api/backups');

        if (backups.length === 0) {
            list.innerHTML = '<div class="empty-state"><svg><use href="#icon-backup"/></svg><div>No backups available</div></div>';
            return;
        }

        list.innerHTML = backups.map(b => `
            <div class="backup-item">
                <div class="backup-name">
                    <svg class="file-icon" style="color:var(--primary-light)"><use href="#icon-backup"/></svg>
                    <span>${escapeHtml(b.name)}</span>
                </div>
                <span class="backup-meta">${formatSize(b.size)}</span>
                <span class="backup-meta">${formatDate(b.date)}</span>
                <div style="text-align:right">
                    <a href="/api/backups/download/${encodeURIComponent(b.name)}" class="btn btn-sm btn-outline" download>
                        <svg style="width:14px;height:14px"><use href="#icon-download"/></svg> Download
                    </a>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<div class="empty-state" style="color:var(--danger)">Failed to load backups</div>`;
    }
}

async function createBackup() {
    const btn = document.getElementById('btn-backup');
    const oldHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner"></div> Creating...';

    try {
        await apiFetch('/api/backups', { method: 'POST' });
        toast('Backup created successfully', 'success');
        loadBackups();
    } catch (err) {
        toast('Backup failed: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = oldHTML;
}

// === Modal Helpers ===
function showModal(id) {
    const modal = document.getElementById(id);
    modal.classList.add('visible');
    modal.style.display = 'flex';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    modal.classList.remove('visible');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('visible');
        setTimeout(() => { e.target.style.display = 'none'; }, 200);
    }
});

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.visible').forEach(m => closeModal(m.id));
    }
    // Enter in prompt modal submits
    if (e.key === 'Enter' && document.getElementById('prompt-modal').classList.contains('visible')) {
        handlePromptSubmit();
    }
});

// === Init ===
loadFiles('');
