const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg'); // CAMBIO: Usamos pg para Neon
const cors = require('cors');
const multer = require('multer');
const https = require('https');
const FormData = require('form-data');

// Configuración de base de datos Neon
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:TU_CONTRASEÑA_AQUÍ@ep-polished-cloud-amkbdwvv-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

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

// Función para inicializar tablas en Neon (PostgreSQL)
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nombre TEXT,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                telefono TEXT,
                rut TEXT,
                password TEXT,
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS productos (
                id SERIAL PRIMARY KEY,
                titulo TEXT,
                descripcion TEXT,
                precio DECIMAL,
                region TEXT,
                estado TEXT,
                categoria TEXT,
                motivo_venta TEXT,
                fotos TEXT,
                vendedor_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
                vendedor_nombre TEXT
            );
            CREATE TABLE IF NOT EXISTS preferencias (
                usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
                mostrar_telefono BOOLEAN DEFAULT TRUE,
                notificaciones_email BOOLEAN DEFAULT TRUE,
                perfil_visible BOOLEAN DEFAULT TRUE
            );
            CREATE TABLE IF NOT EXISTS mensajes (
                id SERIAL PRIMARY KEY,
                remitente_id INTEGER REFERENCES usuarios(id),
                destinatario_id INTEGER REFERENCES usuarios(id),
                texto TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS notificaciones (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id),
                tipo TEXT,
                mensaje TEXT,
                leida INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS amigos (
                id SERIAL PRIMARY KEY,
                solicitante_id INTEGER REFERENCES usuarios(id),
                receptor_id INTEGER REFERENCES usuarios(id),
                estado TEXT DEFAULT 'pendiente'
            );
        `);
        console.log("🔥 Base de datos Neon conectada y tablas listas");
    } catch (err) {
        console.error("❌ Error inicializando Neon:", err);
    }
};
initDB();

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
const io = new Server(servidor, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- RUTAS DE USUARIOS ---

app.post('/api/registro', async (req, res) => {
    const { nombre, username, email, telefono, rut, password } = req.body;
    if (!nombre || !username || !email || !telefono || !rut || !password) return res.status(400).json({ error: 'Faltan campos' });

    try {
        const passwordEncriptada = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO usuarios (nombre, username, email, telefono, rut, password) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [nombre, username, email, telefono, rut, passwordEncriptada]
        );
        res.status(201).json({ mensaje: 'Registrado con éxito', id: result.rows[0].id });
    } catch (e) {
        res.status(400).json({ error: 'Email o username ya existen' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        const usuario = result.rows[0];
        if (!usuario || !(await bcrypt.compare(password, usuario.password))) {
            return res.status(400).json({ error: 'Credenciales inválidas' });
        }
        const token = jwt.sign({ id: usuario.id, email: usuario.email, username: usuario.username }, 'clave-secreta-Shopseguro', { expiresIn: '7d' });
        res.json({ mensaje: '¡Login exitoso!', token, username: usuario.username });
    } catch (e) { res.status(500).json({ error: 'Error en login' }); }
});

// --- RUTAS DE PRODUCTOS (NEON STYLE) ---

app.get('/api/productos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, u.nombre AS vendedor_nombre 
            FROM productos p
            INNER JOIN usuarios u ON p.vendedor_id = u.id
            ORDER BY p.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

app.post('/api/productos', upload.array('fotos', 5), async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

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

        const result = await pool.query(`
            INSERT INTO productos (titulo, descripcion, precio, region, estado, categoria, motivo_venta, fotos, vendedor_id, vendedor_nombre)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
        `, [titulo, descripcion, precio, region, estado, categoria || 'Otros', motivo_venta || '', JSON.stringify(urlsFotos), datos.id, datos.username]);

        res.status(201).json({ mensaje: 'Publicado con éxito', id: result.rows[0].id });
    } catch(e) { res.status(401).json({ error: 'Error al publicar' }); }
});

app.get('/api/productos/:id', async (req, res) => {
    try {
        const pRes = await pool.query('SELECT * FROM productos WHERE id = $1', [req.params.id]);
        const producto = pRes.rows[0];
        if (!producto) return res.status(404).json({ error: 'No encontrado' });

        const vRes = await pool.query('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE id = $1', [producto.vendedor_id]);
        const vendedor = vRes.rows[0];

        const prefRes = await pool.query('SELECT * FROM preferencias WHERE usuario_id = $1', [vendedor.id]);
        if (prefRes.rows[0] && !prefRes.rows[0].mostrar_telefono) vendedor.telefono = null;

        const amigosRes = await pool.query('SELECT COUNT(*) FROM amigos WHERE (solicitante_id = $1 OR receptor_id = $1) AND estado = $2', [vendedor.id, 'aceptado']);
        const prodCountRes = await pool.query('SELECT COUNT(*) FROM productos WHERE vendedor_id = $1', [vendedor.id]);

        res.json({
            producto: { ...producto, fotos: JSON.parse(producto.fotos || '[]') },
            vendedor: { ...vendedor, total_amigos: amigosRes.rows[0].count, total_productos: prodCountRes.rows[0].count }
        });
    } catch (e) { res.status(500).json({ error: 'Error detalle' }); }
});

// --- MÁS RUTAS ADAPTADAS ---

app.get('/api/perfil', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No hay token' });
    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const userRes = await pool.query('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE id = $1', [datos.id]);
        const prodRes = await pool.query('SELECT * FROM productos WHERE vendedor_id = $1', [datos.id]);
        res.json({ usuario: userRes.rows[0], productos: prodRes.rows });
    } catch (e) { res.status(401).json({ error: 'Inválido' }); }
});

// --- CHAT Y NOTIFICACIONES (TIEMPO REAL) ---
io.on('connection', (socket) => {
    socket.on('mensaje-privado', async (datos) => {
        io.emit('mensaje-privado', datos);
        try {
            const destRes = await pool.query('SELECT id FROM usuarios WHERE username = $1', [datos.para.replace('@', '')]);
            if (destRes.rows[0]) {
                await pool.query('INSERT INTO notificaciones (usuario_id, tipo, mensaje) VALUES ($1, $2, $3)', 
                [destRes.rows[0].id, 'mensaje', `Nuevo mensaje de @${datos.de}`]);
            }
        } catch (e) { console.log('Error notificación'); }
    });
});

const PORT = process.env.PORT || 3000;
servidor.listen(PORT, () => {
    console.log(`🚀 Shopseguro Profesional en puerto ${PORT}`);
});