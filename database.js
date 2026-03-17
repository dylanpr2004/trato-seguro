const Database = require('better-sqlite3');

const db = new Database('trato-seguro.db');

// Tabla de usuarios
db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        telefono TEXT NOT NULL,
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

console.log('Base de datos lista');
module.exports = db;