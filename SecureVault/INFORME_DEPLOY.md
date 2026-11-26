# Investigación: despliegue seguro de SecureVault

**Fecha de consulta:** 25 de noviembre de 2026. Los precios y cuotas de los proveedores cambian; hay que comprobar el panel antes de crear un servicio. Este documento es una base para el informe de 2 a 4 páginas del laboratorio.

## Resumen ejecutivo

Un despliegue de producción incluye más que subir `server.js`: hay que mantener el proceso en ejecución, asignarle una URL HTTPS, guardar secretos fuera del repositorio, conservar la base de datos después de reinicios y revisar el servicio publicado. Para el prototipo de clase se propone Railway como PaaS con un volumen persistente para SQLite. Su nivel gratuito tiene un crédito mensual pequeño y puede dormir; sirve para una demostración con poco tráfico, pero no ofrece disponibilidad garantizada. Si el docente exige servicio continuo o datos de mayor valor, debe autorizarse un plan con presupuesto y migrar a una base PostgreSQL gestionada.

## 1. PaaS, contenedores y VPS/IaaS

| Opción | Ventajas | Costos y límites | Control y trabajo operativo |
| --- | --- | --- | --- |
| PaaS, como Railway o Render | Conecta el repositorio, configura dominio y TLS desde el panel, muestra logs y permite definir variables secretas. Es lo más sencillo para una práctica. | Cuotas gratuitas limitadas, suspensión por inactividad o almacenamiento temporal; los planes y los límites cambian. | Bajo control del sistema operativo. El proveedor administra la máquina, el proxy de entrada y buena parte de la operación. |
| Contenedor Docker en un servicio administrado | El `Dockerfile` permite fijar Node y las herramientas del entorno, y repetir la misma imagen en varios proveedores. Aísla el proceso y facilita CI/CD. | El costo depende del servicio que ejecuta el contenedor; se deben sumar almacenamiento persistente y base de datos. | Control medio: el equipo mantiene imagen, dependencias, usuario del contenedor y volúmenes; el proveedor gestiona la infraestructura. |
| VPS/IaaS, por ejemplo una VM | Control del sistema, red, proxy, firewall, versiones, procesos y configuración a bajo nivel. | Se paga la máquina y almacenamiento aunque haya poco tráfico; copias, monitoreo y recuperación requieren trabajo. | Alto control y alta carga operativa. El equipo aplica parches, configura firewall, Nginx/Caddy, TLS, usuario sin privilegios, `systemd`/PM2 y respaldos. |

Docker no es por sí solo una plataforma de despliegue: una imagen suele ejecutarse en un PaaS o en una VM. Para esta API pequeña, el PaaS reduce tareas de infraestructura; SQLite permite evitar una base de datos separada en la demostración, siempre que el archivo viva en un volumen persistente y se use una sola instancia.

## 2. Comparación de tres plataformas

La tabla compara opciones concretas consultadas el 25/11/2026. Las cuotas se verifican en las páginas oficiales del proveedor y pueden variar por región, cuenta y cambios de plan.

| Plataforma | Nivel gratuito consultado | Sueño y almacenamiento | HTTPS, base de datos y región | Adecuación para SecureVault |
| --- | --- | --- | --- | --- |
| **Railway** | Plan Free con USD 1 de consumo al mes; nuevas cuentas pueden recibir una prueba única por 30 días con USD 5. | El servicio duerme después de 5–10 min sin tráfico saliente; ofrece volumen persistente, de 0.5 GB en el plan gratuito. | Puede generar dominio `*.up.railway.app`; el dominio se sirve con TLS automático. Hay PostgreSQL y otras bases como servicios. En Free no se garantiza elegir región. | La alternativa más directa para mantener SQLite en un volumen y probar la API. El crédito puede agotarse; no prometer disponibilidad ni usar datos reales. |
| **Render** | Tiene servicios web Free para pruebas y proyectos personales. | El web service duerme después de 15 min sin solicitudes; el sistema de archivos es efímero, por lo que SQLite se pierde en reinicios, despliegues o suspensión. El plan gratuito de Postgres vence a los 30 días. | Incluye subdominio `onrender.com` y TLS administrado. Servicios pagos pueden adjuntar disco; PostgreSQL puede persistir. Región seleccionada al crear el servicio. | Fácil para desplegar una demo sin estado, pero no usar el disco local para la base de SecureVault en Free. Haría falta PostgreSQL o un plan con disco persistente. |
| **Fly.io** | El anuncio oficial del 23/11/2026 ofrece USD 5 de crédito de uso mensual. | Las máquinas facturan por segundo; volumen local persistente cuesta USD 0.15/GB/mes y snapshots tienen su propia cuota. | La tarifa depende de tamaño y región; el precio publicado para shared-cpu-1x/256 MB es alrededor de USD 2.19 al mes si corre continuamente, antes de almacenamiento y tráfico. | Más control que Railway y se adapta a un volumen SQLite. El margen del crédito puede ser limitado; confirmar requisitos de cuenta y presupuesto antes de crear recursos. |

Railway se propone para el laboratorio porque requiere menos administración que un VPS y ofrece un volumen. Configuración sugerida: raíz del servicio en la carpeta `SecureVault`, comando `npm start`, ruta de salud `/health`, volumen montado en `/data` y `DATABASE_PATH=/data/securevault.sqlite`. Añadir `NODE_ENV=production`, `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` desde la pantalla de variables privadas del proveedor. No copiar ningún valor secreto al repositorio. Generar el dominio público y comprobar que su URL comience con `https://`.

