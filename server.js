const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Ruta de prueba
app.get('/', (req, res) => {
    res.send('¡Servidor de Trato Seguro CL funcionando!');
});

// Ruta de REGISTRO
app.post('/api/registro', async (req, res) => {

    const { nombre, email, password } = req.body;

    if (!nombre || !email || !password) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const usuarioExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (usuarioExiste) {
        return res.status(400).json({ error: 'Este email ya está registrado' });
    }

    const passwordEncriptada = await bcrypt.hash(password, 10);

    const resultado = db.prepare(
        'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)'
    ).run(nombre, email, passwordEncriptada);

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
        { id: usuario.id, email: usuario.email },
        'clave-secreta-trato-seguro',
        { expiresIn: '24h' }
    );

    res.json({ mensaje: '¡Login exitoso!', token });
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
        `).run(titulo, descripcion, precio, region, estado, datos.id, datos.email);

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
app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});
