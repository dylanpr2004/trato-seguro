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

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const JWT_SECRET = 'clave-secreta-Shopseguro';

// Cloudinary config
const CLOUDINARY_CLOUD = 'dkhwvhunl';
const CLOUDINARY_API_KEY = '251615288993297';
const CLOUDINARY_API_SECRET = 'RbsVuBOdhSc2CeDENSJAKJGUbkg';
const CLOUDINARY_PRESET = 'Shopseguro';

// Multer — guardar en memoria para enviar a Cloudinary
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por foto
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Solo se permiten imágenes'));
    }
});

// Función para subir una foto a Cloudinary
async function subirFotoCloudinary(buffer, mimetype) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', buffer, { contentType: mimetype, filename: 'foto.jpg' });
        form.append('upload_preset', CLOUDINARY_PRESET);
        form.append('folder', 'shopseguro/productos');

        const options = {
            hostname: 'api.cloudinary.com',
            path: `/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
            method: 'POST',
            headers: form.getHeaders()
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

// ── RUTAS ────────────────────────────────────────────────

app.get('/', (req, res) => res.send('¡Servidor de Shopseguro funcionando!'));

// REGISTRO
app.post('/api/registro', async (req, res) => {
    const { nombre, username, email, telefono, rut, password } = req.body;
    if (!nombre || !username || !email || !telefono || !rut || !password)
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });

    if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email))
        return res.status(400).json({ error: 'Este email ya está registrado' });

    if (db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username))
        return res.status(400).json({ error: 'Este nombre de usuario ya está en uso' });

    const passwordEncriptada = await bcrypt.hash(password, 10);
    const resultado = db.prepare(
        'INSERT INTO usuarios (nombre, username, email, telefono, rut, password) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(nombre, username, email, telefono, rut, passwordEncriptada);

    res.status(201).json({ mensaje: '¡Usuario registrado con éxito!', id: resultado.lastInsertRowid });
});

// LOGIN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email y contraseña son obligatorios' });

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario) return res.status(400).json({ error: 'Email o contraseña incorrectos' });

    const ok = await bcrypt.compare(password, usuario.password);
    if (!ok) return res.status(400).json({ error: 'Email o contraseña incorrectos' });

    const token = jwt.sign(
        { id: usuario.id, email: usuario.email, username: usuario.username },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
    res.json({ mensaje: '¡Login exitoso!', token, username: usuario.username });
});

// PUBLICAR PRODUCTO (con fotos)
app.post('/api/productos', upload.array('fotos', 5), async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesión para publicar' });

    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const { titulo, descripcion, precio, region, estado, categoria, motivo_venta } = req.body;

        if (!titulo || !descripcion || !precio || !region || !estado || !categoria)
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });

        const categoriasValidas = ['Tecnología','Hogar y Muebles','Vehículos','Ropa y Calzado','Deportes','Juegos y Consolas','Otros'];
        if (!categoriasValidas.includes(categoria))
            return res.status(400).json({ error: 'Categoría no válida' });

        // Subir fotos a Cloudinary
        let urlsFotos = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    const url = await subirFotoCloudinary(file.buffer, file.mimetype);
                    urlsFotos.push(url);
                } catch (e) {
                    console.log('Error subiendo foto:', e.message);
                }
            }
        }

        const resultado = db.prepare(`
            INSERT INTO productos (titulo, descripcion, precio, region, estado, categoria, motivo_venta, fotos, vendedor_id, vendedor_nombre)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(titulo, descripcion, precio, region, estado, categoria, motivo_venta || '', JSON.stringify(urlsFotos), datos.id, datos.username);

        res.status(201).json({ mensaje: '¡Producto publicado con éxito!', id: resultado.lastInsertRowid });
    } catch (error) {
        console.log(error);
        return res.status(401).json({ error: 'Sesión inválida, inicia sesión nuevamente' });
    }
});

// VER TODOS LOS PRODUCTOS
app.get('/api/productos', (req, res) => {
    const productos = db.prepare('SELECT * FROM productos ORDER BY fecha DESC').all();
    res.json(productos);
});

// VER PRODUCTOS POR CATEGORÍA
app.get('/api/productos/categoria/:categoria', (req, res) => {
    const categoria = decodeURIComponent(req.params.categoria);
    const productos = db.prepare('SELECT * FROM productos WHERE categoria = ? ORDER BY fecha DESC').all(categoria);
    res.json(productos);
});

