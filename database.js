const Database = require('better-sqlite3');

const db = new Database('Shopseguro.db');

// Tabla de usuarios
db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        telefono TEXT NOT NULL,
        rut TEXT NOT NULL,
        password TEXT NOT NULL,
        fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

// Tabla de productos
db.exec(`
    CREATE TABLE IF NOT EXISTS productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        descripcion TEXT NOT NULL,
        precio INTEGER NOT NULL,
        region TEXT NOT NULL,
        estado TEXT NOT NULL,
        vendedor_id INTEGER NOT NULL,
        vendedor_nombre TEXT NOT NULL,
        fecha TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendedor_id) REFERENCES usuarios(id)
    )
`);

// Tabla de preferencias de usuario
db.exec(`
    CREATE TABLE IF NOT EXISTS preferencias (
        usuario_id INTEGER PRIMARY KEY,
        mostrar_telefono INTEGER DEFAULT 1,
        notificaciones_email INTEGER DEFAULT 1,
        perfil_visible INTEGER DEFAULT 1,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
`);

// Tabla de mensajes privados
db.exec(`
    CREATE TABLE IF NOT EXISTS mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        remitente_id INTEGER NOT NULL,
        destinatario_id INTEGER NOT NULL,
        texto TEXT NOT NULL,
        fecha TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (remitente_id) REFERENCES usuarios(id),
        FOREIGN KEY (destinatario_id) REFERENCES usuarios(id)
    )
`);

// Tabla de notificaciones
db.exec(`
    CREATE TABLE IF NOT EXISTS notificaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        leida INTEGER DEFAULT 0,
        fecha TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
`);

// Tabla de amigos
db.exec(`
    CREATE TABLE IF NOT EXISTS amigos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        solicitante_id INTEGER NOT NULL,
        receptor_id INTEGER NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        fecha TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (solicitante_id) REFERENCES usuarios(id),
        FOREIGN KEY (receptor_id) REFERENCES usuarios(id)
    )
`);

console.log('Base de datos lista');
module.exports = db;
