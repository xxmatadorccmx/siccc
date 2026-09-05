# 🛡️ FASE 4 — Motor de Cumplimiento Independiente (Compliance)

**Fecha:** 15 agosto 2026
**Agente:** Especialista Fintech/Compliance (Hermes Agent — DeepSeek v4 Pro)
**Alcance:** Fuzzy Matching + Candados de Captura + PDF Desviación + Reportes RIP

---

## 🏆 Objetivo Cumplido

SICC dejó de depender de SOFTExchange para el motor de riesgos. Ahora gestiona su
propio motor de cumplimiento con listas OFAC reales, PEP México, candados
regulatorios, generación de documentos y reportes trimestrales.

---

## 1. Fuzzy Matching Fonético (OFAC, PEP, CNBV, SAT)

### ¿Qué es? (no-code)
Antes, si buscabas "Guzman" y en la lista estaba "Guzmán", el sistema NO lo
encontraba (la tilde rompía la búsqueda). Ahora el sistema "escucha" los nombres
como un humano: detecta que "Smith" y "Smyth" suenan igual, que "Guzman" y
"Guzmán" son la misma persona, y que "Loerra" es un typo de "Loera".

### ¿Qué es? (técnico)
Motor de coincidencia difusa con **tres técnicas complementarias**:

| Técnica | Qué resuelve | Ejemplo |
|---------|--------------|---------|
| **Normalización** (NFD) | Acentos y mayúsculas | "José" → "JOSE" |
| **Double Metaphone** | Sonidos parecidos | "Smith" ≈ "Smyth", "Claudia" ≈ "Klaudia" |
| **Levenshtein** | Errores de tecleo | "Loerra" ≈ "Loera" |

El score final (0..1) prioriza: **exacto > fonético > similar**.

### Datos reales cargados
```
OFAC SDN:  39,366 registros (19,189 entidades + 20,177 alias "a.k.a.")
PEP México: 25 funcionarios federales (semilla curada)
CNBV:       registros semilla existentes
SAT 69-B:   registros semilla existentes
```

### Evidencia real (contra datos OFAC verdaderos)

| Consulta | Resultado | Tiempo |
|----------|-----------|--------|
| "Joaquin Guzman Loera" (exacto) | 🟥 ROJO, score=1.0 | 20ms |
| "Joaquín Guzmán Loera" (acentos) | 🟥 ROJO, normalizó | 5ms |
| "Joaquin Guzman **Loerra**" (typo) | 🟥 ROJO, **FONÉTICO** 0.981 | 5ms |
| "Claudia Sheinbaum" (PEP) | 🟥 ROJO, 0.896 | 42ms |
| "Klaudia Sheinbaom" (doble typo) | 🟥 ROJO, 0.861 | 40ms |
| "Persona Inventada XYZ" | 🟩 VERDE, 0 matches | 3ms |

> 📸 **Momento clave:** El caso "Loerra" es la prueba de fuego. La búsqueda LIKE
> antigua habría fallado. El Double Metaphone lo capturó por fonética.

### Optimización de rendimiento
La búsqueda inicial sobre 39k registros en memoria tardaba ~1s. Se construyó un
**índice fonético SQL** que pre-filtra candidatos antes del matching fino.
Resultado: **de ~1,000ms a 3-69ms** (mejora de ~20x).

---

## 2. Candados de Captura Obligatoria

### ¿Qué es? (no-code)
El sistema exige cierta documentación del cliente según el monto. Si el cajero
no capturó lo requerido, **el sistema bloquea la operación automáticamente**.
No es una sugerencia — es un candado.

| Monto USD | Requiere |
|-----------|----------|
| < $1,000 | Nada (bajo umbral) |
| $1k–$3k | Identificación oficial |
| $3k–$5k | Identificación + comprobante de domicilio |
| ≥ $5,000 | Expediente completo + **clave de 9 caracteres (Nivel 5)** |

### Evidencia real de bloqueo
```
$5k sin datos          → permitido=false, faltantes=[ID, Domicilio, Expediente, ClaveN5]
$5k clave "ABC12" (5ch)→ permitido=false, "clave inválida (recibió 5)"
$5k completo + ABC123456→ permitido=true
$1.5k solo con ID      → permitido=true
```

