const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database');
const cors = require('cors');
const multer = require('multer');
const https = require('https');
const FormData = require('form-data');

const CLOUDINARY_CLOUD = 'dkhwvhunl';
const CLOUDINARY_PRESET = 'Shopseguro';
const SECRET_KEY = 'clave-secreta-Shopseguro';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

async function subirFotoCloudinary(buffer, mimetype) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', buffer, { contentType: mimetype, filename: 'foto.jpg' });
        form.append('upload_preset', CLOUDINARY_PRESET);
        const options = {
            hostname: 'api.cloudinary.com',
            path: `/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
            method: 'POST', headers: form.getHeaders()
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const json = JSON.parse(data);
                if (json.secure_url) resolve(json.secure_url);
                else reject(new Error('Error Cloudinary'));
            });
        });
        req.on('error', reject);
        form.pipe(req);
    });
}

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- PRODUCTOS: SIN FANTASMAS ---
app.get('/api/productos', (req, res) => {
    try {
        const productos = db.prepare(`
            SELECT p.*, u.username as vendedor_nombre 
            FROM productos p 
            INNER JOIN usuarios u ON p.vendedor_id = u.id 
            ORDER BY p.id DESC
        `).all();
        res.json(productos);
    } catch (e) { res.json([]); }
});

// --- REGISTRO Y LOGIN ---
app.post('/api/registro', async (req, res) => {
    const { nombre, username, email, telefono, rut, password } = req.body;
    try {
        const pass = await bcrypt.hash(password, 10);
        db.prepare('INSERT INTO usuarios (nombre, username, email, telefono, rut, password) VALUES (?, ?, ?, ?, ?, ?)').run(nombre, username, email, telefono, rut, pass);
        res.status(201).json({ mensaje: 'Ok' });
    } catch (e) { res.status(400).json({ error: 'Ya existe' }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Mal' });
    const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY);
    res.json({ token, username: user.username });
});

// --- PERFIL: DATOS REALES ---
app.get('/api/perfil', (req, res) => {
    const token = req.headers['authorization'];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const usuario = db.prepare('SELECT id, nombre, username, email, telefono FROM usuarios WHERE id = ?').get(decoded.id);
        const productos = db.prepare('SELECT * FROM productos WHERE vendedor_id = ?').all(decoded.id);
        res.json({ usuario, productos });
    } catch (e) { res.status(401).send(); }
});

// --- NOTIFICACIONES (PARA ELIMINAR EL 404) ---
app.get('/api/notificaciones', (req, res) => {
    const token = req.headers['authorization'];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const notis = db.prepare('SELECT * FROM notificaciones WHERE usuario_id = ? ORDER BY id DESC LIMIT 10').all(decoded.id);
        res.json({ notificaciones: notis, noLeidas: notis.filter(n => !n.leida).length });
    } catch (e) { res.status(401).send(); }
});

// --- PUBLICAR ---
app.post('/api/productos', upload.array('fotos', 5), async (req, res) => {
    const token = req.headers['authorization'];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { titulo, descripcion, precio, region, estado, categoria } = req.body;
        let fotos = [];
        if (req.files) for (const f of req.files) fotos.push(await subirFotoCloudinary(f.buffer, f.mimetype));
        db.prepare('INSERT INTO productos (titulo, descripcion, precio, region, estado, categoria, fotos, vendedor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(titulo, descripcion, precio, region, estado, categoria, JSON.stringify(fotos), decoded.id);
        res.status(201).send();
    } catch (e) { res.status(401).send(); }
});
// --- ESTO VA AL FINAL DE TU server.js, ANTES DE servidor.listen ---

// Ruta para Notificaciones (Elimina el error 404 de tu imagen)
app.get('/api/notificaciones', (req, res) => {
    const token = req.headers['authorization'];
    try {
        const decoded = jwt.verify(token, 'clave-secreta-Shopseguro');
        // Enviamos una respuesta vacía pero válida para que no dé error
        res.json({ notificaciones: [], noLeidas: 0 });
    } catch (e) {
        res.status(401).json({ error: 'Token inválido' });
    }
});

// Ruta para Ranking (Elimina el otro error 404 de tu imagen)
app.get('/api/ranking-vendedores', (req, res) => {
    try {
        const ranking = db.prepare(`
            SELECT username, COUNT(*) as ventas 
            FROM usuarios 
            LIMIT 5
        `).all();
        res.json(ranking);
    } catch (e) {
        res.json([]);
    }
});
// ESTO ELIMINA LOS ERRORES 404 DE TU IMAGEN
app.get('/api/ranking-vendedores', (req, res) => {
    res.json([]); // Devuelve lista vacía para que la web no se bloquee
});

app.get('/api/notificaciones', (req, res) => {
    res.json({ notificaciones: [], noLeidas: 0 });
});

// Ruta de seguridad para saber si el servidor está actualizado
app.get('/api/test', (req, res) => {
    res.send("Servidor actualizado: " + new Date().toLocaleString());
});

servidor.listen(3000, () => console.log('Servidor OK'));