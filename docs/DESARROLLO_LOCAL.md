# Espacio funcional en la PC

Se usa PostgreSQL instalado localmente, con un cluster propio de FacturIA, además
del staging autorizado en Railway. Las pruebas de cuentas usan datos sintéticos.

## Configuración

- Aplicación: `http://127.0.0.1:3000`.
- Demo: `/demo`; espacio con cuentas: `/workspace`.
- PostgreSQL: sólo `127.0.0.1:54329`.
- Base propia: `facturia_staging`; rol de aplicación: `facturia_app`.
- Cluster y registros: `.facturia-local/postgres/` (ignorado por Git).
- Conexión y secreto de sesiones: `.env.local` (ignorado por Git).

El rol de aplicación no es superusuario. Las credenciales se generan localmente;
no están en este documento ni en el repositorio. El servidor se inicia como
proceso local y no registra un servicio global de Windows.
El cluster está fuera de `node_modules` para que reinstalar dependencias no borre
la base. No eliminar `.facturia-local` al limpiar archivos de desarrollo.

## Ejecución

Desde la carpeta del proyecto, con PostgreSQL iniciado:

```powershell
npm run db:migrate
npm run dev -- --hostname 127.0.0.1
```

Abrir `/workspace`, crear una cuenta de pruebas y configurar el RFC del perfil.
El fixture `tests/fixtures/sample-cfdi40.xml` corresponde al receptor
`XAXX010101000`; el CSV de la misma carpeta tiene su cargo de $116 MXN.
Los sellos y datos de estas muestras son sintéticos y no tienen validez fiscal.

Para comprobar la versión compilada: `npm run check` y después `npm start --
--hostname 127.0.0.1`. Usar el mismo hostname configurado en `BETTER_AUTH_URL`.

Con el servidor activo y el registro habilitado, el flujo HTTP se comprueba con:

```powershell
node --import tsx scripts/verify-workspace-http.mjs
```

El script crea dos cuentas sintéticas y verifica aislamiento, XML/CSV, duplicados,
conciliación, exportación y cierre de sesión. Guarda las credenciales generadas
sólo en `node_modules/.cache/local-http.json`, ignorado por Git. Después de
reiniciar la aplicación, comprobar que sobreviven los mismos datos:

```powershell
node --import tsx scripts/verify-workspace-http.mjs --verify-only
```

## PostgreSQL al volver a abrir la PC

Estos comandos corresponden exclusivamente al cluster local de FacturIA.
Requieren los binarios PostgreSQL 18 instalados en la PC y ejecutar desde el repo:

```powershell
$facturiaPgData = Join-Path (Get-Location) '.facturia-local/postgres/data'
$facturiaPgLog = Join-Path (Get-Location) '.facturia-local/postgres/postgres.log'
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D $facturiaPgData status
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D $facturiaPgData -l $facturiaPgLog -w start
```

Para detenerlo conservando sus datos:

```powershell
$facturiaPgData = Join-Path (Get-Location) '.facturia-local/postgres/data'
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D $facturiaPgData -m fast -w stop
```

## Descargas

El respaldo JSON v1 incluye perfil, movimientos, documentos y XML originales
propios disponibles. El reporte CSV incluye estado y UUID vinculado; es para
revisión, tiene protección de textos frente a fórmulas y no es el formato del
importador bancario. Las descargas admiten hasta 25 MiB en el piloto.

La importación/restauración del JSON todavía no está habilitada. Antes de usar
datos reales falta ensayar restauración, verificar el entorno externo y cerrar
las integraciones pendientes del [plan de avance](PLAN_AVANCE.md).