La clave N5 de 9 caracteres reutiliza el `generatePasscode()` ya existente
(3 letras + 6 números).

---

## 3. Generador de PDF — Formato de Desviación

### ¿Qué es? (no-code)
Cuando el arqueo de un cajero no coincide con el libro mayor, el sistema genera
automáticamente un documento PDF profesional con el detalle de la discrepancia.
Este es el "Formato de Desviación" que el gerente firma al autorizar.

### Qué incluye el PDF
- Folio, fecha, cajero, turno, sucursal, terminal
- Aviso de "Arqueo Ciego" (por qué se generó)
- Tabla de diferencias por moneda (declarado vs esperado vs diferencia)
- Total equivalente MXN (rojo si negativo)
- Observaciones
- Bloque de autorización con firmas

### Evidencia real
```
PDF generado: 3,308 bytes, PDF v1.3, 2 páginas (validado con `file`)
```

**Stack:** `pdfkit` (backend). `jsPDF` ya estaba instalado para el frontend.

---

## 4. Motor de Reportes RIP Trimestrales

### ¿Qué es? (no-code)
RIP = Reporte de Información Periódica. Las casas de cambio deben reportar a la
autoridad cada 3 meses. El motor agrega las operaciones del trimestre y produce
el resumen listo para revisión/envío.

### Clasificación
- **RELEVANTES** — operaciones ≥ $7,500 USD
- **INUSUALES** — patrones sospechosos (de `reportes_aml`)
- **PREOCUPANTES** — relacionadas con el personal

### Evidencia real
```
2026-Q3 (julio → septiembre): 0 operaciones (tablas vacías — dato honesto)
Rango trimestral calculado correctamente: 2026-07-01 → 2026-09-30
```

> ⚠️ **Nota regulatoria honesta:** El formato exacto de envío (XML/XSD oficial)
> varía según la autoridad. Este motor produce el **agregado base**; la
> conversión al formato de envío definitivo es un paso posterior a validar con
> el sujeto obligado.

---

## 5. Arquitectura Dual (SQLite actual + Supabase futuro)

### SQLite (runtime actual)
Motor en TypeScript (`src/compliance/`):
- `fuzzyMatcher.ts` — normalización + Double Metaphone + Levenshtein
- `complianceService.ts` — búsqueda con índice fonético + candados
- `ofacLoader.ts` — parser de CSVs OFAC
- `pepSeedMexico.ts` — dataset semilla PEP
- `pepScraper.ts` — scraper (DESACTIVADO por defecto)
- `desviacionPdf.ts` — generador PDF
- `ripReporter.ts` — reportes RIP
- `listLoader.ts` — carga de listas + índice fonético

### Supabase (producción futura)
Esquema en `db/04_compliance_fuzzy_supabase.sql`:
- Extensiones `pg_trgm`, `fuzzystrmatch`, `unaccent`
- Tabla unificada `compliance_listas_riesgo` con trigger de normalización fonética
- Función `fn_buscar_listas_riesgo()` con matching nativo de PostgreSQL
- Tabla `compliance_umbrales_captura` con los candados

**Regla de oro respetada:** la inteligencia (fonética, umbrales) está definida
en la base de datos vía triggers/funciones, no hardcodeada en el frontend.

---

## 6. Decisión sobre el Scraper PEP México

Se implementó el enfoque **"Ambos"** acordado con el usuario:

1. ✅ **Dataset semilla** de 25 PEPs federales — cargado YA, motor funcional
2. ⏸️ **Scraper desactivado** — `pepScraper.ts` existe pero requiere
   `PEP_SCRAPER_ENABLED=true` y validación previa de la fuente oficial
   (Declaranet / Plataforma Nacional de Transparencia / SNA)

**Por qué desactivado:** scraping en vivo tiene riesgos legales (LFPDPPP,
términos de servicio) y de mantenimiento. Se prefiere dataset descargable >
API oficial > scraping HTML.

---

## 7. Verificación