**Límite:** Railway Free es una cuota para aprendizaje, no un SLA. El proceso puede dormir y la aplicación tiene una sola instancia. No añadir tarjeta, aceptar un plan de pago ni introducir datos personales reales para esta tarea sin autorización del adulto responsable y del docente.

## 3. Secretos, TLS, proxy y procesos

Las variables de entorno permiten configurar el mismo código para desarrollo y producción. `.env` es útil localmente, pero es solo un archivo en la computadora: puede filtrarse en una copia, una captura, un respaldo o un commit. `.gitignore` lo excluye, pero en producción se debe usar la sección de secretos del proveedor o un gestor dedicado. `JWT_SECRET` firma tokens y `ENCRYPTION_KEY` cifra datos; deben ser valores aleatorios distintos. Si se pierde la llave de cifrado, las notas antiguas no se pueden recuperar. Mantener respaldos protegidos y planear una rotación antes de usar datos importantes.

TLS cifra el tráfico entre el navegador y el servicio y permite validar que se habló con el dominio correcto. Let's Encrypt es una autoridad certificadora gratuita y automatizada; Railway/Render administran certificados para sus dominios compatibles. HSTS indica a navegadores que recuerden utilizar HTTPS en visitas futuras; SecureVault usa Helmet para establecer encabezados, pero HSTS no reemplaza TLS ni arregla una conexión insegura inicial.

Un proxy inverso como Nginx o Caddy recibe la conexión pública, aplica TLS y reenvía tráfico al proceso Node. En un PaaS normalmente el proveedor cumple ese papel. `trust proxy` afecta IP, protocolo y host que Express deduce de encabezados `X-Forwarded-*`; debe habilitarse solo con el número de proxies realmente confiables. Confiar en todos los encabezados puede permitir suplantar IP o protocolo. SecureVault deja esta opción apagada por omisión y permite configurarla mediante `TRUST_PROXY`.

En una VM, `systemd` o PM2 puede reiniciar Node si el proceso termina y permite iniciarlo tras un reinicio. En un PaaS ese ciclo de vida suele administrarlo la plataforma; no se necesita PM2 dentro de la aplicación. La aplicación usa `PORT`, escucha en `0.0.0.0`, cierra SQLite al recibir SIGINT/SIGTERM y expone `/health` para un chequeo de salud.

## 4. CI/CD, bases de datos y verificación posterior

CI/CD automatiza la integración de cambios y el despliegue. El workflow del repositorio fija Node 24, instala desde `package-lock.json` con `npm ci`, ejecuta `npm audit` y comprueba sintaxis. Dependabot revisa actualizaciones. El despliegue desde el proveedor se configura después de publicar el repositorio y guardar un token de despliegue como secreto de GitHub; no se incluye ese token en el código. Para una aplicación con usuarios reales, la canalización debe añadir pruebas automatizadas antes de permitir el despliegue.

SecureVault usa SQLite para la práctica y una sola instancia. Para más de una instancia, concurrencia alta o mayor recuperación, elegir PostgreSQL gestionado (por ejemplo, Railway Postgres, Neon o Supabase) y conectar con TLS, usuario de privilegios mínimos y lista de redes permitidas cuando el proveedor lo admita. MongoDB Atlas es una alternativa documental, aunque exigiría cambiar el acceso y el esquema del código. No usar un archivo SQLite local en un servicio efímero.

Después del despliegue: abrir `/health`; registrar un usuario de prueba; crear una nota; revisar que pueda verla, editarla y borrarla; crear dos cuentas y confirmar que la segunda no puede leer la nota de la primera; consultar las cabeceras con Mozilla Observatory o SecurityHeaders; ejecutar OWASP ZAP contra la propia URL del equipo; revisar TLS con SSL Labs; revisar dependencias con `npm audit`. Guardar capturas de los resultados y fecha. Ejecutar escaneos únicamente contra la aplicación propia con autorización. La URL debe permanecer disponible durante la evaluación y la base debe conservar los datos tras un reinicio.

## Referencias consultadas

1. Node.js, [releases soportados y LTS](https://nodejs.org/en/about/previous-releases).
2. Node.js, [módulo SQLite integrado](https://nodejs.org/api/sqlite.html) y [módulo Crypto](https://nodejs.org/api/crypto.html).
3. Render, [servicios gratuitos y sus límites](https://render.com/docs/free) y [web services, puertos y TLS](https://render.com/docs/web-services).
4. Railway, [plan Free y consumo](https://docs.railway.com/pricing/free-plan), [volúmenes persistentes](https://docs.railway.com/volumes) y [dominios y certificados](https://docs.railway.com/networking/domains/working-with-domains).
5. Fly.io, [anuncio del crédito Free](https://fly.io/changelog/introducing-the-free-plan/) y [precios de máquinas, volúmenes y red](https://fly.io/pricing/).
6. Express, [prácticas de seguridad para producción](https://expressjs.com/en/advanced/best-practice-security/) y [configuración de proxy confiable](https://expressjs.com/en/guide/behind-proxies/).
7. OWASP, [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) y [Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).
8. GitHub, [workflow de Node.js con Actions](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs).
