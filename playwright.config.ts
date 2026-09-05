import { defineConfig, devices } from '@playwright/test';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Configuración Playwright (Fase 5: Tests E2E)
 * ═══════════════════════════════════════════════════════════════════════════
 * Levanta el servidor de desarrollo automáticamente (webServer) y ejecuta los
 * tests E2E contra http://localhost:3000.
 *
 * Uso:
 *   npx playwright install chromium   # solo la primera vez (descarga navegador)
 *   npx playwright test               # ejecuta la suite E2E
 * ═══════════════════════════════════════════════════════════════════════════
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // un solo worker: el flujo de caja es secuencial y comparte estado de turno
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // El servidor de desarrollo sirve el frontend en el puerto 3000
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // FIX P0 #3 (auditoria 20260903): antes reuseExistingServer reusaba el server
  // de desarrollo con la DB real parcheada a mano -> los E2E "pasaban" sin
  // probar una instalacion limpia. Ahora el webServer SIEMPRE usa una DB
  // temporal fresca (DB_PATH), lo que valida: seed + migraciones + login
  // desde cero en cada corrida de E2E.
  webServer: {
    command: process.platform === 'win32'
      ? 'set DB_PATH=e2e_test_db.tmp.sqlite&& npm run dev'
      : 'DB_PATH=e2e_test_db.tmp.sqlite npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