```
npm run lint   ✅ PASS   tsc --noEmit sin errores
npm run build  ✅ PASS   2944 módulos, 10.03s
compliance.test.ts ✅ 25/25 tests PASS, 1.75s
```

### ⚠️ Hallazgo honesto (deuda preexistente, NO de la Fase 4)

La suite completa del proyecto reporta **16 tests fallidos**, pero estos
provienen de las Fases 1-3 y quedaron desincronizados cuando la Fase 2 migró
a JWT+bcrypt:

| Archivo | Estado | Causa |
|---------|--------|-------|
| `server.test.ts` | 7 failed / 11 passed | Login mock "123456" ya no existe (Fase 2) |
| `security.test.ts` | falla + EADDRINUSE | Rutas requieren JWT (Fase 2) |
| `frontend-integration.test.ts` | falla | Rutas requieren JWT (Fase 2) |
| **`compliance.test.ts`** | **25/25 PASS** | ✅ Fase 4 |

**Recomendación (para Fase 5):** Actualizar los tests de Fases 1-3 para usar
tokens JWT en lugar de usuarios mock. Esto está alineado con el objetivo de la
Fase 5 (Playwright E2E + CI/CD) que requiere una suite verde.

---

## 8. Archivos de la Fase 4

### Nuevos (código)
```
src/compliance/fuzzyMatcher.ts        → Motor de fuzzy matching fonético
src/compliance/complianceService.ts   → Búsqueda con índice + candados
src/compliance/ofacLoader.ts          → Parser/loader CSVs OFAC
src/compliance/pepSeedMexico.ts       → Dataset semilla PEP (25 federales)
src/compliance/pepScraper.ts          → Scraper desactivado
src/compliance/desviacionPdf.ts       → Generador PDF desviación
src/compliance/ripReporter.ts         → Reportes RIP trimestrales
src/compliance/listLoader.ts          → Carga listas + índice fonético
db/04_compliance_fuzzy_supabase.sql   → Esquema Supabase (pg_trgm + dmetaphone)
compliance.test.ts                    → 25 tests unitarios
```

### Modificados
```
server.ts  → Nuevos endpoints de compliance + búsqueda fuzzy reemplaza LIKE
package.json → pdfkit, natural, fast-levenshtein + @types
```

### Dependencias nuevas
```
natural (Double Metaphone), fast-levenshtein, pdfkit
```

---

## 9. Endpoints nuevos de la Fase 4

```
GET  /api/compliance/search-lists?q=<nombre>&umbral=0.55
     → Fuzzy matching contra OFAC/PEP/CNBV/SAT con score y nivel

GET  /api/compliance/requisitos-captura?monto_usd=5000
     → Devuelve qué documentación exige el monto

POST /api/compliance/validar-captura
     → {monto_usd, tiene_id, tiene_domicilio, tiene_expediente, clave_n5}
     → Devuelve permitido + faltantes (el CANDADO)

POST /api/compliance/formato-desviacion-pdf
     → Genera PDF del Formato de Desviación

GET  /api/compliance/reporte-rip?anio=2026&trimestre=3&formato=json|csv
     → Reporte RIP trimestral
```

---

## 10. Resumen Ejecutivo

**SICC ahora tiene un motor de cumplimiento independiente y funcional:**

1. 🎯 **Fuzzy matching fonético** — 39,366 registros OFAC reales + PEP México,
   detecta typos y variaciones fonéticas en 3-69ms
2. 🔒 **Candados de captura** — bloqueo automático a $1k/$3k/$5k con clave Nivel 5
3. 📄 **PDF de desviación** — documento profesional generado automáticamente
4. 📊 **Reportes RIP** — agregado trimestral listo para revisión
5. 🏗️ **Arquitectura dual** — SQLite hoy, Supabase (pg_trgm) mañana, misma lógica

**Pendiente para producción:**
- Validar fuente oficial del scraper PEP antes de activarlo
- Validar formato XML/XSD de envío RIP con la autoridad
- Actualizar tests de Fases 1-3 (desincronizados por JWT) — se aborda en Fase 5

**Fase 4 completada.** Listo para Fase 5 (Aseguramiento de Calidad y E2E). 🚀
