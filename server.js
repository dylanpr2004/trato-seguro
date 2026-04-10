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
// Ruta de prueba
app.get('/', (req, res) => {
    res.send('¡Servidor de Shopseguro funcionando!');
});

// Ruta de REGISTRO
app.post('/api/registro', async (req, res) => {
    const { nombre, username, email, telefono, rut, password } = req.body;

if (!nombre || !username || !email || !telefono || !rut || !password) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const emailExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (emailExiste) {
        return res.status(400).json({ error: 'Este email ya está registrado' });
    }

    const usernameExiste = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
    if (usernameExiste) {
        return res.status(400).json({ error: 'Este nombre de usuario ya está en uso' });
    }

    const passwordEncriptada = await bcrypt.hash(password, 10);
    const resultado = db.prepare(
    'INSERT INTO usuarios (nombre, username, email, telefono, rut, password) VALUES (?, ?, ?, ?, ?, ?)'
).run(nombre, username, email, telefono, rut, passwordEncriptada);

    res.status(201).json({ mensaje: '¡Usuario registrado con éxito!', id: resultado.lastInsertRowid });
});

// Ruta de LOGIN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario) {
        return res.status(400).json({ error: 'Email o contraseña incorrectos' });
    }

    const passwordCorrecta = await bcrypt.compare(password, usuario.password);
    if (!passwordCorrecta) {
        return res.status(400).json({ error: 'Email o contraseña incorrectos' });
    }

    const token = jwt.sign(
        { id: usuario.id, email: usuario.email, username: usuario.username },
        'clave-secreta-Shopseguro',
        { expiresIn: '7d' }
    );

    res.json({ mensaje: '¡Login exitoso!', token, username: usuario.username });
});

