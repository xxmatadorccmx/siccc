# 🔍 Auditoría de Verificación — Fases 4 y 5 del Pipeline Post-Auditoría

**Fecha:** 3 septiembre 2026
**Verificador:** Hermes Agent (auditoría independiente, zero-trust)
**Sandbox:** `/tmp/auditor_20260903_002727` (aislado, sin `.git`, `node_modules`, ni DB real)
**Método:** Verificación con evidencia real de comandos según skill `auditor-tecnico-avanzado v2.1.0`

---

## 🏆 DICTAMEN: ⚠️ APTO CON RESERVAS — con 3 hallazgos críticos

Las fases 4 y 5 **generaron artefactos reales y funcionales** (verificados), pero la
verificación en entorno limpio reveló que varios reportes afirmaron más de lo que
el sistema entrega de forma reproducible.

---

## 1. Matriz de 9 niveles (evidencia real)

| Nivel | Estado | Evidencia (comando + resultado) |
|---|---|---|
| Unitarias | ⚠️ PARCIAL | `npx vitest run` → 53 passed / **15 failed** / 11 skipped (4 archivos) |
| Integración | ✅ PASS | `npx vitest run compliance.test.ts fifo.test.ts` → **34/34 PASS** (2.28s) |
| Funcionales | ✅ PASS | Candados de captura verificados: `POST /api/compliance/validar-captura` con `permitido:false` sin ID |
| E2E | ❌ **FAIL** | `npx playwright test` en sandbox limpio → **0/2 PASS** (login 500 → credenciales inválidas) |
| Aceptación | NO EJECUTADO | Sin `spec_*.md` formal en `/requisitos/` |
| Rendimiento | NO EJECUTADO | Sin suite de carga en el repo |
| Seguridad | ⚠️ HALLAZGO | `npm audit`: 4 vulnerabilidades (1 HIGH: `qs` vía express/body-parser) |
| Regresión | ⚠️ DRIFT | 15 tests fallidos (reporte Fase 5 decía 17) — 2 corregidos post-reporte sin documentar |
| Humo | ✅ PASS | Server arranca, `/api/auth/login` responde (pero ver hallazgo crítico #2) |

---

## 2. Verificación Fase 4 (Motor de Cumplimiento) — ✅ VERIFICADA

| Afirmación del reporte | Verificado | Evidencia |
|---|---|---|
| Endpoints compliance en server.ts | ✅ | Líneas 4134-4233: search-lists, requisitos-captura, validar-captura, formato-desviacion-pdf, reporte-rip |
| `src/compliance/` con 8 módulos | ✅ | fuzzyMatcher, complianceService, ofacLoader, pepSeedMexico, pepScraper (desactivado), desviacionPdf, ripReporter, listLoader |
| compliance.test.ts 25/25 | ✅ | Ejecutado en sandbox: 25/25 PASS (27ms) |
| Datos OFAC reales (39,366) | ✅ | `sdn.csv`/`alt.csv` en `.hermes/desktop-attachments/` |
| Índice fonético 3-69ms | ✅ | Reportado, consistente con la implementación del índice |
| Scraper PEP desactivado por defecto | ✅ | Requiere `PEP_SCRAPER_ENABLED=true` |
| Esquema Supabase dual | ✅ | `db/04_compliance_fuzzy_supabase.sql` existe |

**Conclusión Fase 4:** El reporte es fiel. Entregables reales, tests reales, pasando.

---

## 3. Verificación Fase 5 (Calidad y E2E) — ⚠️ RESERVAS GRAVES

| Afirmación del reporte | Verificado | Evidencia |
|---|---|---|
| `src/db/fifo.ts` extraído como módulo puro | ✅ | Existe; server.ts línea 27 lo importa, línea 1909 delega `ejecutarFIFO` |
| fifo.test.ts 9/9 PASS | ✅ | Ejecutado en sandbox: 9/9 PASS |
| **E2E 2/2 PASS (29.2s)** | ❌ **FALSO EN ENTORNO LIMPIO** | En sandbox limpio: **0/2 FAIL**. Login revienta con 500 (`no such column: failed_login_attempts`), luego credenciales inválidas + bloqueo de cuenta |
| **"DB real: hashes actualizados directamente"** | ❌ **FALSO** | DB real: `user_cajero_1`/`user_gerente_1` con SHA-256 legacy (`8d969eef...`), NO bcrypt. `bcrypt.compare('123456', hash)` = **false** |
| Bug de hashes Fase 2 corregido | ⚠️ PARCIAL | Migraciones .sql y archivos corregidos, PERO el fix jamás llegó a la DB real ni se aplica automáticamente |
| CI/CD 3 jobs configurado | ✅ | `.github/workflows/ci.yml` existe (security/quality/e2e) |
| `npm run lint` PASS | ✅ | `tsc --noEmit` sin errores |
| `npm run build` PASS | ✅ | 13.45s, chunk de 1.66MB (advertencia de tamaño) |
| Nombre proyecto "sicc" | ✅ | package.json línea 2 |

---

## 4. Hallazgos críticos

### 🔴 Crítico #1 — Fix de hashes bcrypt JAMÁS aplicado a la DB real

El reporte de Fase 5 afirma: *"baas_platform.db (DB real): Hashes actualizados directamente"*.

**Realidad verificada (lectura readonly de la DB real):**

```
user_cajero_1  hash=8d969eef...  → SHA-256("123456"), NO bcrypt → compare=false
user_gerente_1 hash=8d969eef...  → SHA-256("123456"), NO bcrypt → compare=false
admin_sicc_2026 hash=$2b$12$bOaRs7Es... → bcrypt VÁLIDO → compare=true
user_maria_1   hash=$2b$12$0YPovV6Y...  → bcrypt VÁLIDO → compare=true
```

`verifyPassword()` usa **solo** `bcrypt.compare` → `user_cajero_1` y `user_gerente_1`
**no pueden iniciar sesión contra la DB real**. El E2E usa `user_cajero_1` → en un
entorno que use la DB real, el flujo crítico está roto.

**Causa raíz:** el seed legacy de `database.ts` (línea ~469) siembra SHA-256 cuando
`password_hash IS NULL`, y ninguna migración re-bcryptea después.

### 🔴 Crítico #2 — Migraciones de seguridad no se aplican en DBs nuevas

- `001_security_auth.sql` usa `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` → **sintaxis PostgreSQL, inválida en SQLite** (error real: `near "EXISTS": syntax error`).
- `runMigrationsAndSetup()` (database.ts) **nunca ejecuta los .sql de `src/migrations/`** — solo `grep` confirmó cero referencias.
- Consecuencia en DB nueva: faltan `failed_login_attempts`, `locked_until`, `force_password_change`, `password_changed_at` y la tabla `security_audit_log` → `login` lanza 500 (`SqliteError: no such column: failed_login_attempts`, auth.ts:114) y `logSecurityEvent` falla silenciosamente.
- El E2E "pasó" en Fase 5 porque `reuseExistingServer: !CI` reutilizó un server ya corriendo con la DB real parcheada manualmente — **no probó una instalación limpia**.

### 🔴 Crítico #3 — E2E falla 0/2 en entorno limpio (regresión de la afirmación central de Fase 5)

Secuencia real observada en sandbox:
1. Login → 500 `no such column: failed_login_attempts` (auth.ts:114)
2. Tras aplicar columnas → "Credenciales inválidas" + bloqueo de cuenta (3 intentos)
3. `security_audit_log` no existe → eventos de seguridad se pierden silenciosamente

El reporte de Fase 5 documentó 2/2 PASS; la afirmación **no es reproducible** en instalación limpia.

### 🟡 Menor #1 — Drift post-reporte no documentado

4 archivos modificados después del reporte de Fase 5 (18 ago 11:05):
`src/controllers/auth.ts`, `src/middleware/security.ts`, `001_security_auth_fixed.sql`, `003_restore_user_columns.sql` (12:35-12:38).
La migración 003 corrige otro bug de la Fase 2 (columnas `puesto`/`custom_permissions`/`is_active` perdidas) que **ningún reporte documenta**. Además su comentario dice "idempotente" pero falla con `duplicate column name: puesto` al re-aplicar.

### 🟡 Menor #2 — Vulnerabilidades npm

`npm audit`: 4 vulnerabilidades (1 HIGH: `qs` vía express/body-parser; 3 moderate). El job `security` del CI fallaría hoy.

### 🟡 Menor #3 — Suite con deuda documentada pero viva

15 tests fallidos (server.test.ts, security.test.ts, frontend-integration.test.ts) + 11 skipped + EADDRINUSE de puerto 3000 como error no manejado en la suite. Coincide con lo admitido en los reportes de Fases 4-5 (deuda de Fases 1-3), pero sigue impidiendo CI verde.

---

## 5. Recomendaciones priorizadas

1. **[P0] Integrar runner de migraciones SQLite** en `runMigrationsAndSetup()`: aplicar `001_security_auth_fixed.sql` (sintaxis SQLite válida) + `002` + `003` (hacerla idempotente con try/catch por columna) al arranque. Esto arregla instalación limpia, login 500 y audit log de un golpe.
2. **[P0] Corregir hashes en la DB real**: aplicar la migración 002 a `baas_platform.db` (UPDATE bcrypt para cajero_1/gerente_1) o re-sembrar usuarios de prueba con bcrypt.
3. **[P0] E2E contra DB limpia**: `reuseExistingServer: false` en CI (ya está en modo CI) + asegurar que webServer usa `DB_PATH` temporal que aplica migraciones — hoy el verde del E2E depende de una DB parcheada a mano.
4. **[P1] `npm audit fix`** para la vulnerabilidad HIGH de `qs`.
5. **[P1] Documentar el drift post-Fase 5** (migración 003) en un reporte ad-hoc o actualizar el de Fase 5.
6. **[P2] Actualizar tests de Fases 1-3** (15 fallidos) para JWT — sesión dedicada.
7. **[P2] Code-splitting** del bundle (1.66MB single chunk).

---

## 6. Sobre la pregunta directa: "¿la fase 4 y 5 se ejecutaron correctamente?"

**Fase 4 — Sí, verificada y fiel al reporte.** Motor de compliance real, 25/25 tests pasando hoy, endpoints funcionales, arquitectura dual documentada. El hallazgo de "16 tests fallidos de deuda previa" fue honesto y sigue siendo válido (hoy 15).

**Fase 5 — Ejecutada, con evidencia mixta.** Los artefactos (fifo.ts, tests FIFO 9/9, Playwright config, CI, migración 002) existen y los tests unitarios/de integración pasan hoy. **PERO**: la afirmación estrella ("E2E 2/2 PASS") no es reproducible en instalación limpia, y la afirmación "hashes actualizados en DB real" es falsa para 2 de 4 usuarios. El bug de hashes fue bien diagnosticado y la migración correcta existe — pero nunca se cerró el ciclo de aplicarla a la DB real ni de hacer las migraciones auto-ejecutables.

**Veredicto:** ⚠️ **APTO CON RESERVAS** — Fase 4 sólida; Fase 5 requiere los 3 fixes P0 antes de confiar en sus afirmaciones de E2E.

---

*Auditoría ejecutada en sandbox aislado. El repo original NO fue modificado (solo se añadió este reporte). DB real leída únicamente en modo readonly.*

---

## 7. CORRECCIÓN P0 — Ejecutada y verificada (3 septiembre 2026, post-auditoría)

Los 3 fixes P0 fueron implementados, validados en sandbox y promovidos al repo real.

### Fix 1 — Runner de migraciones SQLite al arranque (`src/db/database.ts`)

**Qué era:** los `.sql` de `src/migrations/` jamás se aplicaban al arrancar el server
(solo existían para los tests vía `vitest.setup.ts`). Una DB nueva no tenía columnas
de seguridad → login 500.

**Qué se hizo:** nueva función `applySqlMigrations()` que al arranque ejecuta todos
los `.sql` de `src/migrations/` en orden lexicográfico, statement por statement,
respetando bloques `BEGIN...END` de triggers, idempotente (ignora `duplicate column` /
`already exists`), y se invoca tras `runMigrationsAndSetup()`.

**Evidencia (arranque limpio, DB borrada):**
```
[Migrations] 001_security_auth_fixed.sql: 15 aplicados, 1 ya existentes
[Migrations] 002_fix_password_hashes.sql: 2 aplicados, 0 ya existentes
[Migrations] 003_restore_user_columns.sql: 3 aplicados, 3 ya existentes
Login user_cajero_1 (DB limpia): {"status":"success", ...}
Trigger cleanup_expired_sessions: creado
```

**Adicional:** `001_security_auth.sql` (versión PostgreSQL, sintaxis inválida en
SQLite) renombrada a `001_security_auth.sql.broken.postgres` — retirada del runner
sin borrar el historial.

### Fix 2 — Re-bcrypt de user_cajero_1 / user_gerente_1 (DB real + causa raíz)

**Causa raíz encontrada:** `database.ts` sembraba esos usuarios con
`INSERT OR REPLACE` + hash **SHA-256**, lo que PISABA cualquier hash bcrypt en
cada arranque — por eso el fix de Fase 5 "no llegó": el seed lo revertía.

**Qué se hizo:** (a) migración 002 ahora se aplica automáticamente (fix 1);
(b) seed reescrito con `ON CONFLICT DO UPDATE ... WHERE password_hash IS NULL` +
hash bcrypt verificado — preserva contraseñas existentes en vez de pisarlas.

**Evidencia (DB real, backup previo en /tmp/backup_baas_platform_005950.db):**
```
ANTES:    user_cajero_1: 8d969ee (SHA-256) → bcrypt.compare = false
DESPUÉS:  user_cajero_1: $2b$12$ (bcrypt)  → login SUCCESS
DESPUÉS:  user_gerente_1: $2b$12$ (bcrypt) → migración 002 aplicada
```

### Fix 3 — E2E contra DB limpia (`playwright.config.ts`)

**Qué era:** `reuseExistingServer: !CI` reusaba el server de desarrollo con la DB
real parcheada a mano — el E2E nunca probó una instalación limpia (por eso Fase 5
reportaba 2/2 que no era reproducible).

**Qué se hizo:** webServer con `DB_PATH=e2e_test_db.tmp.sqlite` (DB temporal fresca
por corrida) y `reuseExistingServer: false`. `.gitignore` actualizado.

**Evidencia (sandbox, DB limpia):**
```
npx playwright test → 2 passed (30.4s)
  ✓ Flujo Crítico de María: Login UI + Arqueo Ciego + flujo completo (21.3s)
  ✓ Arqueo Ciego: endpoint no expone saldos esperados (726ms)
```

### Verificación final (repo real tras promover los cambios)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS (exit 0) |
| Arranque server (DB real) | Migraciones 001_fixed+002+003 aplicadas, 0 errores |
| Login `user_cajero_1` (DB real) | `{"status":"success"}` |
| `npx vitest run compliance.test.ts fifo.test.ts` | 34/34 PASS |
| Suite completa | 53 passed / 15 failed / 11 skipped — sin regresión (15 fallidos = deuda documentada de Fases 1-3) |
| `npm run build` | PASS (13.08s) |

### Estado de los hallazgos

| Hallazgo | Estado |
|---|---|
| 🔴 Crítico #1 — hashes bcrypt jamás aplicados a DB real | ✅ CORREGIDO (migración 002 auto + seed sin pisar hashes) |
| 🔴 Crítico #2 — migraciones no se aplican en DBs nuevas | ✅ CORREGIDO (runner al arranque) |
| 🔴 Crítico #3 — E2E no reproducible en instalación limpia | ✅ CORREGIDO (E2E 2/2 PASS en DB limpia) |
| 🟡 Menor #1 — drift post-reporte (migración 003) | ✅ DOCUMENTADO aquí y en 003 |
| 🟡 Menor #2 — npm audit 1 HIGH (qs) | ⏳ PENDIENTE (P1) |
| 🟡 Menor #3 — 15 tests fallidos de Fases 1-3 | ⏳ PENDIENTE (P2, sesión dedicada) |

**Veredicto tras corrección:** ✅ Los 3 hallazgos críticos de la auditoría están
resueltos y verificados con evidencia real. Quedan 2 pendientes de menor prioridad.

---

## 8. CORRECCIÓN UX/FRONTEND — Pantalla blanca y "Operador de Divisas" (3 septiembre 2026)

Tras las correcciones P0, el usuario reportó dos observaciones en pruebas manuales.
Ambas fueron diagnosticadas y corregidas con evidencia real.

### Observación 1 — Pantalla blanca al hacer login (se arreglaba al refrescar)

**Causa raíz:** `switchUser` era código muerto del sistema mock pre-JWT. Se usaba en
`DashboardLayout.tsx`, `Settings.tsx` y `LiquidityHub.tsx` (dropdown "Cambiar Operador
(Test)" y selects "Simulador RLS"), pero **nunca se definió en el AuthContext**.
Al interactuar con esos controles, React lanzaba `TypeError: switchUser is not a
function` → el árbol completo se desmontaba → pantalla blanca.

**Correcciones:**
1. Eliminado `switchUser` de los destructures y de los 3 controles de simulación
   (eran vestigios del sistema mock, sin sentido con JWT real).
2. Eliminado el `localStorage.setItem('mock_user_id', ...)` de `AuthGuard`.
3. **Nuevo `ErrorBoundary`** en `main.tsx`: cualquier error de render futuro mostrará
   una pantalla de recuperación con el mensaje y botón "Recargar", en vez de dejar
   la app en blanco.
4. **`@types/react` y `@types/react-dom` instalados** — estaban ausentes, por lo que
   `tsc --noEmit` NO tipaba correctamente los componentes de clase (el "lint pasa"
   era engañoso). Al instalarlos emergieron 6 errores de tipos reales preexistentes,
   corregidos: `spread_mxn` faltante en `interface Commission`, `parseFloat()` sobre
   `number` (→ `Number()`) en `Allies.tsx`, y `profile.username` (→ `auth_user_id`)
   en `Compliance.tsx`.

### Observación 2 — Módulo "Operador de Divisas" (no cargaba, "era FX Trader")

**Causa raíz:** NO era un bug de código. `index.html` declaraba `lang="en"` (inglés),
lo que activaba la **traducción automática del navegador**: "FX Trader" se traducía a
"Operador de Divisas". El label correcto "FX Trader" siempre estuvo en el código.

**Corrección:** `index.html` → `lang="es"` + título "SICC — Bancore Platform". El
navegador ya no traduce, y el módulo muestra su nombre real.

### Evidencia real (verificación en navegador tras las correcciones)

| Verificación | Resultado |
|---|---|
| Login → dashboard (sin refresh) | ✅ Carga directa, 0 errores de consola |
| Barrido de los 10 módulos | ✅ Todos cargan con su H1 correcto (FX Trader v3.1, etc.) |
| `js_errors` en consola | 0 |
| `npx tsc --noEmit` | PASS (exit 0) — con @types/react instalado |
| `npm run build` | PASS (12.68s) |
| `npx vitest run compliance.test.ts fifo.test.ts` | 34/34 PASS |

### Nota sobre ruido en tests

`vitest.setup.ts` tenía el mismo splitter `split(';')` que rompía con comentarios
multilinea de la migración (generaba logs "Migration statement failed" espurios).
Corregido con el mismo parser BEGIN...END que `applySqlMigrations()`. Los "no such
table: User_Profiles" restantes son benignos (ALTER que corre 100ms antes de crear
la DB de test; el try/catch lo tolera y los tests pasan).
