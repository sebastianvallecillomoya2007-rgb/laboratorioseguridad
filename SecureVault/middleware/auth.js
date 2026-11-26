
const jwt = require("jsonwebtoken");
const { db } = require("../db");

async function verificarToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Token de autenticacion requerido"
        });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"]
        });
    } catch (error) {
        return res.status(401).json({
            error: "Token invalido o expirado"
        });
    }

    try {
        const sesionActiva = await db.get(
            `SELECT u.id, u.correo,
                    CASE WHEN EXISTS (
                        SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
                        WHERE ur.usuario_id = u.id AND r.nombre = 'admin'
                    ) THEN 'administrador' ELSE 'usuario' END AS rol
             FROM sv_sesiones s JOIN usuarios u ON u.id = s.usuario_id
             WHERE s.jti = ? AND s.usuario_id = ? AND s.expires_at > ? AND u.activo = 1`,
            [decoded.jti, decoded.id, Date.now()]
        );
        if (!sesionActiva) {
            return res.status(401).json({ error: "Sesion invalida o cerrada" });
        }
        req.usuario = { ...sesionActiva, jti: decoded.jti };
        return next();
    } catch (error) {
        return next(error);
    }
}

function exigirRol(...roles) {
    return (req, res, next) => {
        if (!req.usuario || !roles.includes(req.usuario.rol)) {
            return res.status(403).json({ error: "Acceso denegado" });
        }
        next();
    };
}

module.exports = verificarToken;
module.exports.exigirRol = exigirRol;
