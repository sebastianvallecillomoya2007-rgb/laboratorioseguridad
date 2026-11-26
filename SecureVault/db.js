const mysql = require("mysql2/promise");

const databaseName = process.env.DB_NAME || "securevault";
const pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD,
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false
});

const schema = [
    `CREATE TABLE IF NOT EXISTS sv_sesiones (
        jti CHAR(36) NOT NULL PRIMARY KEY,
        usuario_id INT UNSIGNED NOT NULL,
        expires_at BIGINT NOT NULL,
        INDEX idx_sesiones_usuario (usuario_id),
        CONSTRAINT fk_sesiones_usuario FOREIGN KEY (usuario_id)
            REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS sv_perfil (
        usuario_id INT UNSIGNED NOT NULL,
        telefono_cifrado TEXT NULL,
        PRIMARY KEY (usuario_id),
        CONSTRAINT fk_perfil_usuario FOREIGN KEY (usuario_id)
            REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

const dbReady = (async () => {
    const connection = await pool.getConnection();
    try {
        await connection.ping();
        for (const statement of schema) await connection.query(statement);
    } finally {
        connection.release();
    }
})();

async function execute(sql, values = [], connection = pool) {
    await dbReady;
    const [result] = await connection.execute(sql, values);
    return result;
}

const db = {
    async get(sql, values = []) {
        const rows = await execute(sql, values);
        return rows[0];
    },
    async all(sql, values = []) {
        return execute(sql, values);
    },
    async run(sql, values = []) {
        const result = await execute(sql, values);
        return { insertId: result.insertId, changes: result.affectedRows };
    },
    async transaction(callback) {
        await dbReady;
        const connection = await pool.getConnection();
        const tx = {
            async get(sql, values = []) {
                const [rows] = await connection.execute(sql, values);
                return rows[0];
            },
            async all(sql, values = []) {
                const [rows] = await connection.execute(sql, values);
                return rows;
            },
            async run(sql, values = []) {
                const [result] = await connection.execute(sql, values);
                return { insertId: result.insertId, changes: result.affectedRows };
            }
        };
        try {
            await connection.beginTransaction();
            const result = await callback(tx);
            await connection.commit();
            return result;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },
    async close() {
        await dbReady.catch(() => {});
        await pool.end();
    }
};

async function registrarEvento(evento, usuarioId = null, detalles = {}) {
    return db.run(
        "INSERT INTO auditoria (usuario_id, evento, detalles) VALUES (?, ?, ?)",
        [usuarioId, evento, JSON.stringify(detalles)]
    );
}

module.exports = { db, dbReady, registrarEvento };
