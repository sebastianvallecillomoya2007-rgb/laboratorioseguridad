const express = require("express");
const { body, param, validationResult } = require("express-validator");
const { db, registrarEvento } = require("../db");
const { cifrarPartes, descifrarPartes } = require("../crypto");
const verificarToken = require("../middleware/auth");

const router = express.Router();
router.use(verificarToken);

function validar(req, res, next) {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    next();
}

router.get("/", async (req, res) => {
    const filas = await db.all(
        `SELECT id, titulo, contenido_cifrado, iv, etiqueta_autenticacion, creado_en, actualizado_en
         FROM notas WHERE usuario_id = ? AND archivada = 0 ORDER BY actualizado_en DESC`,
        [req.usuario.id]
    );
    const notas = filas.map(nota => ({
        id: nota.id,
        titulo: nota.titulo,
        contenido: descifrarPartes(nota.contenido_cifrado, nota.iv, nota.etiqueta_autenticacion),
        creadoEn: nota.creado_en,
        actualizadoEn: nota.actualizado_en
    }));
    return res.json({ notas });
});

router.post("/", [
    body("titulo").isString().trim().isLength({ min: 1, max: 120 }),
    body("contenido").isString().isLength({ min: 1, max: 5000 })
], validar, async (req, res) => {
    const cantidad = (await db.get("SELECT COUNT(*) AS total FROM notas WHERE usuario_id = ? AND archivada = 0",
        [req.usuario.id])).total;
    if (cantidad >= 100) return res.status(409).json({ error: "Limite de 100 notas alcanzado" });
    const encrypted = cifrarPartes(req.body.contenido);
    const result = await db.run(
        `INSERT INTO notas
         (usuario_id, titulo, contenido_cifrado, iv, etiqueta_autenticacion, version_clave, archivada)
         VALUES (?, ?, ?, ?, ?, 1, 0)`,
        [req.usuario.id, req.body.titulo.trim(), encrypted.datos, encrypted.iv, encrypted.etiqueta]
    );
    await registrarEvento("nota_creada", req.usuario.id);
    return res.status(201).json({
        nota: { id: Number(result.insertId), titulo: req.body.titulo.trim(), contenido: req.body.contenido }
    });
});

router.put("/:id", [
    param("id").isInt({ min: 1 }),
    body("titulo").isString().trim().isLength({ min: 1, max: 120 }),
    body("contenido").isString().isLength({ min: 1, max: 5000 })
], validar, async (req, res) => {
    const encrypted = cifrarPartes(req.body.contenido);
    const updated = await db.transaction(async tx => {
        const previous = await tx.get(
            `SELECT contenido_cifrado, iv, etiqueta_autenticacion, version_clave
             FROM notas WHERE id = ? AND usuario_id = ? AND archivada = 0 FOR UPDATE`,
            [Number(req.params.id), req.usuario.id]
        );
        if (!previous) return false;
        await tx.run(
            `INSERT INTO versiones_notas
             (nota_id, contenido_cifrado, iv, etiqueta_autenticacion, version_clave)
             VALUES (?, ?, ?, ?, ?)`,
            [Number(req.params.id), previous.contenido_cifrado, previous.iv,
                previous.etiqueta_autenticacion, previous.version_clave]
        );
        await tx.run(
            `UPDATE notas SET titulo = ?, contenido_cifrado = ?, iv = ?, etiqueta_autenticacion = ?,
             actualizado_en = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ? AND archivada = 0`,
            [req.body.titulo.trim(), encrypted.datos, encrypted.iv, encrypted.etiqueta,
                Number(req.params.id), req.usuario.id]
        );
        await tx.run("INSERT INTO auditoria (usuario_id, evento, detalles) VALUES (?, ?, ?)",
            [req.usuario.id, "nota_actualizada", "{}"]);
        return true;
    });
    if (!updated) return res.status(404).json({ error: "Nota no encontrada" });
    return res.json({ mensaje: "Nota actualizada" });
});

router.delete("/:id", [param("id").isInt({ min: 1 })], validar, async (req, res) => {
    const result = await db.run(
        "UPDATE notas SET archivada = 1, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ? AND archivada = 0",
        [Number(req.params.id), req.usuario.id]);
    if (!result.changes) return res.status(404).json({ error: "Nota no encontrada" });
    await registrarEvento("nota_eliminada", req.usuario.id);
    return res.status(204).end();
});

module.exports = router;
