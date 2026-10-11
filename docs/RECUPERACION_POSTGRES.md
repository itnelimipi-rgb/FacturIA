# Ensayo completo de recuperación de PostgreSQL

El respaldo JSON del espacio recupera registros de una cuenta. Este ensayo usa
`pg_dump` y `pg_restore`, herramientas libres de PostgreSQL, para comprobar la
recuperación de la base local completa: cuentas, hashes de contraseña, sesiones,
verificaciones, perfiles, comprobantes, XML originales y bytes de PDF/imágenes,
movimientos, auditoría, cuotas compartidas,
migraciones y las tablas adicionales presentes en `public`.

El ensayo utiliza exclusivamente el cluster privado de FacturIA de la PC, en
`127.0.0.1:54329`, con PostgreSQL 18. No opera Railway, servicios globales de
Windows ni bases externas. No necesita APIs ni genera consumo externo.

## Ejecutar

Iniciar el cluster según [desarrollo local](DESARROLLO_LOCAL.md) y aplicar las
migraciones antes de ejecutar desde la carpeta del proyecto:

```powershell
npm run db:migrate
node --import tsx --env-file=.env.local scripts/verify-postgres-recovery.mjs
```

El script verifica la identidad, carpeta de datos y dirección de escucha del
cluster antes de crear una base. `DATABASE_URL` debe corresponder exactamente al
rol restringido `facturia_app` y a la base local `facturia_staging`. Lee el secreto
de administración de `.facturia-local/postgres/bootstrap-password.local`; no lo
imprime ni lo incluye en argumentos de procesos. Las herramientas reciben la
contraseña sólo en el entorno de su proceso hijo.

Cada ejecución realiza lo siguiente:

1. Mantiene una transacción de lectura con un snapshot exportado para que el
   respaldo y las huellas representen el mismo estado, incluso si la aplicación
   registra cambios mientras se ejecuta `pg_dump`.
2. Escribe un archivo nuevo en formato custom bajo `.facturia-local/backups/`,
   con SHA-256 del archivo. Nunca sobrescribe un respaldo anterior.
3. Crea una base nueva llamada `facturia_restore_check_<UUID>`, usando
   `template0`, y restaura todo en una transacción con el rol de aplicación como
   propietario. No sustituye ni modifica la base de origen. No crea extensiones.
4. Compara esquema, columnas, restricciones, índices, vistas, funciones,
   triggers, políticas, enums y secuencias, además del número de filas y las
   huellas del contenido de cada tabla. Las huellas MD5 agregadas sirven para
   comparar la copia local; no son una firma de autenticidad del respaldo.
5. Comprueba en el clon las restricciones de propiedad, UUID único, vínculo
   único por comprobante y formato RFC. Revierte estos registros de prueba.
6. Lee cada espacio con el repositorio real de la aplicación y, si hay XML
   originales, comprueba una lectura de exportación y su huella. Verifica otra
   vez que las tablas conservan el contenido respaldado.
7. Elimina exclusivamente el clon creado por esa ejecución. Conserva el dump,
   su inventario y un manifiesto privado con el resultado.

Si una restauración falla, el script intenta eliminar sólo su propio clon; jamás
borra ni reemplaza `facturia_staging`. La operación se rechaza si se agregan
esquemas o extensiones que este procedimiento todavía no contempla. No restaura
roles globales ni ACL; el cluster tiene sus roles privados creados previamente y
los objetos recuperados pertenecen al rol restringido de la aplicación.

## Inspección y comprobación de rendimiento

Para conservar el clon restaurado y revisarlo localmente:

```powershell
node --import tsx --env-file=.env.local scripts/verify-postgres-recovery.mjs --keep-restored
```

El resultado muestra el nombre exacto del clon. No cambia `.env.local` ni mueve
la aplicación a esa base. Conservar clones ocupa disco; su eliminación posterior
requiere comprobar el nombre completo y la identidad del cluster antes de
ejecutar un `DROP DATABASE` explícito. No se ofrece un borrado por patrones.

Para añadir una comprobación breve de conciliación y lecturas en PostgreSQL:

```powershell
node --import tsx --env-file=.env.local scripts/verify-postgres-recovery.mjs --load-smoke
```

Esta opción agrega 200 comprobantes y 200 movimientos sintéticos únicamente al
clon, realiza 20 lecturas del repositorio con concurrencia 2 y comprueba que se
concilian. Después elimina esos registros y vuelve a comparar las huellas.
Reporta duración y percentiles locales. Es una comprobación inicial, no una
estimación de capacidad de Railway ni una prueba de usuarios concurrentes por
HTTP.

## Resultado del 11 de octubre de 2026

Ensayo completado a `2026-10-11T23:28:59Z` en PostgreSQL 18 local. Las 11 tablas,
el esquema y las huellas de todo el contenido coincidieron después de restaurar,
incluido el original PDF privado y el registro de consulta SAT. Se comprobaron
cuatro restricciones SQL, ocho espacios de cuentas y una exportación con XML
original. El clon temporal se eliminó; el dump y manifiesto privados se conservaron.

La comprobación de carga en el clon concilió 200 documentos y 200 movimientos,
con 20 lecturas a concurrencia 2: p50 204 ms y p95 358 ms. El ensayo completo
tardó aproximadamente 5.5 segundos. Estos valores describen esta ejecución
local con datos sintéticos; no establecen la capacidad del staging ni de producción.

## Custodia del respaldo

Los dumps incluyen hashes de contraseña, sesiones y XML. Son datos sensibles,
aunque las cuentas del ensayo sean sintéticas. `.facturia-local/` está ignorada
por Git: no adjuntar estos archivos a issues, chats públicos ni commits. Los
permisos de archivo solicitados por Node no reemplazan las ACL de Windows.

El dump local no protege frente a pérdida de la PC. Antes de introducir datos
reales se necesita una política de retención, una copia cifrada fuera del equipo,
un ensayo de recuperación en el destino definitivo y una forma segura de
custodiar el secreto de sesiones de Better Auth. El script no lo exporta.
