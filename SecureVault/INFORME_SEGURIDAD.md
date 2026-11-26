# Informe de seguridad: SecureVault

> **Estado:** borrador de entrega. El código incorpora controles descritos abajo, pero las pruebas en ejecución, capturas, escaneos, URL pública y resultados de dependencias deben completarse con el servidor del equipo. No marcar una evidencia como aprobada sin ejecutarla y guardar su resultado.

## Alcance y modelo de amenazas

SecureVault es una API REST de notas privadas con registro, login, perfil, rol administrador y bitácora. Los activos principales son contraseñas, tokens de sesión, notas, teléfono, roles y eventos. Se considera que una persona puede enviar entradas malformadas, probar contraseñas, cambiar IDs de ruta o manipular sus propias solicitudes. La aplicación no acepta una URL remota del usuario ni ejecuta archivos suministrados por el usuario.

```mermaid
flowchart LR
    U[Usuario o administrador] -->|HTTPS + JSON + Bearer JWT| API[Express / SecureVault]
    A[Atacante externo] -->|Entradas y solicitudes no confiables| API
    API -->|consultas preparadas| DB[(SQLite en volumen persistente)]
    API -->|AES-256-GCM| DB
    API -->|secretos del entorno| K[JWT_SECRET y ENCRYPTION_KEY]
    API -->|eventos sin contraseñas ni notas| LOG[Bitácora de auditoría]
```

| Amenaza STRIDE | Ejemplo | Medida en el proyecto | Riesgo restante |
| --- | --- | --- | --- |
| Suplantación | Robo o fuerza bruta de contraseña/JWT | bcrypt cost 12; JWT HS256 de 15 min; revocación por `jti`; límite de login | Sin MFA; usar HTTPS y guardar el token fuera de logs/localStorage público |
| Manipulación | Cambiar el ID de una nota o alterar contenido cifrado | Cada consulta de nota limita por `owner_id`; AES-GCM detecta manipulación | Una llave comprometida permite descifrar datos |
| Repudio | Negar un cambio de rol o login | Eventos de auditoría asociados al ID de usuario | La base local no es bitácora inmutable ni alerta externa |
| Divulgación | Leer notas de otra cuenta o inspeccionar la base | Respuesta requiere token y propietario; notas/teléfono cifrados; perfil enmascara teléfono | La API descifra para el propietario y el proceso necesita la llave |
| Denegación de servicio | Abusar login, cuerpo grande o crear notas sin límite | Rate limit, JSON máximo 10 KB, 100 notas por cuenta, contenido máximo 5000 caracteres | Rate limits están en memoria y no coordinan varias instancias |
| Elevación de privilegios | Cambiar rol desde campos de registro | Registro no acepta rol; rutas admin consultan rol actual en DB; último admin protegido | Acceso de administrador debe protegerse y revisarse periódicamente |

## Mapeo OWASP Top 10:2025

