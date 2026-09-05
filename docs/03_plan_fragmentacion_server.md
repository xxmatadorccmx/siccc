# Plan de Fragmentación para `server.ts`

## Objetivo
Dividir `server.ts` (4,659 líneas) en controladores modulares.

## División Propuesta
1. **/auth:**
    - Login (`POST /api/auth/login`)
    - Perfil (`GET /api/auth/profile`)
    - Registro de usuarios (`POST /api/auth/users`)
2. **/fx:**
    - FX Rates Live (`GET /api/rates/live`)
    - Fund Wallet (`POST /api/fxtrader/fund-wallet`)
    - Wallet Operations (`GET /api/wallet/:id`)
3. **/liquidity:**
    - Dotaciones (`POST /api/liquidity/dotaciones`)
    - Seguridad (`GET /api/security-thresholds`)
    - Terminales (`POST /api/terminal/status`)
4. **/compliance:**
    - AML/KYC (`GET /api/kyc/search`)
    - Listas PEP/OFAC (`GET /api/compliance/lists`)

## Implementación

1. Crear carpetas bajo `src/controllers/`:
    ```
    src/controllers/auth/
    src/controllers/fx/
    src/controllers/liquidity/
    src/controllers/compliance/
    ```

2. Separar rutas en módulos:
    **Ejemplo:** `/auth/login`

    **Archivo:** `src/controllers/auth/login.ts`
    ```ts
    import { Router } from 'express';
    const router = Router();

    router.post('/login', async (req, res) => {
        const { username, password } = req.body;
        // Lógica existente...
        res.json({ status: 'success', token: 'mock' });
    });

    export default router;
    ```

3. Crear un único punto de entrada: `src/routes.ts`:
    ```ts
    import express from 'express';
    import authRoutes from './controllers/auth';

    const app = express();
    app.use('/api/auth', authRoutes);
    // Importar los demás controladores...

    export default app;
    ```

4. Modificar `server.ts`:
    ```ts
    import app from './src/routes';

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor escuchando en puerto ${PORT}`);
    });
    ```

**Tiempo estimado para migración:** ~3 días de desarrollo, revisión y testing.
---

## Resultados Esperados
- Módulo Auth (300 líneas)
- Módulo FX (400 líneas)
- Módulo Liquidity (500 líneas)
- Módulo Compliance (600 líneas)
- `server.ts` reducido de 4,659 a ~300 líneas.