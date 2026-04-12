const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database'); // Volvemos a tu archivo local
const cors = require('cors');
const multer = require('multer');
const https = require('https');
const FormData = require('form-data');

// Cloudinary config
const CLOUDINARY_CLOUD = 'dkhwvhunl';
const CLOUDINARY_PRESET = 'Shopseguro';

// Multer — memoria
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Solo imagenes'));
    }
});

// Subir foto a Cloudinary
async function subirFotoCloudinary(buffer, mimetype) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', buffer, { contentType: mimetype, filename: 'foto.jpg' });
        form.append('upload_preset', CLOUDINARY_PRESET);
        form.append('folder', 'shopseguro/productos');
        const options = {
            hostname: 'api.cloudinary.com',
            path: '/v1_1/' + CLOUDINARY_CLOUD + '/image/upload',
            method: 'POST', headers: form.getHeaders()
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.secure_url) resolve(json.secure_url);
                    else reject(new Error(json.error?.message || 'Error Cloudinary'));
                } catch(e) { reject(e); }
            });
        });
        req.on('error', reject);
        form.pipe(req);
    });
}

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor, {
    cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- RUTAS DE USUARIOS ---

app.post('/api/registro', async (req, res) => {
    const { nombre, username, email, telefono, rut, password } = req.body;
    try {
        const passwordEncriptada = await bcrypt.hash(password, 10);
        const resultado = db.prepare(
            'INSERT INTO usuarios (nombre, username, email, telefono, rut, password) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(nombre, username, email, telefono, rut, passwordEncriptada);
        res.status(201).json({ mensaje: '¡Usuario registrado!', id: resultado.lastInsertRowid });
    } catch (e) {
        res.status(400).json({ error: 'Email o Usuario ya existen' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario || !(await bcrypt.compare(password, usuario.password))) {
        return res.status(400).json({ error: 'Credenciales incorrectas' });
    }
    const token = jwt.sign(
        { id: usuario.id, email: usuario.email, username: usuario.username },
        'clave-secreta-Shopseguro',
        { expiresIn: '7d' }
    );
    res.json({ mensaje: '¡Login exitoso!', token, username: usuario.username });
});

// --- RUTAS DE PRODUCTOS (LIMPIEZA DE FANTASMAS) ---

app.get('/api/productos', (req, res) => {
    try {
        // MEJORA: Solo trae productos si el vendedor existe en la tabla de usuarios
        const productos = db.prepare(`
            SELECT p.* FROM productos p 
            INNER JOIN usuarios u ON p.vendedor_id = u.id 
            ORDER BY p.id DESC
        `).all();
        res.json(productos);
    } catch (error) {
        res.json([]); // Si hay error, devuelve lista vacía para que no se caiga el sitio
    }
});

app.post('/api/productos', upload.array('fotos', 5), async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Inicia sesión' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const { titulo, descripcion, precio, region, estado, categoria, motivo_venta } = req.body;
        
        let urlsFotos = [];
        if (req.files) {
            for (const file of req.files) {
                const url = await subirFotoCloudinary(file.buffer, file.mimetype);
                urlsFotos.push(url);
            }
        }

        const resultado = db.prepare(`
            INSERT INTO productos (titulo, descripcion, precio, region, estado, categoria, motivo_venta, fotos, vendedor_id, vendedor_nombre)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(titulo, descripcion, precio, region, estado, categoria, motivo_venta, JSON.stringify(urlsFotos), datos.id, datos.username);

        res.status(201).json({ mensaje: 'Publicado', id: resultado.lastInsertRowid });
    } catch(e) { res.status(401).json({ error: 'Sesión inválida' }); }
});

// --- RESTO DE RUTAS ---
app.get('/api/perfil', (req, res) => {
    const token = req.headers['authorization'];
    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const usuario = db.prepare('SELECT id, nombre, username, email, telefono FROM usuarios WHERE id = ?').get(datos.id);
        const productos = db.prepare('SELECT * FROM productos WHERE vendedor_id = ?').all(datos.id);
        res.json({ usuario, productos });
    } catch (e) { res.status(401).json({ error: 'Error' }); }
});

servidor.listen(3000, () => {
    console.log('✅ Servidor Shopseguro funcionando en http://localhost:3000');
});