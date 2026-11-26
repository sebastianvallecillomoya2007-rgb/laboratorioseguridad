# SecureVault

API y página web para practicar controles de seguridad OWASP. Usa Express 5, MySQL con el conector `mysql2` y JSON Web Tokens. Requiere Node.js 24.2 o superior.

## Ejecutar localmente

1. Instala Node.js 24 LTS o posterior.
2. En esta carpeta, instala dependencias con `npm ci`.
3. Si no tienes `.env`, copia `.env.example` y cambia `JWT_SECRET` por una cadena aleatoria larga. En esta carpeta ya existe `.env`; consérvalo y no lo sobrescribas. No publiques ese archivo ni compartas sus valores.
4. Ejecuta `npm run dev`. El servidor informa que está escuchando en el puerto configurado, normalmente `3000`.
5. Abre `http://localhost:3000/` para usar la página o `http://localhost:3000/health` para revisar el estado. Si no responde, confirma primero que el servidor sigue ejecutándose y revisa el puerto que anuncia la terminal.

En desarrollo, si no se configura `ENCRYPTION_KEY`, la llave de datos se deriva de `JWT_SECRET` mediante HKDF para facilitar la práctica. Al cambiar `JWT_SECRET`, los tokens activos dejan de servir y las notas cifradas existentes ya no podrán descifrarse. Haz una copia de seguridad antes de cambiar secretos.

Para crear el primer administrador, configura `ADMIN_EMAIL` y `ADMIN_PASSWORD` en el archivo local `.env` antes de arrancar. Usa una cuenta nueva y una contraseña de 12 a 72 bytes. El servidor solo crea esa cuenta si el correo aún no existe; nunca promueve automáticamente a administrador a una cuenta existente.

## API

La página de acceso, notas, perfil y administración está en `public/` y se sirve desde el mismo origen que la API. Todas las rutas de API reciben y devuelven JSON. Las rutas protegidas usan `Authorization: Bearer <token>`. El token se mantiene solo en memoria mientras la página está abierta; al recargar, inicia sesión de nuevo. Los tokens duran 15 minutos y `/api/auth/logout` revoca la sesión en la base de datos.

| Método y ruta | Uso |
| --- | --- |
| `GET /health` | Salud del servicio, sin datos internos |
| `POST /api/auth/registro` | Registro con nombre, correo y contraseña fuerte |
| `POST /api/auth/login` | Inicio de sesión; máximo cinco intentos fallidos por ventana de 15 minutos e IP |
| `POST /api/auth/logout` | Cierre y revocación del token actual |
| `POST /api/auth/recuperar` | Solicita restablecimiento; respuesta genérica para evitar enumerar correos |
| `POST /api/auth/restablecer` | Cambia contraseña con token aleatorio de un solo uso, guardado como hash |
| `GET /api/usuario/me`, `PATCH /api/usuario/me` | Consulta perfil y actualiza nombre/teléfono; el teléfono se cifra y se devuelve enmascarado |
| `GET /api/notas` | Lista las notas propias, descifradas solo al responder |
| `POST /api/notas` | Crea una nota; título y contenido se guardan cifrados |
| `PUT /api/notas/:id`, `DELETE /api/notas/:id` | Edita o elimina una nota propia; otra persona recibe 404 |
| `/api/admin/usuarios`, `/api/admin/auditoria` | Panel de usuarios y eventos, solo rol administrador; disponible en la pestaña Administración |
| `PATCH /api/admin/usuarios/:id/rol` | Cambia roles; no permite eliminar al último administrador |

Registro de ejemplo:

```json
{
  "nombre": "Ana",
  "correo": "ana@example.com",
  "password": "Una-clave-larga-2026!"
}
```

Las contraseñas se guardan con bcrypt y sal por usuario. Las notas y teléfonos usan AES-256-GCM con IV aleatorio y etiqueta de autenticación. Las consultas de MySQL usan parámetros preparados y cada operación de nota filtra por `owner_id` en el servidor. La interfaz muestra los datos de las notas con `textContent` y no acepta URLs salientes del usuario.

## Variables de entorno

`PORT`, `NODE_ENV`, `JWT_SECRET`, `ENCRYPTION_KEY`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RESET_WEBHOOK_URL`, `RESET_WEBHOOK_TOKEN` y `TRUST_PROXY`. `.env.example` documenta cuáles son opcionales. En producción `ENCRYPTION_KEY` es obligatoria e independiente de `JWT_SECRET`: genera 32 bytes aleatorios, codifícalos en Base64 y guárdalos como secreto de la plataforma. No guardes secretos en GitHub ni en el repositorio.

La recuperación local imprime el token de 15 minutos en la terminal de desarrollo. En producción, define un webhook HTTPS protegido para entregar el token por un canal privado; la integración de correo debe añadirse/configurarse antes de ofrecer recuperación real a usuarios.

## Despliegue

La aplicación escucha en `0.0.0.0` y respeta `PORT`. `GET /health` sirve como health check. Configura `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` con los datos de conexión del servicio MySQL; guarda la contraseña como secreto. La base de datos debe aceptar conexiones desde el servidor de la app y conservar su almacenamiento. Configura también `NODE_ENV=production`, `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y, si está detrás de un proxy, el número correcto de saltos `TRUST_PROXY`.

El proxy de la plataforma debe terminar HTTPS y redirigir HTTP a HTTPS. MySQL ya proporciona almacenamiento compartido para el servicio, siempre que la base se configure con persistencia y permisos de red adecuados. Lee [INFORME_DEPLOY.md](INFORME_DEPLOY.md) antes de elegir plataforma y verifica las cuotas vigentes.

## Controles demostrables y riesgos pendientes

- Cabeceras seguras con Helmet, CSP, `X-Powered-By` desactivado, límite de cuerpo JSON y respuestas de error genéricas.
- Rate limit global, límite más bajo para login y límite de solicitudes de recuperación.
- Acceso por rol y propiedad validada en cada consulta de notas; rol cargado desde la base en cada token verificado.
- Hash de contraseña, JWT firmado con algoritmo fijo, sesiones revocables, recuperación con hash del token y expiración.
- Datos sensibles cifrados en reposo; bitácora sin contraseñas, tokens ni contenidos de notas.
- `npm ci`, `npm audit` y Dependabot en CI.

Riesgos residuales para documentar en el informe: MySQL debe configurarse con usuario de privilegios mínimos, TLS y copias de seguridad; la entrega de recuperación depende de configurar un proveedor real; no hay MFA ni bloqueo progresivo por cuenta; los límites de rate limit se guardan en memoria y no se comparten entre instancias; y la bitácora no debe considerarse un registro inmutable frente a una intrusión con acceso a la base.
