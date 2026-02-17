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

const MinecraftServer = require('./server/MinecraftServer');
const BackupManager = require('./backup/BackupManager');
const FileManager = require('./utils/FileManager');
const cron = require('node-cron');

// Load Config
const configPath = path.join(__dirname, '../config/config.yml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

const app = express();
const server = http.createServer(app);

// Session configuration
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'devz-server',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
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
app.use(helmet({
    contentSecurityPolicy: false, // EJS might need inline scripts for some features, we'll refine this if needed
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Set View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Rate Limiting for Login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login attempts per window
    message: 'Too many login attempts, please try again later'
});

// Basic Auth Middleware
const auth = (req, res, next) => {
    if (!req.session.user) return res.status(401).redirect('/login');
    next();
};

// Routes
app.get('/', auth, (req, res) => {
    res.render('dashboard', { config, user: req.session.user });
});

app.get('/api/files', auth, (req, res) => {
    try {
        const files = fileManager.listFiles(req.query.path || '');
        res.json(files);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/backups', auth, (req, res) => {
    res.json(backupManager.listBackups());
});

app.post('/api/backups', auth, async (req, res) => {
    const name = await backupManager.createBackup();
    res.json({ success: true, name });
});

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { error: req.query.error });
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || config.panel.owner_user;
    const adminPassHash = process.env.ADMIN_PASSWORD_HASH;

    if (username === adminUser) {
        const isValid = await bcrypt.compare(password, adminPassHash);
        if (isValid) {
            req.session.user = { username, role: 'owner' };
            return res.redirect('/');
        }
    }
    res.redirect('/login?error=Invalid credentials');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Socket.IO Logic with Session Auth
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.user) {
        console.log('Unauthorized socket connection rejected');
        return socket.disconnect(true);
    }

    console.log(`User connected: ${session.user.username}`);
    socket.emit('status', mcServer.status);

    socket.on('control', (action) => {
        if (action === 'start') mcServer.start();
        if (action === 'stop') mcServer.stop();
        if (action === 'restart') {
            mcServer.stop();
            setTimeout(() => mcServer.start(), 5000);
        }
    });

    socket.on('command', (cmd) => {
        mcServer.sendCommand(cmd);
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || config.panel.web_port || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Panel running on port ${PORT}`);
});

