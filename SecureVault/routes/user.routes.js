const express = require("express");
const { body, validationResult } = require("express-validator");
const { db, registrarEvento } = require("../db");
const { cifrar, descifrar } = require("../crypto");
const verificarToken = require("../middleware/auth");

const router = express.Router();
router.use(verificarToken);

router.get("/me", async (req, res) => {
    const usuario = await db.get(
        `SELECT u.id, u.nombre, u.correo, p.telefono_cifrado,
                CASE WHEN EXISTS (
                    SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
                    WHERE ur.usuario_id = u.id AND r.nombre = 'admin'
                ) THEN 'administrador' ELSE 'usuario' END AS rol
         FROM usuarios u LEFT JOIN sv_perfil p ON p.usuario_id = u.id
         WHERE u.id = ? AND u.activo = 1`,
        [req.usuario.id]
    );
    let telefono = null;
    if (usuario.telefono_cifrado) {
        const completo = descifrar(usuario.telefono_cifrado);
        telefono = `***-***-${completo.slice(-4)}`;
    }
    return res.json({
        usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo, rol: usuario.rol, telefono }
    });
});

router.patch("/me", [
    body("nombre").optional().isString().trim().isLength({ min: 1, max: 80 }),
    body("telefono").optional({ values: "null" }).isString().matches(/^\+?[0-9 ()-]{7,24}$/)
], async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    if (!Object.hasOwn(req.body, "nombre") && !Object.hasOwn(req.body, "telefono")) {
        return res.status(400).json({ error: "Indica nombre o telefono para actualizar" });
    }
    const usuario = await db.get("SELECT nombre FROM usuarios WHERE id = ? AND activo = 1", [req.usuario.id]);
    const nombre = Object.hasOwn(req.body, "nombre") ? req.body.nombre.trim() : usuario.nombre;
    const telefono = Object.hasOwn(req.body, "telefono") ? req.body.telefono : undefined;
    await db.transaction(async tx => {
        await tx.run("UPDATE usuarios SET nombre = ? WHERE id = ?", [nombre, req.usuario.id]);
        if (telefono !== undefined) {
            const telefonoCifrado = telefono === null || telefono === "" ? null : cifrar(telefono);
            await tx.run(
                `INSERT INTO sv_perfil (usuario_id, telefono_cifrado) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE telefono_cifrado = VALUES(telefono_cifrado)`,
                [req.usuario.id, telefonoCifrado]
            );
        }
        await tx.run("INSERT INTO auditoria (usuario_id, evento, detalles) VALUES (?, ?, ?)",
            [req.usuario.id, "perfil_actualizado", "{}"]);
    });
    return res.json({ mensaje: "Perfil actualizado" });
});

module.exports = router;