// VER DETALLE DE UN PRODUCTO
app.get('/api/productos/:id', (req, res) => {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    // Datos del vendedor
    const vendedor = db.prepare('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE id = ?').get(producto.vendedor_id);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado' });

    // Preferencias del vendedor
    const prefs = db.prepare('SELECT * FROM preferencias WHERE usuario_id = ?').get(vendedor.id);
    if (prefs && !prefs.mostrar_telefono) vendedor.telefono = null;

    // Conteo de amigos del vendedor
    const amigos = db.prepare(`
        SELECT COUNT(*) as total FROM amigos
        WHERE (solicitante_id = ? OR receptor_id = ?) AND estado = 'aceptado'
    `).get(vendedor.id, vendedor.id);

    // Conteo de productos publicados (como indicador de actividad)
    const totalProductos = db.prepare('SELECT COUNT(*) as total FROM productos WHERE vendedor_id = ?').get(vendedor.id);

    // Parsear fotos
    let fotos = [];
    try { fotos = JSON.parse(producto.fotos || '[]'); } catch(e) {}

    res.json({
        producto: { ...producto, fotos },
        vendedor: {
            ...vendedor,
            total_amigos: amigos.total,
            total_productos: totalProductos.total
        }
    });
});

// PERFIL del usuario logueado
app.get('/api/perfil', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesión' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const usuario = db.prepare('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE id = ?').get(datos.id);
        const productos = db.prepare('SELECT * FROM productos WHERE vendedor_id = ?').all(datos.id);
        res.json({ usuario, productos });
    } catch (error) {
        return res.status(401).json({ error: 'Sesión inválida' });
    }
});

// PERFIL PÚBLICO
app.get('/api/usuario/:username', (req, res) => {
    const usernameClean = req.params.username.replace('@', '');
    const usuario = db.prepare('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE username = ?').get(usernameClean);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const productos = db.prepare('SELECT * FROM productos WHERE vendedor_id = ?').all(usuario.id);
    const prefs = db.prepare('SELECT * FROM preferencias WHERE usuario_id = ?').get(usuario.id);
    if (prefs && !prefs.mostrar_telefono) usuario.telefono = null;

    res.json({ usuario, productos });
});

