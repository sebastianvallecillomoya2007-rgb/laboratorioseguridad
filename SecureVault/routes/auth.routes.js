const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { body, validationResult } = require("express-validator");
const { db, registrarEvento } = require("../db");
const verificarToken = require("../middleware/auth");

const router = express.Router();
const validarErrores = (req, res, next) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    next();
};
const reglasPassword = body("password")
    .isString().bail()
    .isLength({ min: 12, max: 72 })
    .custom(value => Buffer.byteLength(value, "utf8") <= 72)
    .withMessage("La contraseña debe tener entre 12 y 72 bytes")
    .matches(/[a-z]/).withMessage("Incluye al menos una letra minuscula")
    .matches(/[A-Z]/).withMessage("Incluye al menos una letra mayuscula")
    .matches(/[0-9]/).withMessage("Incluye al menos un numero")
    .matches(/[^A-Za-z0-9]/).withMessage("Incluye al menos un simbolo");

router.post("/registro", [
    body("nombre").isString().bail().trim().isLength({ min: 1, max: 80 }),
    body("correo").isString().bail().trim().isEmail().isLength({ max: 150 }).normalizeEmail(),
    reglasPassword
], validarErrores, async (req, res) => {
    const nombre = req.body.nombre.trim();
    const correo = req.body.correo.toLowerCase();
    try {
        const passwordHash = await bcrypt.hash(req.body.password, 12);
        const usuarioId = await db.transaction(async tx => {
            const role = await tx.get("SELECT id FROM roles WHERE nombre = 'usuario'");
            if (!role) throw new Error("Falta el rol usuario en la base MySQL");
            const result = await tx.run(
                "INSERT INTO usuarios (nombre, correo, password_hash, activo) VALUES (?, ?, ?, 1)",
                [nombre, correo, passwordHash]
            );
            await tx.run("INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)",
                [result.insertId, role.id]);
            await tx.run("INSERT INTO auditoria (usuario_id, evento, detalles) VALUES (?, ?, ?)",
                [result.insertId, "registro_usuario", "{}"]);
            return result.insertId;
        });
        return res.status(201).json({
            mensaje: "Usuario registrado correctamente",
            usuario: { id: Number(usuarioId), nombre, correo, rol: "usuario" }
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ error: "No se pudo registrar con esos datos" });
        }
        console.error("Fallo al registrar usuario:", error.message);
        return res.status(500).json({ error: "No se pudo completar la solicitud" });
    }
});

router.post("/login", [
    body("correo").isString().bail().trim().isEmail().normalizeEmail(),
    body("password").isString().bail().isLength({ min: 1, max: 72 })
        .custom(value => Buffer.byteLength(value, "utf8") <= 72)
], validarErrores, async (req, res) => {
    const correo = req.body.correo.toLowerCase();
    const usuario = await db.get(
        `SELECT u.id, u.nombre, u.correo, u.password_hash,
                CASE WHEN EXISTS (
                    SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
                    WHERE ur.usuario_id = u.id AND r.nombre = 'admin'
                ) THEN 'administrador' ELSE 'usuario' END AS rol
         FROM usuarios u WHERE u.correo = ? AND u.activo = 1`,
        [correo]
    );
    const passwordValida = await bcrypt.compare(
        req.body.password,
        usuario?.password_hash || "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
    );

    if (!usuario || !passwordValida) {
        await registrarEvento("login_fallido", usuario?.id ?? null);
        return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    const jti = randomUUID();
    const expira = Date.now() + 15 * 60 * 1000;
    await db.run("DELETE FROM sv_sesiones WHERE expires_at <= ?", [Date.now()]);
    const token = jwt.sign(
        { id: usuario.id, jti },
        process.env.JWT_SECRET,
        { algorithm: "HS256", expiresIn: "15m" }
    );
    await db.run("INSERT INTO sv_sesiones (jti, usuario_id, expires_at) VALUES (?, ?, ?)",
        [jti, usuario.id, expira]);
    await registrarEvento("login_exitoso", usuario.id);
    return res.json({
        mensaje: "Inicio de sesion exitoso",
        token,
        usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo, rol: usuario.rol }
    });
});

router.post("/logout", verificarToken, async (req, res) => {
    await db.run("DELETE FROM sv_sesiones WHERE jti = ?", [req.usuario.jti]);
    await registrarEvento("cierre_sesion", req.usuario.id);
    return res.status(204).end();
});

router.post("/recuperar", [
    body("correo").isString().bail().trim().isEmail().isLength({ max: 150 }).normalizeEmail()
], validarErrores, async (req, res) => {
    const usuario = await db.get("SELECT id, correo FROM usuarios WHERE correo = ? AND activo = 1",
        [req.body.correo.toLowerCase()]);
    if (usuario) {
        await db.run("DELETE FROM tokens_recuperacion WHERE usuario_id = ? AND utilizado_en IS NULL", [usuario.id]);
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expira = new Date(Date.now() + 15 * 60 * 1000);
        await db.run("INSERT INTO tokens_recuperacion (token_hash, usuario_id, expira_en) VALUES (?, ?, ?)",
            [tokenHash, usuario.id, expira]);
        await registrarEvento("solicitud_recuperacion", usuario.id);

        if (process.env.RESET_WEBHOOK_URL && process.env.RESET_WEBHOOK_TOKEN) {
            fetch(process.env.RESET_WEBHOOK_URL, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${process.env.RESET_WEBHOOK_TOKEN}`
                },
                body: JSON.stringify({ correo: usuario.correo, token, expiraEnMinutos: 15 })
            }).catch(error => console.error("No se pudo entregar la recuperacion:", error.message));
        } else if (process.env.NODE_ENV !== "production") {
            console.info("Token de recuperacion (solo desarrollo):", token);
        }
    }
    return res.status(202).json({
        mensaje: "Si el correo esta registrado, recibira instrucciones de recuperacion"
    });
});

router.post("/restablecer", [
    body("token").isLength({ min: 64, max: 64 }).isHexadecimal(),
    reglasPassword
], validarErrores, async (req, res) => {
    const tokenHash = createHash("sha256").update(req.body.token).digest("hex");
    const recuperacion = await db.get(
        "SELECT usuario_id FROM tokens_recuperacion WHERE token_hash = ? AND utilizado_en IS NULL AND expira_en > NOW()",
        [tokenHash]
    );
    if (!recuperacion) return res.status(400).json({ error: "Token invalido o vencido" });

    const passwordHash = await bcrypt.hash(req.body.password, 12);
    try {
        await db.transaction(async tx => {
            await tx.run("UPDATE usuarios SET password_hash = ? WHERE id = ?",
                [passwordHash, recuperacion.usuario_id]);
            await tx.run("UPDATE tokens_recuperacion SET utilizado_en = NOW() WHERE token_hash = ?", [tokenHash]);
            await tx.run("DELETE FROM sv_sesiones WHERE usuario_id = ?", [recuperacion.usuario_id]);
            await tx.run("INSERT INTO auditoria (usuario_id, evento, detalles) VALUES (?, ?, ?)",
                [recuperacion.usuario_id, "password_restablecida", "{}"]);
        });
    } catch (error) {
        console.error("Fallo al restablecer contraseña:", error.message);
        return res.status(500).json({ error: "No se pudo completar la solicitud" });
    }
    return res.json({ mensaje: "Contraseña actualizada. Inicia sesion nuevamente" });
});

module.exports = router;
