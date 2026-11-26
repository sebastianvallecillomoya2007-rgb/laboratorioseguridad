const express = require("express");
const { param, body, validationResult } = require("express-validator");
const { db, registrarEvento } = require("../db");
const verificarToken = require("../middleware/auth");
const exigirRol = require("../middleware/auth").exigirRol;

const router = express.Router();
router.use(verificarToken, exigirRol("administrador"));

router.get("/usuarios", async (req, res) => {
    const usuarios = await db.all(
        `SELECT u.id, u.nombre, u.correo, u.creado_en,
                CASE WHEN EXISTS (
                    SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
                    WHERE ur.usuario_id = u.id AND r.nombre = 'admin'
                ) THEN 'administrador' ELSE 'usuario' END AS rol
         FROM usuarios u ORDER BY u.id`
    );
    await registrarEvento("panel_admin_usuarios", req.usuario.id);
    return res.json({ usuarios });
});

router.patch("/usuarios/:id/rol", [
    param("id").isInt({ min: 1 }),
    body("rol").isIn(["usuario", "administrador"])
], async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const objetivo = Number(req.params.id);
    if (objetivo === req.usuario.id && req.body.rol !== "administrador") {
        return res.status(409).json({ error: "No puedes quitarte el rol de administrador" });
    }
    let resultado;
    try {
        resultado = await db.transaction(async tx => {
            const usuario = await tx.get("SELECT id FROM usuarios WHERE id = ? FOR UPDATE", [objetivo]);
            if (!usuario) return false;
            const role = await tx.get("SELECT id FROM roles WHERE nombre = 'admin'");
            if (!role) throw new Error("Falta el rol admin en la base MySQL");
            if (req.body.rol !== "administrador") {
                const administradores = await tx.all(
                    `SELECT ur.usuario_id FROM usuario_roles ur
                     JOIN roles r ON r.id = ur.rol_id
                     WHERE r.nombre = 'admin' FOR UPDATE`
                );
                const esAdmin = administradores.some(row => row.usuario_id === objetivo);
                if (esAdmin && administradores.length <= 1) return "ultimo_admin";
                await tx.run("DELETE FROM usuario_roles WHERE usuario_id = ? AND rol_id = ?", [objetivo, role.id]);
            } else {
                await tx.run("INSERT IGNORE INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)",
                    [objetivo, role.id]);
            }
            await tx.run("INSERT INTO auditoria (usuario_id, evento, detalles) VALUES (?, ?, ?)",
                [req.usuario.id, "rol_actualizado", JSON.stringify({ usuarioId: objetivo, rol: req.body.rol })]);
            return true;
        });
    } catch (error) {
        console.error("Fallo al cambiar rol:", error.message);
        return res.status(500).json({ error: "No se pudo completar la solicitud" });
    }
    if (resultado === false) return res.status(404).json({ error: "Usuario no encontrado" });
    if (resultado === "ultimo_admin") return res.status(409).json({ error: "Debe quedar al menos un administrador" });
    return res.json({ mensaje: "Rol actualizado" });
});

router.get("/auditoria", async (req, res) => {
    const rows = await db.all(
        `SELECT a.id, a.usuario_id, u.correo, a.evento, a.detalles, a.creado_en
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
         ORDER BY a.id DESC LIMIT 200`
    );
    const eventos = rows.map(evento => ({ ...evento, detalles: JSON.parse(evento.detalles) }));
    await registrarEvento("panel_admin_auditoria", req.usuario.id);
    return res.json({ eventos });
});

module.exports = router;
