const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database');
const cors = require('cors');

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor, {
    cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// Ruta de prueba
app.get('/', (req, res) => {
    res.send('¡Servidor de Trato Seguro CL funcionando!');
});

// Ruta de REGISTRO
app.post('/api/registro', async (req, res) => {
    const { nombre, username, email, telefono, password } = req.body;

    if (!nombre || !username || !email || !telefono || !password) {
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
        'INSERT INTO usuarios (nombre, username, email, telefono, password) VALUES (?, ?, ?, ?, ?)'
    ).run(nombre, username, email, telefono, passwordEncriptada);

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
        'clave-secreta-trato-seguro',
        { expiresIn: '24h' }
    );

    res.json({ mensaje: '¡Login exitoso!', token, username: usuario.username });
});

// Ruta para PUBLICAR PRODUCTO
app.post('/api/productos', async (req, res) => {
    const { titulo, descripcion, precio, region, estado } = req.body;

    if (!titulo || !descripcion || !precio || !region || !estado) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'Debes iniciar sesión para publicar' });
    }

    try {
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');
        const resultado = db.prepare(`
            INSERT INTO productos (titulo, descripcion, precio, region, estado, vendedor_id, vendedor_nombre)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(titulo, descripcion, precio, region, estado, datos.id, datos.username);

        res.status(201).json({ mensaje: '¡Producto publicado con éxito!', id: resultado.lastInsertRowid });
    } catch (error) {
        return res.status(401).json({ error: 'Sesión inválida, inicia sesión nuevamente' });
    }
});

// Ruta para VER TODOS LOS PRODUCTOS
app.get('/api/productos', (req, res) => {
    const productos = db.prepare('SELECT * FROM productos ORDER BY fecha DESC').all();
    res.json(productos);
});

// Ruta para obtener PERFIL del usuario logueado
app.get('/api/perfil', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'Debes iniciar sesión' });
    }

    try {
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');
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
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');
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
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');
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
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');
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
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');
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
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');

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
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');
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
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');
        db.prepare('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ?').run(datos.id);
        res.json({ mensaje: 'Notificaciones marcadas como leídas' });
    } catch (error) {
        res.status(401).json({ error: 'Sesión inválida' });
    }
});

servidor.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});