// PREFERENCIAS
app.get('/api/preferencias', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        let prefs = db.prepare('SELECT * FROM preferencias WHERE usuario_id = ?').get(datos.id);
        if (!prefs) {
            db.prepare('INSERT INTO preferencias (usuario_id) VALUES (?)').run(datos.id);
            prefs = db.prepare('SELECT * FROM preferencias WHERE usuario_id = ?').get(datos.id);
        }
        res.json(prefs);
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

app.post('/api/preferencias', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const { mostrar_telefono, notificaciones_email, perfil_visible } = req.body;
        db.prepare(`
            INSERT INTO preferencias (usuario_id, mostrar_telefono, notificaciones_email, perfil_visible)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(usuario_id) DO UPDATE SET
            mostrar_telefono = ?, notificaciones_email = ?, perfil_visible = ?
        `).run(datos.id, mostrar_telefono, notificaciones_email, perfil_visible, mostrar_telefono, notificaciones_email, perfil_visible);
        res.json({ mensaje: 'Preferencias guardadas' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// MENSAJES PRIVADOS
app.post('/api/mensajes', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const { destinatario, texto } = req.body;
        const dest = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(destinatario.replace('@', ''));
        if (!dest) return res.status(404).json({ error: 'Usuario no encontrado' });
        db.prepare('INSERT INTO mensajes (remitente_id, destinatario_id, texto) VALUES (?, ?, ?)').run(datos.id, dest.id, texto);
        emitirNotificacion(dest.id, 'mensaje', 'Nuevo mensaje de @' + datos.username);
        res.json({ mensaje: 'Mensaje enviado' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

app.get('/api/mensajes/:username', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const otro = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(req.params.username.replace('@', ''));
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });
        const mensajes = db.prepare(`
            SELECT m.*, u.username as remitente_username FROM mensajes m
            JOIN usuarios u ON m.remitente_id = u.id
            WHERE (m.remitente_id = ? AND m.destinatario_id = ?)
            OR (m.remitente_id = ? AND m.destinatario_id = ?)
            ORDER BY m.fecha ASC
        `).all(datos.id, otro.id, otro.id, datos.id);
        res.json(mensajes);
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

app.get('/api/conversaciones', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const conversaciones = db.prepare(`
            SELECT DISTINCT u.username, u.nombre,
            (SELECT texto FROM mensajes
             WHERE (remitente_id = ? AND destinatario_id = u.id)
             OR (remitente_id = u.id AND destinatario_id = ?)
             ORDER BY fecha DESC LIMIT 1) as ultimo_mensaje
            FROM usuarios u
            WHERE u.id IN (
                SELECT CASE WHEN remitente_id = ? THEN destinatario_id ELSE remitente_id END
                FROM mensajes WHERE remitente_id = ? OR destinatario_id = ?
            )
        `).all(datos.id, datos.id, datos.id, datos.id, datos.id);
        res.json(conversaciones);
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// NOTIFICACIONES
app.get('/api/notificaciones', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const notificaciones = db.prepare('SELECT * FROM notificaciones WHERE usuario_id = ? ORDER BY fecha DESC LIMIT 10').all(datos.id);
        const noLeidas = db.prepare('SELECT COUNT(*) as count FROM notificaciones WHERE usuario_id = ? AND leida = 0').get(datos.id);
        res.json({ notificaciones, noLeidas: noLeidas.count });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

app.post('/api/notificaciones/leer', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        db.prepare('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ?').run(datos.id);
        res.json({ mensaje: 'Notificaciones marcadas como leídas' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// AMIGOS
app.post('/api/amigos/solicitud', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const { username } = req.body;
        if (username === datos.username) return res.status(400).json({ error: 'No puedes enviarte una solicitud a ti mismo' });
        const receptor = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
        if (!receptor) return res.status(404).json({ error: 'Usuario no encontrado' });
        const existe = db.prepare('SELECT id FROM amigos WHERE (solicitante_id = ? AND receptor_id = ?) OR (solicitante_id = ? AND receptor_id = ?)').get(datos.id, receptor.id, receptor.id, datos.id);
        if (existe) return res.status(400).json({ error: 'Ya existe una solicitud o ya son amigos' });
        db.prepare('INSERT INTO amigos (solicitante_id, receptor_id) VALUES (?, ?)').run(datos.id, receptor.id);
        emitirNotificacion(receptor.id, 'amistad', '@' + datos.username + ' te envió una solicitud de amistad');
        res.json({ mensaje: 'Solicitud enviada' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

app.post('/api/amigos/responder', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const { solicitudId, accion } = req.body;
        if (accion === 'aceptar') {
            db.prepare('UPDATE amigos SET estado = "aceptado" WHERE id = ? AND receptor_id = ?').run(solicitudId, datos.id);
            const solicitud = db.prepare('SELECT * FROM amigos WHERE id = ?').get(solicitudId);
            if (solicitud) emitirNotificacion(solicitud.solicitante_id, 'amistad', '@' + datos.username + ' aceptó tu solicitud de amistad');
        } else {
            db.prepare('DELETE FROM amigos WHERE id = ? AND receptor_id = ?').run(solicitudId, datos.id);
        }
        res.json({ mensaje: accion === 'aceptar' ? 'Solicitud aceptada' : 'Solicitud rechazada' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

app.get('/api/amigos', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const amigos = db.prepare(`
            SELECT u.username, u.nombre, a.id, a.estado, a.solicitante_id
            FROM amigos a
            JOIN usuarios u ON (CASE WHEN a.solicitante_id = ? THEN a.receptor_id ELSE a.solicitante_id END = u.id)
            WHERE (a.solicitante_id = ? OR a.receptor_id = ?) AND a.estado = 'aceptado'
        `).all(datos.id, datos.id, datos.id);
        const pendientes = db.prepare(`
            SELECT u.username, u.nombre, a.id FROM amigos a
            JOIN usuarios u ON a.solicitante_id = u.id
            WHERE a.receptor_id = ? AND a.estado = 'pendiente'
        `).all(datos.id);
        res.json({ amigos, pendientes });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

app.delete('/api/amigos/:amigoUsername', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, JWT_SECRET);
        const amigo = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(req.params.amigoUsername);
        if (!amigo) return res.status(404).json({ error: 'Usuario no encontrado' });
        db.prepare('DELETE FROM amigos WHERE ((solicitante_id = ? AND receptor_id = ?) OR (solicitante_id = ? AND receptor_id = ?)) AND estado = "aceptado"').run(datos.id, amigo.id, amigo.id, datos.id);
        res.json({ mensaje: 'Amigo eliminado' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// CHAT EN TIEMPO REAL
const mensajesChat = [];

// Emite notificacion en tiempo real al usuario por su sala personal
function emitirNotificacion(usuarioId, tipo, mensaje) {
    try {
        db.prepare('INSERT INTO notificaciones (usuario_id, tipo, mensaje) VALUES (?, ?, ?)').run(usuarioId, tipo, mensaje);
        io.to('user_' + usuarioId).emit('nueva-notificacion', { tipo, mensaje });
    } catch(e) { console.log('Error notificacion:', e); }
}

io.on('connection', (socket) => {
    socket.emit('historial', mensajesChat);

    // El frontend se autentica para recibir notificaciones en tiempo real
    socket.on('autenticar', (username) => {
        try {
            const u = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
            if (u) socket.join('user_' + u.id);
        } catch(e) {}
    });

    socket.on('mensaje', (datos) => {
        const mensaje = { usuario: datos.usuario, texto: datos.texto, hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) };
        mensajesChat.push(mensaje);
        io.emit('mensaje', mensaje);
    });

    socket.on('mensaje-privado', (datos) => {
        io.emit('mensaje-privado', datos);
        try {
            const destinatario = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(datos.para);
            if (destinatario) emitirNotificacion(destinatario.id, 'mensaje', 'Nuevo mensaje de @' + datos.de);
        } catch(e) {}
    });
});


// RANKING DE MEJORES VENDEDORES
app.get('/api/ranking-vendedores', (req, res) => {
    try {
        const vendedores = db.prepare(`
            SELECT 
                u.id, u.username, u.nombre, u.fecha_registro,
                COUNT(DISTINCT p.id) as total_productos,
                COUNT(DISTINCT a.id) as total_amigos
            FROM usuarios u
            LEFT JOIN productos p ON p.vendedor_id = u.id
            LEFT JOIN amigos a ON (a.solicitante_id = u.id OR a.receptor_id = u.id) AND a.estado = 'aceptado'
            GROUP BY u.id
            ORDER BY total_productos DESC, total_amigos DESC
            LIMIT 5
        `).all();
        res.json(vendedores);
    } catch(e) {
        res.status(500).json({ error: 'Error obteniendo ranking' });
    }
});


// BÚSQUEDA INTELIGENTE DE PRODUCTOS
app.get('/api/buscar', (req, res) => {
    try {
        const { q = '', categoria = '', condicion = '', precio_min = 0, precio_max = 999999999, orden = 'reciente' } = req.query;

        // Dividir la búsqueda en palabras para búsqueda parcial
        const palabras = q.trim().toLowerCase().split(/\s+/).filter(p => p.length > 0);

        let productos = db.prepare('SELECT * FROM productos').all();

        // Filtrar por palabras clave (búsqueda en título y descripción)
        if (palabras.length > 0) {
            productos = productos.filter(p => {
                const texto = (p.titulo + ' ' + p.descripcion).toLowerCase();
                return palabras.some(palabra => texto.includes(palabra));
            });
            // Ordenar por relevancia: más palabras coinciden = más arriba
            productos = productos.map(p => {
                const texto = (p.titulo + ' ' + p.descripcion).toLowerCase();
                const tituloTexto = p.titulo.toLowerCase();
                let score = 0;
                palabras.forEach(palabra => {
                    if (tituloTexto.includes(palabra)) score += 3; // título vale más
                    else if (texto.includes(palabra)) score += 1;
                });
                return { ...p, score };
            }).sort((a, b) => b.score - a.score);
        }

        // Filtros adicionales
        if (categoria) productos = productos.filter(p => p.categoria === categoria);
        if (condicion) productos = productos.filter(p => p.estado === condicion);
        productos = productos.filter(p => p.precio >= precio_min && p.precio <= precio_max);

        // Orden
        if (orden === 'precio_asc') productos.sort((a, b) => a.precio - b.precio);
        else if (orden === 'precio_desc') productos.sort((a, b) => b.precio - a.precio);
        else if (orden === 'reciente' && palabras.length === 0) productos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        // Parsear fotos
        productos = productos.map(p => {
            let fotos = [];
            try { fotos = JSON.parse(p.fotos || '[]'); } catch(e) {}
            return { ...p, fotos };
        });

        res.json({ resultados: productos, total: productos.length });
    } catch(e) {
        console.log('Error búsqueda:', e);
        res.status(500).json({ error: 'Error en la búsqueda' });
    }
});

servidor.listen(3000, () => console.log('Servidor corriendo en http://localhost:3000'));
