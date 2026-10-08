# Coordinación de trabajo

El trabajo activo está en `sprint-1`. La demo y el espacio autenticado comparten
componentes, pero no almacenamiento ni datos. Consultar `docs/PLAN_AVANCE.md` y
`docs/STAGING.md` antes de continuar.

Para compartir este repo entre Codex y Claude Code en la misma PC:

1. Revisar `git status` y comunicar qué archivos editará cada herramienta.
2. Evitar edición simultánea del mismo archivo. Usar ramas/worktrees distintos
   cuando las tareas puedan avanzar de manera independiente y coordinar su integración.
3. No sobrescribir cambios sin commit; registrar un punto de control antes del relevo.
4. Ejecutar `npm run check`, revisar el diff y documentar el estado de cada tarea.
5. Registrar bloqueos reales (credenciales/proveedor/autorización), no sustituirlos
   por resultados ficticios. Mantener claves exclusivamente en variables privadas.
6. El usuario autorizó Railway staging y el límite duro de USD 10 de recursos del
   workspace. Producción/main requieren revisión, pruebas y aprobación adicional.
   Mantener los commits nuevos atribuidos sólo a su cuenta GitHub, sin coautorías.

No hay una conexión automática configurada entre agentes. Los archivos, commits,
pruebas y estas notas permiten un relevo; el usuario decide cómo habilitar mensajes.