| Categoría | Mitigación implementada | Evidencia que debe guardarse |
| --- | --- | --- |
| A01 Broken Access Control | Middleware de sesión/rol; SQL con `id` y `owner_id`; el rol vive en el servidor. No hay fetch/URL controlada por usuario, reduciendo SSRF. | Con dos usuarios propios, el usuario B intenta leer, editar y borrar una nota de A: respuesta esperada 404. Captura de request/response. |
| A02 Security Misconfiguration | Helmet/CSP/HSTS, oculta `X-Powered-By`, errores JSON genéricos, `NODE_ENV=production`; trust proxy apagado por defecto y configurable. | Encabezados de la URL de producción y reporte Mozilla Observatory o SecurityHeaders. Revisar que no se exponga stack trace. |
| A03 Software Supply Chain Failures | `package-lock.json`, `npm ci`, `npm audit --audit-level=high`, Dependabot semanal y permisos `contents: read` en CI. | Ejecución de Actions verde y salida completa de `npm audit`; si reporta vulnerabilidades, actualizar y volver a revisar. |
| A04 Cryptographic Failures | bcrypt para contraseñas; AES-256-GCM, IV de 12 bytes y tag de autenticación para notas/teléfono; claves no versionadas; HTTPS en producción. | Mostrar hash bcrypt en DB; ciphertext/IV/tag de una nota en DB; captura de certificado TLS. No mostrar valores de claves. |
| A05 Injection (incluye XSS) | Express Validator, JSON limitado, consultas SQLite preparadas; la API devuelve JSON y la interfaz construye contenido del usuario con `textContent`. CSP limita recursos del mismo origen. | Entrada de correo inválida rechazada; cadena tipo SQLi no modifica consultas. Verificar que `<script>` se muestra como texto y no se ejecuta en la página. |
| A06 Insecure Design | Límites de nota, propietario obligatorio, token de recuperación de un solo uso, errores genéricos. El modelo STRIDE está documentado arriba. | Este modelo + diagrama; demostrar límites y que el token usado/expirado no vuelve a funcionar. |
| A07 Authentication Failures | Contraseña de 12–72 bytes con mayúscula, minúscula, número y símbolo; bcrypt; login limitado; token corto y logout revocable; errores de login genéricos. | Registro rechaza contraseña débil; login incorrecto; a partir de intentos fallidos se espera HTTP 429; logout deja inválido el token. |
| A08 Software or Data Integrity Failures | Tokens solo aceptan HS256; dependencias se instalan desde lockfile; CI revisa instalación, auditoría y sintaxis antes de integrar. | Fragmento de `jwt.verify` con lista de algoritmos; workflow de Actions y resultado verde. |
| A09 Security Logging and Alerting Failures | Bitácora para login, registro, logout, cambios de rol, accesos administrativos y notas; no guarda contraseña, JWT ni contenido de nota. | Captura de `/api/admin/auditoria` después de acciones de prueba y revisión de que no aparecen secretos. No hay alertas externas aún. |
| A10 Mishandling of Exceptional Conditions | JSON inválido, datos grandes, ruta inexistente y errores inesperados producen mensajes controlados; el detalle solo va a logs del servidor. | Solicitar JSON inválido y ruta inexistente; guardar respuesta genérica sin stack trace. |

## Pruebas de demostración (ejecutar solo en el servicio propio)

1. Registrar dos cuentas de prueba y crear una nota con la primera.
2. Intentar leer, actualizar y borrar esa nota usando el token de la segunda cuenta. La segunda no debe acceder; guardar el 404 de cada intento.
3. Enviar datos malformados a registro/login (correo inválido, contraseña corta y JSON inválido); deben rechazarse sin stack trace.
4. Intentar iniciar sesión repetidamente con credenciales incorrectas y guardar la respuesta 429 del limitador.
5. Crear una nota de demostración con contenido `<script>alert(1)</script>`. La API no debe ejecutarlo; confirmar que el ciphertext no contiene el texto legible en SQLite. No usar datos reales.
6. Solicitar recuperación en desarrollo, usar el token solo una vez y comprobar rechazo en el segundo uso. En producción, este paso requiere webhook de entrega HTTPS configurado.
7. Revisar encabezados/TLS con SecurityHeaders o Mozilla Observatory, SSL Labs y OWASP ZAP. Apuntar fecha, URL y resultado. No escanear sitios ajenos.

| Evidencia final | Resultado del equipo |
| --- | --- |
| URL HTTPS publicada y fecha de verificación | Pendiente de despliegue |
| `npm audit --audit-level=high` | Pendiente de ejecución |
| CI de GitHub Actions | Pendiente de publicar el repositorio |
| OWASP ZAP | Pendiente de ejecutar en la URL propia |
| SSL Labs / SecurityHeaders | Pendiente de URL pública |
| Capturas de IDOR, 429, cifrado y sesión | Pendiente de ejecutar |

## Decisiones criptográficas y riesgos residuales

Una contraseña debe validarse, no recuperarse; por eso se almacena con bcrypt y sal, mientras que la nota sí se cifra porque el dueño debe volver a leerla. AES-GCM proporciona confidencialidad e integridad con una llave de 256 bits y un IV aleatorio por valor cifrado. El tag se valida al descifrar. La llave productiva se configura aparte de `JWT_SECRET` mediante el gestor de secretos de la plataforma. No rotar la llave sin un procedimiento de descifrado y recifrado; el código actual no automatiza esa rotación.

SQLite y el rate limit en memoria son decisiones de escala para la práctica, no para un servicio multi-instancia. El proceso necesita una sola instancia y un volumen persistente; el equipo debe comprobar respaldos y recuperación. El endpoint de recuperación solo entrega tokens cuando existe un webhook configurado en producción; hace falta integrar un proveedor de correo real antes de uso público. No hay MFA, alertas externas ni bloqueo por cuenta. Las credenciales de prueba deben ser ficticias y compartirse con el docente por un canal privado, nunca en este informe o el README.
