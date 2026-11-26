require("dotenv").config();

const express = require("express");
const path = require("node:path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { db, dbReady, registrarEvento } = require("./db");
const authRoutes = require("./routes/auth.routes");
const notesRoutes = require("./routes/notes.routes");
const userRoutes = require("./routes/user.routes");
const adminRoutes = require("./routes/admin.routes");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("Configura JWT_SECRET con al menos 32 caracteres aleatorios en el entorno");
}
if (process.env.NODE_ENV === "production" && !process.env.ENCRYPTION_KEY) {
    throw new Error("En produccion configura ENCRYPTION_KEY como secreto independiente de JWT_SECRET");
}
if (process.env.ENCRYPTION_KEY && Buffer.from(process.env.ENCRYPTION_KEY, "base64").length !== 32) {
    throw new Error("ENCRYPTION_KEY debe contener una clave base64 de 32 bytes");
}
if ((process.env.RESET_WEBHOOK_URL && !process.env.RESET_WEBHOOK_TOKEN) ||
    (!process.env.RESET_WEBHOOK_URL && process.env.RESET_WEBHOOK_TOKEN) ||
    (process.env.RESET_WEBHOOK_URL && !process.env.RESET_WEBHOOK_URL.startsWith("https://"))) {
    throw new Error("El webhook de recuperacion debe configurarse completo y usar HTTPS");
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT debe ser un numero entre 1 y 65535");
}

if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    if (!Number.isInteger(hops) || hops < 1 || hops > 5) {
        throw new Error("TRUST_PROXY debe ser el numero de proxies confiables, de 1 a 5");
    }
    app.set("trust proxy", hops);
}

app.disable("x-powered-by");
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
            formAction: ["'self'"],
            objectSrc: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Intenta nuevamente mas tarde" }
}));
app.use(express.json({ limit: "10kb", strict: true }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

app.get("/", (_req, res) => res.json({
    mensaje: "SecureVault",
    estado: "Servidor funcionando",
    seguridad: "Protecciones activadas"
}));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Demasiados intentos. Espera 15 minutos" }
});
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/recuperar", rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false
}));
app.use("/api/auth", authRoutes);
app.use("/api/notas", notesRoutes);
app.use("/api/usuario", userRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada" }));
app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({ error: "JSON invalido" });
    }
    if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
        return res.status(error.status).json({ error: "Solicitud no valida o demasiado grande" });
    }
    console.error("Error de solicitud:", error.message);
    return res.status(500).json({ error: "No se pudo completar la solicitud" });
});

async function crearAdministradorInicial() {
    const correo = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!correo && !password) return;
    if (!correo || correo.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || !password ||
        password.length < 12 || Buffer.byteLength(password, "utf8") > 72 ||
        !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)) {
        throw new Error("ADMIN_EMAIL valido y ADMIN_PASSWORD (12-72 bytes) deben configurarse juntos");
    }
    const existente = await db.get(
        `SELECT u.id, EXISTS (
            SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
            WHERE ur.usuario_id = u.id AND r.nombre = 'admin'
        ) AS es_admin FROM usuarios u WHERE u.correo = ?`,
        [correo]
    );
    if (existente) {
        if (!existente.es_admin) {
            console.warn("ADMIN_EMAIL ya esta registrado como usuario. Cambia ADMIN_EMAIL por una cuenta nueva.");
        }
        return;
    }
    const role = await db.get("SELECT id FROM roles WHERE nombre = 'admin'");
    if (!role) throw new Error("Falta el rol admin en la base MySQL");
    const passwordHash = await bcrypt.hash(password, 12);
    await db.transaction(async tx => {
        const result = await tx.run(
            "INSERT INTO usuarios (nombre, correo, password_hash, activo) VALUES (?, ?, ?, 1)",
            ["Administrador", correo, passwordHash]
        );
        await tx.run("INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)", [result.insertId, role.id]);
        await tx.run("INSERT INTO auditoria (usuario_id, evento, detalles) VALUES (?, ?, ?)",
            [result.insertId, "administrador_inicial_creado", "{}"]);
    });
    console.info("Cuenta administradora inicial creada.");
}

dbReady.then(crearAdministradorInicial).then(() => {
    const server = app.listen(PORT, "0.0.0.0", () => {
        console.info(`SecureVault escuchando en el puerto ${PORT}`);
    });
    const cerrar = () => server.close(() => {
        db.close().then(() => process.exit(0));
    });
    process.once("SIGINT", cerrar);
    process.once("SIGTERM", cerrar);
}).catch(error => {
    console.error("No se pudo iniciar SecureVault:", error.message);
    db.close().finally(() => { process.exitCode = 1; });
});
