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

// Ruta de REGISTRO
app.post('/api/registro', async (req, res) => {

    const { nombre, username, email, telefono, password } = req.body;

    if (!nombre || !username || !email || !telefono || !password) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    // Verificar si el email ya existe
    const emailExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (emailExiste) {
        return res.status(400).json({ error: 'Este email ya está registrado' });
    }

    // Verificar si el username ya existe
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

    // Verificar que llegaron todos los datos
    if (!titulo || !descripcion || !precio || !region || !estado) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    // Verificar que el usuario está logueado
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'Debes iniciar sesión para publicar' });
    }

    try {
        // Verificar el token
        const datos = jwt.verify(token, 'clave-secreta-trato-seguro');

        // Guardar el producto en la base de datos
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
        
        // Obtener datos del usuario
        const usuario = db.prepare('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE id = ?').get(datos.id);
        
        // Obtener productos del usuario
        const productos = db.prepare('SELECT * FROM productos WHERE vendedor_id = ?').all(datos.id);

        res.json({ usuario, productos });

    } catch (error) {
        return res.status(401).json({ error: 'Sesión inválida' });
    }
});
// Chat Público en tiempo real
const mensajesChat = [];

io.on('connection', (socket) => {
    // Enviar historial al nuevo usuario
    socket.emit('historial', mensajesChat);

    // Recibir mensaje nuevo
    socket.on('mensaje', (datos) => {
        const mensaje = {
            usuario: datos.usuario,
            texto: datos.texto,
            hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        };
        mensajesChat.push(mensaje);
        // Enviar a todos
        io.emit('mensaje', mensaje);
    });
});
// Ruta para ver perfil público de cualquier usuario
app.get('/api/usuario/:username', (req, res) => {
    const { username } = req.params;

    const usuario = db.prepare('SELECT id, nombre, username, email, telefono, fecha_registro FROM usuarios WHERE username = ?').get(username);
    
    if (!usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const productos = db.prepare('SELECT * FROM productos WHERE vendedor_id = ?').all(usuario.id);

    res.json({ usuario, productos });
});

servidor.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});
