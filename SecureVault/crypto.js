const { createCipheriv, createDecipheriv, hkdfSync, randomBytes } = require("node:crypto");

function encryptionKey() {
    if (process.env.ENCRYPTION_KEY) {
        const key = Buffer.from(process.env.ENCRYPTION_KEY, "base64");
        if (key.length !== 32) {
            throw new Error("ENCRYPTION_KEY debe ser una clave base64 de 32 bytes");
        }
        return key;
    }

    // Separar criptográficamente la llave local de cifrado de la llave JWT.
    return Buffer.from(hkdfSync(
        "sha256",
        Buffer.from(process.env.JWT_SECRET, "utf8"),
        Buffer.from("securevault", "utf8"),
        Buffer.from("datos-cifrados-v1", "utf8"),
        32
    ));
}

function cifrarPartes(texto) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const datos = Buffer.concat([cipher.update(String(texto), "utf8"), cipher.final()]);
    return { datos, iv, etiqueta: cipher.getAuthTag() };
}

function descifrarPartes(datos, iv, etiqueta) {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv));
    decipher.setAuthTag(Buffer.from(etiqueta));
    return Buffer.concat([
        decipher.update(Buffer.from(datos)),
        decipher.final()
    ]).toString("utf8");
}

function cifrar(texto) {
    const partes = cifrarPartes(texto);
    return JSON.stringify({
        v: 1,
        iv: partes.iv.toString("base64"),
        tag: partes.etiqueta.toString("base64"),
        datos: partes.datos.toString("base64")
    });
}

function descifrar(valor) {
    const registro = JSON.parse(valor);
    if (registro.v !== 1) throw new Error("Version de cifrado no soportada");
    return descifrarPartes(
        Buffer.from(registro.datos, "base64"),
        Buffer.from(registro.iv, "base64"),
        Buffer.from(registro.tag, "base64")
    );
}

module.exports = { cifrar, descifrar, cifrarPartes, descifrarPartes };
