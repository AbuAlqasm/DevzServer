require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const morgan = require('morgan');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const MinecraftServer = require('./server/MinecraftServer');
const BackupManager = require('./backup/BackupManager');
const FileManager = require('./utils/FileManager');
const cron = require('node-cron');

// Load Config
const configPath = path.join(__dirname, '../config/config.yml');
if (!fs.existsSync(configPath)) {
    console.error('Config file missing! Please ensure config/config.yml exists.');
    process.exit(1);
}
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

const app = express();
const server = http.createServer(app);

// Proxy settings for platforms like Railway
app.set('trust proxy', 1);

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.resolve(__dirname, '../../minecraft/server', req.body.path || '');
        if (!dir.startsWith(path.resolve(__dirname, '../../minecraft/server'))) {
            return cb(new Error('Invalid upload path'));
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

// Session configuration
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'devz-server-rebuilt',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
});

app.use(sessionMiddleware);

// Initialize Components
const io = socketIo(server);
const mcServer = new MinecraftServer(io);
const backupManager = new BackupManager(config);
const fileManager = new FileManager();

// Schedule Backups
if (config.backup.enabled) {
    cron.schedule(`0 */${config.backup.interval_hours} * * *`, () => {
        console.log('Starting automated backup...');
        backupManager.createBackup();
    });
}

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Set View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Rate Limiting
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many login attempts',
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

// Auth Guard
const auth = (req, res, next) => {
    if (!req.session.user) return res.status(401).redirect('/login');
    next();
};

// Routes
app.get('/', auth, (req, res) => res.render('dashboard', { config, user: req.session.user }));

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { error: req.query.error });
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || config.panel.owner_user;
    const adminPassHash = process.env.ADMIN_PASSWORD_HASH;

    if (username === adminUser) {
        if (adminPassHash && adminPassHash.startsWith('$')) {
            try {
                const isValid = await bcrypt.compare(password, adminPassHash);
                if (isValid) {
                    req.session.user = { username, role: 'owner' };
                    return res.redirect('/');
                }
            } catch (err) { console.error('Bcrypt Error:', err); }
        } else if (!adminPassHash && password === config.panel.owner_pass) {
            req.session.user = { username, role: 'owner' };
            return res.redirect('/');
        }
    }
    res.redirect('/login?error=Invalid credentials or server configuration');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Advanced File API
app.get('/api/files', auth, (req, res) => {
    try {
        res.json(fileManager.listFiles(req.query.path || ''));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/files/content', auth, (req, res) => {
    try {
        res.json({ content: fileManager.readFile(req.query.path) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/save', auth, (req, res) => {
    try {
        fileManager.writeFile(req.body.path, req.body.content);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/rename', auth, (req, res) => {
    try {
        fileManager.renameItem(req.body.oldPath, req.body.newName);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/delete', auth, (req, res) => {
    try {
        fileManager.deleteItem(req.body.path);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/folder', auth, (req, res) => {
    try {
        fileManager.createFolder(req.body.path, req.body.name);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/upload', auth, upload.single('file'), (req, res) => {
    res.json({ success: true });
});

// Backups API
app.get('/api/backups', auth, (req, res) => res.json(backupManager.listBackups()));
app.post('/api/backups', auth, async (req, res) => {
    try {
        const name = await backupManager.createBackup();
        res.json({ success: true, name });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Socket.IO
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.user) return socket.disconnect(true);
    socket.emit('status', mcServer.status);
    socket.on('control', (action) => {
        console.log(`[SOCKET] Action received from ${session.user.username}: ${action}`);
        if (action === 'start') mcServer.start();
        if (action === 'stop') mcServer.stop();
        if (action === 'restart') {
            mcServer.stop();
            const checkStop = setInterval(() => {
                if (mcServer.status === 'stopped') {
                    clearInterval(checkStop);
                    mcServer.start();
                }
            }, 500);
            // Timeout safety for restart
            setTimeout(() => clearInterval(checkStop), 20000);
        }
    });
    socket.on('command', (cmd) => mcServer.sendCommand(cmd));
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Internal Server Error');
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Panel online at port ${PORT}`));
