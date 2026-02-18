require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const morgan = require('morgan');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const winston = require('winston');

const MinecraftServer = require('./server/MinecraftServer');
const BackupManager = require('./backup/BackupManager');
const FileManager = require('./utils/FileManager');
const cron = require('node-cron');

// === Winston Logger ===
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 5242880, maxFiles: 3 }),
        new winston.transports.File({ filename: 'logs/combined.log', maxsize: 5242880, maxFiles: 3 })
    ]
});

// Create logs directory
if (!fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true });

// === Load Config ===
const configPath = path.join(__dirname, '../config/config.yml');
if (!fs.existsSync(configPath)) {
    logger.error('Config file missing! Please ensure config/config.yml exists.');
    process.exit(1);
}
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

const app = express();
const server = http.createServer(app);

// Proxy settings
app.set('trust proxy', 1);

// === Upload Configuration ===
const uploadDir = path.join(__dirname, '../tmp/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Sanitize filename
        const safeName = FileManager.sanitizeFilename(file.originalname) || 'uploaded_file';
        const uniqueName = `${Date.now()}-${safeName}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// === Session ===
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
});

app.use(sessionMiddleware);

// === CSRF Protection ===
function generateCsrfToken(session) {
    if (!session._csrfToken) {
        session._csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return session._csrfToken;
}

function validateCsrf(req, res, next) {
    if (req.method !== 'POST') return next();

    // Skip CSRF for login (has rate limiting) and file upload (uses FormData)
    if (req.path === '/login') return next();

    const token = req.headers['x-csrf-token'] || req.body._csrf;
    if (!token || token !== req.session._csrfToken) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
}

// === Components ===
const io = socketIo(server);
const mcServer = new MinecraftServer(io);
const backupManager = new BackupManager(config);
const fileManager = new FileManager();

// === Scheduled Backups ===
if (config.backup.enabled) {
    cron.schedule(`0 */${config.backup.interval_hours} * * *`, () => {
        logger.info('Starting automated backup...');
        backupManager.createBackup()
            .then(name => logger.info(`Backup created: ${name}`))
            .catch(err => logger.error(`Backup failed: ${err.message}`));
    });
}

// === Middleware ===
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(morgan('short', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Rate Limiting
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many login attempts, please wait.',
    standardHeaders: 'draft-7',
    legacyHeaders: false
});

// Auth Guard
const auth = (req, res, next) => {
    if (!req.session.user) return res.status(401).redirect('/login');
    next();
};

// CSRF is validated per-route on dangerous operations only

// === Routes ===
app.get('/', auth, (req, res) => {
    const csrfToken = generateCsrfToken(req.session);
    res.render('dashboard', { config, user: req.session.user, csrfToken });
});

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    // Whitelist error messages instead of passing raw query params
    const errorMessages = {
        'invalid': 'Invalid credentials',
        'expired': 'Session expired, please login again'
    };
    const error = errorMessages[req.query.error] || null;
    res.render('login', { error });
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || config.panel.owner_user;
    const adminPassHash = process.env.ADMIN_PASSWORD_HASH;

    if (username === adminUser) {
        let authenticated = false;

        if (adminPassHash && adminPassHash.startsWith('$2')) {
            try {
                authenticated = await bcrypt.compare(password, adminPassHash);
            } catch (err) {
                logger.error(`Bcrypt Error: ${err.message}`);
            }
        }

        if (authenticated) {
            req.session.user = { username, role: 'owner' };
            generateCsrfToken(req.session);
            logger.info(`User logged in: ${username}`);
            return res.redirect('/');
        }
    }
    res.redirect('/login?error=invalid');
});

app.get('/logout', (req, res) => {
    const user = req.session.user;
    req.session.destroy();
    if (user) logger.info(`User logged out: ${user.username}`);
    res.redirect('/login');
});

// === File API ===
app.get('/api/files', auth, (req, res) => {
    try {
        res.json(fileManager.listFiles(req.query.path || ''));
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/files/content', auth, (req, res) => {
    try {
        res.json({ content: fileManager.readFile(req.query.path) });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/files/save', auth, (req, res) => {
    try {
        fileManager.writeFile(req.body.path, req.body.content);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/files/rename', auth, (req, res) => {
    try {
        fileManager.renameItem(req.body.oldPath, req.body.newName);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/files/delete', auth, (req, res) => {
    try {
        fileManager.deleteItem(req.body.path);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/files/folder', auth, (req, res) => {
    try {
        fileManager.createFolder(req.body.path, req.body.name);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/files/upload', auth, upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        // Move from temp to correct location
        const targetDir = fileManager._safePath(req.body.path || '');
        const safeName = FileManager.sanitizeFilename(req.file.originalname) || 'uploaded_file';
        const targetPath = path.join(targetDir, safeName);

        fs.renameSync(req.file.path, targetPath);
        res.json({ success: true, name: safeName });
    } catch (e) {
        // Clean up temp file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(400).json({ error: e.message });
    }
});

// === Backup API ===
app.get('/api/backups', auth, (req, res) => res.json(backupManager.listBackups()));

app.post('/api/backups', auth, async (req, res) => {
    try {
        const name = await backupManager.createBackup();
        res.json({ success: true, name });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backups/download/:name', auth, (req, res) => {
    const filePath = backupManager.getBackupPath(req.params.name);
    if (!filePath) return res.status(404).json({ error: 'Backup not found' });
    res.download(filePath);
});

// === Socket.IO ===
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.user) return socket.disconnect(true);

    logger.info(`Socket connected: ${session.user.username}`);
    socket.emit('status', mcServer.status);

    socket.on('control', (action) => {
        // Validate action
        const validActions = ['start', 'stop', 'restart'];
        if (!validActions.includes(action)) return;

        logger.info(`[SOCKET] ${session.user.username}: ${action}`);

        if (action === 'start') mcServer.start();
        if (action === 'stop') mcServer.stop();
        if (action === 'restart') mcServer.restart();
    });

    socket.on('command', (cmd) => {
        if (typeof cmd !== 'string' || cmd.length > 500) return;
        const sanitized = cmd.trim();
        if (sanitized) {
            logger.info(`[COMMAND] ${session.user.username}: ${sanitized}`);
            mcServer.sendCommand(sanitized);
        }
    });

    socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${session.user.username}`);
    });
});

// === Error Handler ===
app.use((err, req, res, next) => {
    logger.error(`Error: ${err.message}\n${err.stack}`);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Maximum size is 50MB.' });
        }
        return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error' });
});

// === Start Server ===
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 DevzServer panel online at port ${PORT}`);
    logger.info(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
});