// PUBLICAR PRODUCTO
app.post('/api/productos', upload.array('fotos', 5), async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesión para publicar' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const { titulo, descripcion, precio, region, estado, categoria, motivo_venta } = req.body;

        if (!titulo || !descripcion || !precio || !region || !estado)
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });

        let urlsFotos = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    const url = await subirFotoCloudinary(file.buffer, file.mimetype);
                    urlsFotos.push(url);
                } catch(e) { console.log('Error foto:', e.message); }
            }
        }

        const resultado = db.prepare(`
            INSERT INTO productos (titulo, descripcion, precio, region, estado, categoria, motivo_venta, fotos, vendedor_id, vendedor_nombre)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(titulo, descripcion, precio, region, estado, categoria || 'Otros', motivo_venta || '', JSON.stringify(urlsFotos), datos.id, datos.username);

        res.status(201).json({ mensaje: '¡Producto publicado con éxito!', id: resultado.lastInsertRowid });
    } catch(e) {
        console.log('Error publicar:', e);
        return res.status(401).json({ error: 'Sesión inválida' });
    }
});

// --- Rutas de PRODUCTOS ---
app.get('/api/productos', (req, res) => {
    try {
        // Cambiamos INNER JOIN por LEFT JOIN
        // Esto muestra el producto aunque el usuario tenga problemas
        const query = `
            SELECT 
                p.*, 
                u.nombre AS vendedor_nombre 
            FROM productos p
            LEFT JOIN usuarios u ON p.usuario_id = u.id
            ORDER BY p.id DESC
        `;
        const productos = db.prepare(query).all();
        res.json(productos);
    } catch (error) {
        console.error("Error al obtener productos:", error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});
// VER DETALLE DE UN PRODUCTO
app.get('/api/productos/:id', (req, res) => {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const vendedor = db.prepare('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE id = ?').get(producto.vendedor_id);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado' });

    const prefs = db.prepare('SELECT * FROM preferencias WHERE usuario_id = ?').get(vendedor.id);
    if (prefs && !prefs.mostrar_telefono) vendedor.telefono = null;

    const amigos = db.prepare('SELECT COUNT(*) as total FROM amigos WHERE (solicitante_id = ? OR receptor_id = ?) AND estado = "aceptado"').get(vendedor.id, vendedor.id);
    const totalProductos = db.prepare('SELECT COUNT(*) as total FROM productos WHERE vendedor_id = ?').get(vendedor.id);

    let fotos = [];
    try { fotos = JSON.parse(producto.fotos || '[]'); } catch(e) {}

    res.json({
        producto: { ...producto, fotos },
        vendedor: { ...vendedor, total_amigos: amigos.total, total_productos: totalProductos.total }
    });
});

// Ruta para obtener PERFIL del usuario logueado
app.get('/api/perfil', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'Debes iniciar sesión' });
    }

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const usuario = db.prepare('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE id = ?').get(datos.id);
        const productos = db.prepare('SELECT * FROM productos WHERE vendedor_id = ?').all(datos.id);
        res.json({ usuario, productos });
    } catch (error) {
        return res.status(401).json({ error: 'Sesión inválida' });
    }
});

// Ruta para ver perfil público de cualquier usuario
app.get('/api/usuario/:username', (req, res) => {
    const usernameClean = req.params.username.replace('@', '');

    const usuario = db.prepare('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE username = ?').get(usernameClean);

    if (!usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const productos = db.prepare('SELECT * FROM productos WHERE vendedor_id = ?').all(usuario.id);
    const prefs = db.prepare('SELECT * FROM preferencias WHERE usuario_id = ?').get(usuario.id);

    if (prefs && !prefs.mostrar_telefono) {
        usuario.telefono = null;
    }

    res.json({ usuario, productos });
});

// Obtener preferencias del usuario
app.get('/api/preferencias', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
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

// Guardar preferencias del usuario
app.post('/api/preferencias', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const { mostrar_telefono, notificaciones_email, perfil_visible } = req.body;

        db.prepare(`
            INSERT INTO preferencias (usuario_id, mostrar_telefono, notificaciones_email, perfil_visible)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(usuario_id) DO UPDATE SET
            mostrar_telefono = ?,
            notificaciones_email = ?,
            perfil_visible = ?
        `).run(datos.id, mostrar_telefono, notificaciones_email, perfil_visible, mostrar_telefono, notificaciones_email, perfil_visible);

        res.json({ mensaje: 'Preferencias guardadas' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// Guardar mensaje privado
app.post('/api/mensajes', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const { destinatario, texto } = req.body;

        const destinatarioClean = destinatario.replace('@', '');
        const dest = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(destinatarioClean);

        if (!dest) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.prepare(`
            INSERT INTO mensajes (remitente_id, destinatario_id, texto)
            VALUES (?, ?, ?)
        `).run(datos.id, dest.id, texto);

        db.prepare(`
    INSERT INTO notificaciones (usuario_id, tipo, mensaje)
    VALUES (?, 'mensaje', ?)
    `).run(dest.id, `Nuevo mensaje de @${datos.username}`);

    res.json({ mensaje: 'Mensaje enviado' });   
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// Obtener conversación entre dos usuarios
app.get('/api/mensajes/:username', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const usernameClean = req.params.username.replace('@', '');

        const otroUsuario = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(usernameClean);
        if (!otroUsuario) return res.status(404).json({ error: 'Usuario no encontrado' });

        const mensajes = db.prepare(`
            SELECT m.*, u.username as remitente_username
            FROM mensajes m
            JOIN usuarios u ON m.remitente_id = u.id
            WHERE (m.remitente_id = ? AND m.destinatario_id = ?)
            OR (m.remitente_id = ? AND m.destinatario_id = ?)
            ORDER BY m.fecha ASC
        `).all(datos.id, otroUsuario.id, otroUsuario.id, datos.id);

        res.json(mensajes);
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// Obtener lista de conversaciones
app.get('/api/conversaciones', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');

        const conversaciones = db.prepare(`
            SELECT DISTINCT u.username, u.nombre,
            (SELECT texto FROM mensajes 
             WHERE (remitente_id = ? AND destinatario_id = u.id)
             OR (remitente_id = u.id AND destinatario_id = ?)
             ORDER BY fecha DESC LIMIT 1) as ultimo_mensaje
            FROM usuarios u
            WHERE u.id IN (
                SELECT CASE WHEN remitente_id = ? THEN destinatario_id ELSE remitente_id END
                FROM mensajes
                WHERE remitente_id = ? OR destinatario_id = ?
            )
        `).all(datos.id, datos.id, datos.id, datos.id, datos.id);

        res.json(conversaciones);
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// Chat en tiempo real
const mensajesChat = [];

io.on('connection', (socket) => {
    socket.emit('historial', mensajesChat);

    socket.on('mensaje', (datos) => {
        const mensaje = {
            usuario: datos.usuario,
            texto: datos.texto,
            hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        };
        mensajesChat.push(mensaje);
        io.emit('mensaje', mensaje);
    });

    socket.on('mensaje-privado', (datos) => {
    io.emit('mensaje-privado', datos);
    
    try {
        // Buscar IDs de los usuarios
        const remitente = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(datos.de);
        const destinatario = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(datos.para);
        
        if (remitente && destinatario) {
            // Crear notificación
            db.prepare(`
                INSERT INTO notificaciones (usuario_id, tipo, mensaje)
                VALUES (?, 'mensaje', ?)
            `).run(destinatario.id, `Nuevo mensaje de @${datos.de}`);
        }
    } catch (error) {
        console.log('Error guardando notificación:', error);
    }
});
});
// Obtener notificaciones del usuario
app.get('/api/notificaciones', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const notificaciones = db.prepare(`
            SELECT * FROM notificaciones 
            WHERE usuario_id = ? 
            ORDER BY fecha DESC 
            LIMIT 10
        `).all(datos.id);

        const noLeidas = db.prepare(`
            SELECT COUNT(*) as count FROM notificaciones 
            WHERE usuario_id = ? AND leida = 0
        `).get(datos.id);

        res.json({ notificaciones, noLeidas: noLeidas.count });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// Marcar notificaciones como leídas
app.post('/api/notificaciones/leer', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        db.prepare('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ?').run(datos.id);
        res.json({ mensaje: 'Notificaciones marcadas como leídas' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});
// Enviar solicitud de amistad
app.post('/api/amigos/solicitud', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-shopseguro');
        const { username } = req.body;

        const receptor = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
        if (!receptor) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Verificar si ya existe solicitud
        const existe = db.prepare(`
            SELECT id FROM amigos 
            WHERE (solicitante_id = ? AND receptor_id = ?) 
            OR (solicitante_id = ? AND receptor_id = ?)
        `).get(datos.id, receptor.id, receptor.id, datos.id);

        if (existe) return res.status(400).json({ error: 'Ya existe una solicitud o ya son amigos' });

        db.prepare('INSERT INTO amigos (solicitante_id, receptor_id) VALUES (?, ?)').run(datos.id, receptor.id);

        // Crear notificación
        const solicitante = db.prepare('SELECT username FROM usuarios WHERE id = ?').get(datos.id);
        db.prepare(`INSERT INTO notificaciones (usuario_id, tipo, mensaje) VALUES (?, 'amistad', ?)`).run(receptor.id, `@${solicitante.username} te envió una solicitud de amistad`);

        res.json({ mensaje: 'Solicitud enviada' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// Aceptar o rechazar solicitud
app.post('/api/amigos/responder', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-shopseguro');
        const { solicitudId, accion } = req.body;

        if (accion === 'aceptar') {
            db.prepare('UPDATE amigos SET estado = ? WHERE id = ? AND receptor_id = ?').run('aceptado', solicitudId, datos.id);

            // Notificar al solicitante
            const solicitud = db.prepare('SELECT * FROM amigos WHERE id = ?').get(solicitudId);
            const receptor = db.prepare('SELECT username FROM usuarios WHERE id = ?').get(datos.id);
            db.prepare(`INSERT INTO notificaciones (usuario_id, tipo, mensaje) VALUES (?, 'amistad', ?)`).run(solicitud.solicitante_id, `@${receptor.username} aceptó tu solicitud de amistad`);
        } else {
            db.prepare('DELETE FROM amigos WHERE id = ? AND receptor_id = ?').run(solicitudId, datos.id);
        }

        res.json({ mensaje: accion === 'aceptar' ? 'Solicitud aceptada' : 'Solicitud rechazada' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

// Ver amigos y solicitudes pendientes
app.get('/api/amigos', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const datos = jwt.verify(token, 'clave-secreta-shopseguro');

        const amigos = db.prepare(`
            SELECT u.username, u.nombre, a.id, a.estado, a.solicitante_id
            FROM amigos a
            JOIN usuarios u ON (
                CASE WHEN a.solicitante_id = ? THEN a.receptor_id ELSE a.solicitante_id END = u.id
            )
            WHERE (a.solicitante_id = ? OR a.receptor_id = ?)
            AND a.estado = 'aceptado'
        `).all(datos.id, datos.id, datos.id);

        const pendientes = db.prepare(`
            SELECT u.username, u.nombre, a.id
            FROM amigos a
            JOIN usuarios u ON a.solicitante_id = u.id
            WHERE a.receptor_id = ? AND a.estado = 'pendiente'
        `).all(datos.id);

        res.json({ amigos, pendientes });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});


// EDITAR PRODUCTO
app.put('/api/productos/:id', upload.array('fotos_nuevas', 5), async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesion' });
    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const productoId = req.params.id;
        const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
        if (producto.vendedor_id !== datos.id) return res.status(403).json({ error: 'Sin permiso' });
        const { titulo, descripcion, precio, region, estado, categoria, motivo_venta, fotos_existentes } = req.body;
        if (!titulo || !descripcion || !precio || !estado || !categoria)
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        let fotosFinales = [];
        try { fotosFinales = JSON.parse(fotos_existentes || '[]'); } catch(e) {}
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    const url = await subirFotoCloudinary(file.buffer, file.mimetype);
                    fotosFinales.push(url);
                } catch(e) { console.log('Error foto:', e.message); }
            }
        }
        fotosFinales = fotosFinales.slice(0, 5);
        db.prepare('UPDATE productos SET titulo=?, descripcion=?, precio=?, region=?, estado=?, categoria=?, motivo_venta=?, fotos=? WHERE id=?').run(titulo, descripcion, precio, region||'Region Metropolitana', estado, categoria, motivo_venta||'', JSON.stringify(fotosFinales), productoId);
        res.json({ mensaje: 'Producto actualizado con exito' });
    } catch(e) {
        console.log('Error PUT producto:', e);
        res.status(401).json({ error: 'Sesion invalida' });
    }
});

// ELIMINAR PRODUCTO
app.delete('/api/productos/:id', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const datos = jwt.verify(token, 'clave-secreta-Shopseguro');
        const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
        if (!producto) return res.status(404).json({ error: 'No encontrado' });
        if (producto.vendedor_id !== datos.id) return res.status(403).json({ error: 'Sin permiso' });
        db.prepare('DELETE FROM productos WHERE id = ?').run(req.params.id);
        res.json({ mensaje: 'Producto eliminado' });
    } catch(e) {
        res.status(401).json({ error: 'Sesion invalida' });
    }
});

servidor.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});
