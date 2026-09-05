import express from "express";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import helmet from 'helmet';

import { authenticateToken, requireRole, AuthenticatedRequest, hashPassword } from './src/middleware/auth';
import { generalRateLimit, loginRateLimit, accountLockout } from './src/middleware/security';
import { login, getProfile, changePassword, logout, loginValidation, passwordChangeValidation } from './src/controllers/auth';

import clearingRoutes from "./src/microservices/clearing-house/routes/clearing.ts";
import db from "./src/db/database.ts";

// --- MOTOR DE CUMPLIMIENTO INDEPENDIENTE (Fase 4) ---
import {
  buscarEnListas,
  requisitosCapturaPorMonto,
  validarCandadoCaptura,
} from './src/compliance/complianceService.ts';
import { generarFormatoDesviacionPDF } from './src/compliance/desviacionPdf.ts';
import { generarReporteRip, reporteRipACsv } from './src/compliance/ripReporter.ts';

// --- MOTOR PEPS/FIFO extraído (Fase 5) — testable de forma aislada ---
import { ejecutarFIFO, calcularFIFO } from './src/db/fifo.ts';



// 🩹 MIGRATION: Fix the trigger that was created with wrong column name 'created_at' instead of 'date'
try {
  db.exec(`DROP TRIGGER IF EXISTS tr_caja_dotaciones_aplicar`);
  db.exec(`
    CREATE TRIGGER tr_caja_dotaciones_aplicar
    AFTER UPDATE OF estatus ON caja_dotaciones
    WHEN NEW.estatus = 'APLICADO' AND OLD.estatus = 'PENDIENTE'
    BEGIN
      -- Incrementar el saldo_actual_mxn en cajas
      INSERT INTO cajas (cajero_id, saldo_actual_mxn, last_update)
      VALUES (NEW.cajero_id, NEW.monto_mxn, CURRENT_TIMESTAMP)
      ON CONFLICT(cajero_id) DO UPDATE SET
        saldo_actual_mxn = saldo_actual_mxn + NEW.monto_mxn,
        last_update = CURRENT_TIMESTAMP;

      -- Generar asientos en Accounting_Journal
      INSERT INTO Accounting_Journal (transaction_id, account_code, description, debit, credit, date)
      VALUES (
        'DOT-' || NEW.id,
        '1001',
        'CARGO por dotacion ' || NEW.tipo_dotacion || ' - Ref: ' || NEW.id,
        NEW.monto_mxn,
        0,
        CURRENT_TIMESTAMP
      );

      INSERT INTO Accounting_Journal (transaction_id, account_code, description, debit, credit, date)
      VALUES (
        'DOT-' || NEW.id,
        '1000',
        'ABONO por dotacion ' || NEW.tipo_dotacion || ' - Ref: ' || NEW.id,
        0,
        NEW.monto_mxn,
        CURRENT_TIMESTAMP
      );

      -- Actualizar balances de cuentas
      UPDATE Accounting_Accounts SET balance = balance + NEW.monto_mxn WHERE account_code = '1001';
      UPDATE Accounting_Accounts SET balance = balance - NEW.monto_mxn WHERE account_code = '1000';
    END;
  `);
  console.log("[Migration] Applied: Fixed trigger tr_caja_dotaciones_aplicar (created_at → date)");
} catch (e) {
  console.error("[Migration] Failed to fix trigger:", e);
}

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

console.log("Server.ts starting up...");
dotenv.config();

export async function createApp() {
  const app = express();

  // Middlewares de seguridad
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Needed for Vite dev
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
    crossOriginEmbedderPolicy: false, // Needed for Vite
  }));
  
  app.use(generalRateLimit);
  app.use(express.json({ limit: '10mb' }));

  // --- API Gateway / Microservices Routes ---
  
  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "BaaS API Gateway" });
  });

  // --- Redis Cache Simulation (In-Memory for MVP) ---
  let redisRates = {
    USD_MXN: { buy: 18.45, sell: 19.55, timestamp: new Date().toISOString() },
    EUR_MXN: { buy: 20.10, sell: 21.30, timestamp: new Date().toISOString() },
    GBP_MXN: { buy: 23.45, sell: 24.80, timestamp: new Date().toISOString() },
    CAD_MXN: { buy: 13.60, sell: 14.45, timestamp: new Date().toISOString() },
    USDT_MXN: { buy: 17.05, sell: 17.10, timestamp: new Date().toISOString() },
    MXN_MXN: { buy: 1.00, sell: 1.00, timestamp: new Date().toISOString() }, // Pivot
  };

  // Simulated Configuration (Markup)
  let systemConfig = {
    transactionalPercentage: 1.5, // 1.5% Markup
  };

  // Módulo 2: Cámara de Compensación (Clearing House)
  app.use("/api/clearing-house", clearingRoutes);

  // Mock ODBC Adapter for SOFTExchange (MySQL 5.1)
  app.get("/api/legacy/balances", (req, res) => {
    // Saldos reales desde SQLite — devuelve 0 en primera sesión
    try {
      const boveda = db.prepare('SELECT currency, balance FROM Boveda').all() as any[];
      const balances = boveda.map(b => ({
        currency: b.currency,
        balance: b.balance || 0,
        rate: redisRates[`${b.currency}_MXN`]?.buy || 1
      }));
      res.json({
        status: "success",
        source: "SQLite Local",
        data: balances
      });
    } catch (e) {
      res.json({ status: "success", source: "SQLite Local", data: [] });
    }
  });

  // Real-Time Rates Endpoint (Consumes Redis Cache)
  app.get("/api/rates/live", (req, res) => {
    res.json({
      status: "success",
      source: "Redis Cache (Real-Time)",
      rates: redisRates
    });
  });

  // Update Rates Endpoint (Saves to Redis Cache)
  app.post("/api/rates/update", (req, res) => {
    const { rates } = req.body; // Expecting { USD: { buy, sell }, EUR: { buy, sell } }
    
    if (!rates) {
      return res.status(400).json({ status: "error", message: "No rates provided" });
    }

    // Update the "Redis" store
    Object.keys(rates).forEach(code => {
      const pair = `${code}_MXN`;
      redisRates[pair] = {
        buy: rates[code].buy,
        sell: rates[code].sell,
        timestamp: new Date().toISOString()
      };
    });

    console.log("[REDIS] Rates updated successfully:", redisRates);
    
    res.json({
      status: "success",
      message: "Rates updated in Redis cache"
    });
  });

  // Mock PostgreSQL Core ERP Transactions
  const getTransactions = (req, res) => {
    try {
      const transactions = db.prepare(`
        SELECT id, 'IN' as type,
               currency_in, amount_in, method_in,
               currency_out, amount_out, method_out,
               rate, markup,
               status, settlement_status, branch_id, customer_id,
               client_name as client, created_at as date,
               transfer_bank_name, transfer_account_number, transfer_payer_name,
               transfer_date, transfer_tracking_id, transfer_txid
        FROM Operaciones_Captacion
        UNION ALL
        SELECT id, 'OUT' as type,
               currency_in, amount_in, method_in,
               currency_out, amount_out, method_out,
               rate, markup,
               status, settlement_status, branch_id, customer_id,
               client_name as client, created_at as date,
               transfer_bank_name, transfer_account_number, transfer_payer_name,
               transfer_date, transfer_tracking_id, transfer_txid
        FROM Operaciones_Liquidacion_P2P
        ORDER BY date DESC
        LIMIT 50
      `).all();

      res.json({
        status: "success",
        source: "PostgreSQL Core ERP (Simulated)",
        transactions
      });
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ status: "error", message: "Internal server error" });
    }
  };

  app.get("/api/transactions/recent", getTransactions);
  app.get("/api/transacciones", getTransactions);

  // --- KYC / Customer Management Endpoints ---

  // Middleware for Role-Based Access Control
  const checkRole = (allowedRoles: string[]) => {
    return (req: any, res: any, next: any) => {
      const userRole = req.headers['x-user-role'] || 'cashier'; // Default to cashier for demo
      if (allowedRoles.includes(userRole)) {
        next();
      } else {
        res.status(403).json({ 
          status: "error", 
          message: "Acceso denegado: Se requiere perfil administrativo para esta acción." 
        });
      }
    };
  };

  // --- BaaS Domain Service ---
  const BaaSService = {
    addFunds: (customerId: string, amount: number, currency: string) => {
      const balanceField = `balance_${currency.toLowerCase()}`;
      
      // Check if wallet exists
      const wallet = db.prepare('SELECT id FROM Wallets WHERE customer_id = ?').get(customerId);
      if (!wallet) {
        throw new Error(`No se encontró billetera digital para el cliente ${customerId}`);
      }

      // Update balance
      const stmt = db.prepare(`
        UPDATE Wallets 
        SET ${balanceField} = ${balanceField} + ? 
        WHERE customer_id = ?
      `);
      const result = stmt.run(amount, customerId);
      
      if (result.changes === 0) {
        throw new Error("Error al actualizar el saldo de la billetera");
      }

      // Get new balance
      return db.prepare('SELECT balance_mxn, balance_usd, balance_usdt FROM Wallets WHERE customer_id = ?').get(customerId);
    }
  };

  // --- FX Trader: Fund Wallet (VIP Integration) ---
  app.post("/api/fxtrader/fund-wallet", (req, res) => {
    const { 
      customerId, 
      clientName,
      currency, 
      amount, 
      method,
      rate,
      markup,
      ticketId 
    } = req.body;

    if (!customerId || !amount || !currency) {
      return res.status(400).json({ status: "error", message: "Datos incompletos para el fondeo" });
    }

    // ACID Transaction
    const executeFondeo = db.transaction((data) => {
      const { customerId, clientName, currency, amount, method, rate, markup, ticketId } = data;

      // 1. Insert into ERP/Accounting (Operaciones_Captacion)
      const captacionId = `CAP-${Math.floor(100000 + Math.random() * 900000)}`;
      db.prepare(`
        INSERT INTO Operaciones_Captacion (
          id, customer_id, client_name, currency_in, amount_in, method_in, 
          currency_out, amount_out, method_out, rate, markup, 
          status, settlement_status, branch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        captacionId,
        customerId,
        clientName,
        currency,
        amount,
        method,
        currency, // Out is same as in for wallet funding
        amount,
        'WALLET_BAAS', // Destination is the BaaS Wallet
        rate || 1,
        markup || 0,
        'COMPLETED',
        currency === 'MXN' ? 'N/A' : 'PENDING',
        'MAIN_BRANCH'
      );

      // 2. Update BaaS Wallet via Service
      const newBalances = BaaSService.addFunds(customerId, amount, currency);

      return {
        captacionId,
        newBalances: {
          MXN: newBalances.balance_mxn,
          USD: newBalances.balance_usd,
          USDT: newBalances.balance_usdt
        }
      };
    });

    try {
      const result = executeFondeo({ customerId, clientName, currency, amount, method, rate, markup, ticketId });
      
      console.log(`[FX->BaaS] Wallet Funded: ${customerId} | +${amount} ${currency}`);

      res.json({
        status: "success",
        message: "Fondeo de billetera exitoso y registrado en contabilidad",
        data: {
          transactionId: result.captacionId,
          newBalance: result.newBalances
        }
      });
    } catch (error: any) {
      console.error("Error in fund-wallet transaction:", error);
      res.status(500).json({ 
        status: "error", 
        message: error.message || "Error interno al procesar el fondeo" 
      });
    }
  });

  // Search Customers (Smart Search)
  app.get("/api/kyc/search", (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ status: "success", data: [] });

    try {
      const customers = db.prepare(`
        SELECT c.*, w.balance_mxn, w.balance_usd, w.balance_usdt, w.id as wallet_id
        FROM Customers c
        LEFT JOIN Wallets w ON c.id = w.customer_id
        WHERE c.full_name LIKE ? OR c.id LIKE ? OR c.email LIKE ?
        LIMIT 10
      `).all(`%${q}%`, `%${q}%`, `%${q}%`);

      const formattedCustomers = customers.map((c: any) => ({
        ...c,
        isVIP: c.is_vip === 1,
        isB2B: c.is_b2b === 1,
        walletBalance: {
          MXN: c.balance_mxn || 0,
          USD: c.balance_usd || 0,
          USDT: c.balance_usdt || 0
        }
      }));

      res.json({ status: "success", data: formattedCustomers });
    } catch (error) {
      console.error("Error searching customers:", error);
      res.status(500).json({ status: "error", message: "Database error" });
    }
  });

  // Quick Register Customer (Cashier Level - Standard Only)
  // --- Denominations API ---
  app.get("/api/config/denominations/:currency", (req, res) => {
    const { currency } = req.params;
    
    // Static config for denominations per currency
    const denomsMap: Record<string, number[]> = {
      'USD': [1, 2, 5, 10, 20, 50, 100],
      'MXN': [2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5],
      'EUR': [5, 10, 20, 50, 100, 200, 500],
      'GBP': [5, 10, 20, 50],
      'BRL': [2, 5, 10, 20, 50, 100, 200],
      'CAD': [5, 10, 20, 50, 100]
    };

    const denoms = denomsMap[currency.toUpperCase()] || [100, 50, 20, 10, 5, 1];
    
    // Return structured as expected by frontend
    res.json({
      status: "success",
      data: denoms.map(value => ({ 
        denominacion: value, 
        type: value >= 20 ? 'BILL' : 'COIN',
        label: `${value}` 
      }))
    });
  });

  // KYC Validation function to block registration on compliance gaps
  function validateKYC(body: any, files: any) {
    const { clientType } = body;
    if (!clientType || (clientType !== 'PHYSICAL' && clientType !== 'MORAL')) {
      return "El tipo de cliente (clientType) es obligatorio y debe ser PHYSICAL o MORAL.";
    }

    if (clientType === 'PHYSICAL') {
      if (!body.firstName || !body.lastName) {
        return "El nombre y apellidos son campos obligatorios para Persona Física.";
      }
      if (!body.rfcCurp) {
        return "El RFC o CURP es un campo obligatorio para Persona Física.";
      }
      const hasOfficialId = files && files['officialIdFile'] && files['officialIdFile'][0];
      if (!hasOfficialId) {
        return "La carga de la Identificación Oficial (KYC) es obligatoria para Persona Física.";
      }
    } else if (clientType === 'MORAL') {
      if (!body.razonSocial) {
        return "La Razón Social (sin abreviaturas) es obligatoria para Persona Moral.";
      }
      if (!body.companyRfc) {
        return "El RFC de la empresa es obligatorio para Persona Moral.";
      }
      if (!body.businessLine) {
        return "El Giro del Negocio / Actividad Comercial es obligatorio para Persona Moral.";
      }
      if (!body.legalRepName) {
        return "El nombre del Representante Legal es obligatorio para Persona Moral.";
      }
      if (!body.legalRepId) {
        return "La identificación del Representante Legal es obligatoria para Persona Moral.";
      }
      const hasActa = files && files['actaConstitutivaFile'] && files['actaConstitutivaFile'][0];
      const hasComprobante = files && files['comprobanteDomicilioFile'] && files['comprobanteDomicilioFile'][0];
      if (!hasActa) {
        return "La carga del Acta Constitutiva es obligatoria para Persona Moral.";
      }
      if (!hasComprobante) {
        return "El Comprobante de Domicilio Fiscal es obligatorio para Persona Moral.";
      }
    }
    return null;
  }

  // Get all clients list
  app.get("/api/kyc/clients", (req, res) => {
    try {
      const clients = db.prepare(`
        SELECT c.*, w.balance_mxn, w.balance_usd, w.balance_usdt
        FROM Customers c
        LEFT JOIN Wallets w ON c.id = w.customer_id
        ORDER BY c.created_at DESC
      `).all();
      
      const formatted = clients.map((c: any) => ({
        ...c,
        isVIP: c.is_vip === 1,
        isB2B: c.is_b2b === 1,
        walletBalance: {
          MXN: c.balance_mxn || 0,
          USD: c.balance_usd || 0,
          USDT: c.balance_usdt || 0
        }
      }));

      res.json({ status: "success", data: formatted });
    } catch (error) {
      console.error("Error fetching clients list:", error);
      res.status(500).json({ status: "error", message: "Error al obtener la lista de clientes." });
    }
  });

  // Refactored Quick Register with dual physical/moral persona selection and KYC verification
  app.post("/api/kyc/quick-register", upload.fields([
    { name: 'officialIdFile', maxCount: 1 },
    { name: 'actaConstitutivaFile', maxCount: 1 },
    { name: 'comprobanteDomicilioFile', maxCount: 1 }
  ]), (req, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    
    // Validate KYC before database entry
    const validationError = validateKYC(req.body, files);
    if (validationError) {
      console.warn(`[KYC Blocked] Registration rejected: ${validationError}`);
      return res.status(400).json({ status: "error", message: validationError });
    }

    const { 
      clientType,
      firstName,
      lastName,
      rfcCurp,
      razonSocial,
      companyRfc,
      businessLine,
      legalRepName,
      legalRepId,
      isB2b,
      email, 
      phone, 
      estimatedMonthlyAmount, 
      estimatedOperations, 
      sourceDestinationFunds 
    } = req.body;

    const isB2bFlag = isB2b === 'true' || isB2b === true ? 1 : 0;
    const fullName = clientType === 'PHYSICAL' ? `${firstName} ${lastName}` : razonSocial;

    try {
      const customerId = `CUST-${Math.floor(100000 + Math.random() * 900000)}`;
      
      // Determine document URLs
      const officialIdUrl = files?.officialIdFile?.[0] ? `/uploads/${files.officialIdFile[0].filename}` : null;
      const actaConstitutivaUrl = files?.actaConstitutivaFile?.[0] ? `/uploads/${files.actaConstitutivaFile[0].filename}` : null;
      const comprobanteDomicilioUrl = files?.comprobanteDomicilioFile?.[0] ? `/uploads/${files.comprobanteDomicilioFile[0].filename}` : null;

      // 1. Save to PostgreSQL (SQLite)
      db.prepare(`
        INSERT INTO Customers (
          id, full_name, email, phone, is_vip,
          client_type, first_name, last_name, rfc_curp, official_id_url,
          razon_social, company_rfc, business_line, legal_rep_name, legal_rep_id,
          is_b2b, acta_constitutiva_url, comprobante_domicilio_url,
          estimated_monthly_amount, 
          estimated_operations_per_month, 
          source_destination_funds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        customerId, 
        fullName, 
        email || null, 
        phone || null, 
        0, // Always 0 initially
        clientType,
        firstName || null,
        lastName || null,
        rfcCurp || null,
        officialIdUrl,
        razonSocial || null,
        companyRfc || null,
        businessLine || null,
        legalRepName || null,
        legalRepId || null,
        isB2bFlag,
        actaConstitutivaUrl,
        comprobanteDomicilioUrl,
        estimatedMonthlyAmount ? parseInt(estimatedMonthlyAmount) : 0, 
        estimatedOperations ? parseInt(estimatedOperations) : 0, 
        sourceDestinationFunds || null
      );

      // Create a Wallet for the customer
      db.prepare(`
        INSERT INTO Wallets (customer_id, balance_mxn, balance_usd, balance_usdt)
        VALUES (?, 0, 0, 0)
      `).run(customerId);

      // 2. Save to Compliance Table
      db.prepare(`
        INSERT INTO Compliance_Expedientes (customer_id, risk_score, verified)
        VALUES (?, ?, ?)
      `).run(customerId, 'LOW', 1); // Mark as verified since files were provided and checked

      console.log(`[KYC] Quick Register: ${customerId} | ${fullName} (${clientType})`);

      res.json({
        status: "success",
        message: "Customer registered successfully",
        customer: {
          id: customerId,
          full_name: fullName,
          client_type: clientType,
          risk_level: 'LOW',
          isVIP: false,
          isB2B: isB2bFlag === 1,
          walletBalance: { MXN: 0, USD: 0, USDT: 0 }
        }
      });
    } catch (error) {
      console.error("Error registering customer:", error);
      res.status(500).json({ status: "error", message: "Database error" });
    }
  });

  // ═══════════════════════════════════════════
  // 🔒 AUTENTICACIÓN SEGURA - JWT + BCRYPT
  // ═══════════════════════════════════════════
  
  // Login con rate limiting y bloqueo de cuentas
  app.post('/api/auth/login', loginRateLimit, accountLockout, loginValidation, login);
  
  // Perfil del usuario autenticado
  app.get('/api/auth/profile', authenticateToken, getProfile);
  
  // Cambio de contraseña
  app.patch('/api/auth/password', authenticateToken, passwordChangeValidation, changePassword);
  
  // Logout
  app.post('/api/auth/logout', authenticateToken, logout);

  app.post('/api/auth/users', async (req, res) => {
    const { nickname, puesto, branch_id, hire_date, role_level, password } = req.body;
    try {
      const authUserId = `user_${nickname.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
      const defaultPermissions = JSON.stringify({
        tc_limit: 2.5,
        can_cancel: false,
        show_vault_balance: false
      });

      // FIX 2026-09-05: el alta NO generaba password_hash → el usuario no podía
      // loguear (login exige password_hash IS NOT NULL y verifyPassword usa bcrypt).
      // Ahora: se usa la contraseña proporcionada por el admin, o una temporal
      // generada, SIEMPRE hasheada con bcrypt (nunca SHA-256).
      const tempPassword = password && String(password).trim().length >= 4
        ? String(password).trim()
        : `SICC${Math.floor(1000 + Math.random() * 9000)}`;
      const passwordHash = await hashPassword(tempPassword);

      const result = db.prepare(`
        INSERT INTO User_Profiles (auth_user_id, nickname, puesto, branch_id, hire_date, role_level, custom_permissions, password_hash, force_password_change)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        authUserId,
        nickname,
        puesto,
        branch_id,
        hire_date,
        role_level || 2,
        defaultPermissions,
        passwordHash,
        1 // forzar cambio de contraseña en primer inicio
      );

      // Crear caja para el nuevo cajero (saldo inicial 0)
      try {
        db.prepare('INSERT OR IGNORE INTO cajas (cajero_id, saldo_actual_mxn, sucursal_id) VALUES (?, 0, ?)')
          .run(authUserId, branch_id || 'MAIN_BRANCH');
      } catch (e) {}

      res.status(201).json({
        id: result.lastInsertRowid,
        auth_user_id: authUserId,
        temp_password: tempPassword,
        message: 'Usuario creado correctamente. Credenciales generadas (visibles una sola vez).'
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- GESTIÓN DE USUARIOS DESDE PANEL ADMINISTRADOR ---
  // Listar todos los usuarios (sin exponer hash)
  app.get('/api/auth/users', authenticateToken, requireRole(5), (req: AuthenticatedRequest, res) => {
    try {
      const users = db.prepare(`
        SELECT auth_user_id, nickname, puesto, role_level, branch_id, is_active,
               force_password_change, created_at, last_login
        FROM User_Profiles
        ORDER BY created_at DESC
      `).all();
      res.json({ status: 'success', data: users });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Resetear contraseña de un usuario (admin Nivel 5)
  app.post('/api/auth/users/reset-password', authenticateToken, requireRole(5), async (req: AuthenticatedRequest, res) => {
    const { auth_user_id, new_password } = req.body;
    if (!auth_user_id) {
      return res.status(400).json({ error: 'Se requiere auth_user_id' });
    }
    try {
      const newPass = new_password && String(new_password).trim().length >= 4
        ? String(new_password).trim()
        : `SICC${Math.floor(1000 + Math.random() * 9000)}`;
      const passwordHash = await hashPassword(newPass);

      const result = db.prepare(`
        UPDATE User_Profiles
        SET password_hash = ?, force_password_change = 1, locked_until = NULL, failed_login_attempts = 0
        WHERE auth_user_id = ?
      `).run(passwordHash, auth_user_id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      res.json({
        status: 'success',
        auth_user_id,
        new_password: newPass,
        message: 'Contraseña restablecida correctamente'
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Dar de baja / reactivar usuario (admin Nivel 5)
  app.post('/api/auth/users/toggle-active', authenticateToken, requireRole(5), (req: AuthenticatedRequest, res) => {
    const { auth_user_id, is_active } = req.body;
    if (!auth_user_id) {
      return res.status(400).json({ error: 'Se requiere auth_user_id' });
    }
    try {
      const result = db.prepare('UPDATE User_Profiles SET is_active = ? WHERE auth_user_id = ?')
        .run(is_active ? 1 : 0, auth_user_id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      res.json({
        status: 'success',
        auth_user_id,
        is_active: is_active ? 1 : 0,
        message: is_active ? 'Usuario reactivado' : 'Usuario dado de baja'
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- MÓDULO DE APERTURA Y CONTROL DE TURNOS (Shift Control API) ---
  app.get('/api/shifts/status', authenticateToken, (req: AuthenticatedRequest, res) => {
    const userId = req.user?.auth_user_id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }
    
    try {
      const shift = db.prepare('SELECT * FROM shift_logs WHERE cajero_id = ? ORDER BY id DESC LIMIT 1').get(userId) as any;
      if (shift) {
        shift.saldo_declarado_json = JSON.parse(shift.saldo_declarado_json || '{}');
        shift.saldo_esperado_json = JSON.parse(shift.saldo_esperado_json || '{}');
        shift.desviaciones_json = JSON.parse(shift.desviaciones_json || 'null');
      }
      res.json({ shift: shift || null });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/shifts/pending-authorizations', authenticateToken, requireRole(3), (req: AuthenticatedRequest, res) => {
    try {
      const shifts = db.prepare("SELECT * FROM shift_logs WHERE status = 'PENDING_AUTHORIZATION' ORDER BY id DESC").all() as any[];
      shifts.forEach(shift => {
        shift.saldo_declarado_json = JSON.parse(shift.saldo_declarado_json || '{}');
        shift.saldo_esperado_json = JSON.parse(shift.saldo_esperado_json || '{}');
        shift.desviaciones_json = JSON.parse(shift.desviaciones_json || 'null');
      });
      res.json({ shifts });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/shifts/open', authenticateToken, requireRole(2), (req: AuthenticatedRequest, res) => {
    const userId = req.user?.auth_user_id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }
    
    const { counts } = req.body; // e.g., { MXN: { "500": 10, ... }, USD: { "100": 5 } }
    
    try {
      // 1. Get user profile and inherited caja balance
      const profile = db.prepare('SELECT nickname FROM User_Profiles WHERE auth_user_id = ?').get(userId) as any;
      const nickname = profile ? profile.nickname : 'Cajero';

      const caja = db.prepare('SELECT saldo_actual_mxn FROM cajas WHERE cajero_id = ?').get(userId) as any;
      const inheritedBalance = caja ? (caja.saldo_actual_mxn || 0) : 0;

      // 2. Calculate declared total from blind count (MXN only for now)
      const declaredMap: Record<string, Record<string, number>> = counts || {};
      let declaredTotalMXN = 0;
      
      Object.keys(declaredMap).forEach(curr => {
        const currCounts = declaredMap[curr] || {};
        Object.keys(currCounts).forEach(denom => {
          declaredTotalMXN += (Number(denom) * Number(currCounts[denom] || 0));
        });
      });

      // 3. Compare declared vs inherited balance
      const diff = declaredTotalMXN - inheritedBalance;
      const hasDeviation = Math.abs(diff) > 0.01;

      // Build expected map from inherited balance (simplified as single MXN total)
      const expectedMap: Record<string, Record<string, number>> = {
        MXN: { [String(inheritedBalance)]: 1 }
      };
      
      const deviations: Record<string, any> = {};
      deviations['MXN'] = {
        declared: declaredTotalMXN,
        expected: inheritedBalance,
        diff: diff,
        valueDiff: diff
      };

      // 4. Generate folio document
      const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
      const randHex = Math.floor(1000 + Math.random() * 9000);
      const folio = `FOLIO-AP-${dateStr}-${randHex}`;

      const status = hasDeviation ? 'PENDING_AUTHORIZATION' : 'OPEN';

      // 5. Save shift log
      const insert = db.prepare(`
        INSERT INTO shift_logs (cajero_id, nickname, saldo_declarado_json, saldo_esperado_json, desviaciones_json, status, folio_documento)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = insert.run(
        userId,
        nickname,
        JSON.stringify(declaredMap),
        JSON.stringify(expectedMap),
        JSON.stringify(deviations),
        status,
        folio
      );

      res.status(201).json({
        id: result.lastInsertRowid,
        cajero_id: userId,
        nickname,
        status,
        folio_documento: folio,
        hasDeviation,
        deviations,
        inherited_balance: inheritedBalance,
        declared_total: declaredTotalMXN
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/shifts/authorize', authenticateToken, requireRole(4), (req: AuthenticatedRequest, res) => {
    const managerId = req.user?.auth_user_id || req.user?.id;
    if (!managerId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }
    
    const { shift_id } = req.body;

    try {
      // 1. Authorization is already verified by requireRole(4) middleware
      
      // 2. Fetch shift details
      const shift = db.prepare('SELECT * FROM shift_logs WHERE id = ?').get(shift_id) as any;
      if (!shift) {
        return res.status(404).json({ error: 'Turno no encontrado.' });
      }

      if (shift.status !== 'PENDING_AUTHORIZATION') {
        return res.status(400).json({ error: 'El turno no requiere autorización o ya fue procesado.' });
      }

      const declaredMap = JSON.parse(shift.saldo_declarado_json || '{}');
      const deviations = JSON.parse(shift.desviaciones_json || '{}');

      // 3. Update shift status to OPEN
      db.prepare(`
        UPDATE shift_logs 
        SET status = 'OPEN', authorized_by = ?, authorization_date = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(req.user?.nickname || req.user?.auth_user_id || 'Gerente', shift_id);

      // 4. Trigger Contable & Inventory Alignment
      // Align vault bill-by-bill counts in Inventario_Boveda_Detalle to match declared physical count
      const updateInv = db.prepare(`
        INSERT INTO Inventario_Boveda_Detalle (branch_id, currency, denominacion, quantity, last_update)
        VALUES ('MAIN_BRANCH', ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(branch_id, currency, denominacion) 
        DO UPDATE SET quantity = excluded.quantity, last_update = CURRENT_TIMESTAMP
      `);

      // First reset all current database quantities to 0 for denominations not counted,
      // and set to the counted values for those that are counted.
      let totalDeviationMxnValue = 0;

      Object.keys(declaredMap).forEach(curr => {
        const denomsOfCurr = declaredMap[curr];
        let currencyDeclaredTotalValue = 0;

        Object.keys(denomsOfCurr).forEach(denomStr => {
          const denom = Number(denomStr);
          const qty = Number(denomsOfCurr[denomStr] || 0);
          currencyDeclaredTotalValue += (denom * qty);
          updateInv.run(curr, denom, qty);
        });

        // Update overall Boveda balance to match declared total
        db.prepare('UPDATE Boveda SET balance = ?, last_update = CURRENT_TIMESTAMP WHERE currency = ?')
          .run(currencyDeclaredTotalValue, curr);

        // Calculate MXN value of deviation for this currency
        const devInfo = deviations[curr];
        if (devInfo) {
          totalDeviationMxnValue += (devInfo.valueDiff || 0);
        }
      });

      // 5. Record automatic Accounting Adjustment Entry (Trigger Contable)
      if (Math.abs(totalDeviationMxnValue) > 0.01) {
        const txId = `ADJUST-SH-${shift.folio_documento}`;
        const desc = `Ajuste contable por desviación autorizada en apertura. Folio: ${shift.folio_documento}`;
        
        if (totalDeviationMxnValue > 0) {
          // Cash surplus (Sobrante de caja): Debit 1101 (Caja/Bóveda), Credit 4102 (Ingreso por Ajuste)
          recordJournalEntry(txId, desc, [
            { account: '1101', debit: totalDeviationMxnValue, credit: 0 },
            { account: '4102', debit: 0, credit: totalDeviationMxnValue }
          ]);
        } else {
          // Cash deficit (Faltante de caja): Debit 5201 (Pérdidas por Ajuste/Revaluación), Credit 1101 (Caja/Bóveda)
          const absVal = Math.abs(totalDeviationMxnValue);
          recordJournalEntry(txId, desc, [
            { account: '5201', debit: absVal, credit: 0 },
            { account: '1101', debit: 0, credit: absVal }
          ]);
        }
      }

      res.json({
        success: true,
        message: 'Turno desbloqueado y alineación de inventario/asientos contables realizada con éxito.',
        shift_id,
        status: 'OPEN'
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- REGISTRADOR DE SOPORTE PARA SUBIDA A SUPABASE STORAGE ---
  const uploadToSupabase = async (filePath: string, fileBuffer: Buffer) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.log("Supabase credentials not configured. Saving locally only.");
      return null;
    }
    try {
      const cleanUrl = supabaseUrl.replace(/\/$/, "");
      // Clean target path: remove leading slashes and url-encode it correctly
      const cleanPath = filePath.replace(/^\//, "");
      const url = `${cleanUrl}/storage/v1/object/cortes/${cleanPath}`;
      console.log(`Uploading to Supabase Storage: ${url}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
          'Content-Type': 'application/pdf',
          'x-upsert': 'true'
        },
        body: fileBuffer
      });
      if (response.ok) {
        console.log(`Successfully uploaded to Supabase Storage: cortes/${cleanPath}`);
        return `${cleanUrl}/storage/v1/object/public/cortes/${cleanPath}`;
      } else {
        const errText = await response.text();
        console.error("Supabase Storage upload failed response:", errText);
      }
    } catch (err) {
      console.error("Error uploading to Supabase Storage:", err);
    }
    return null;
  };

  // --- CORTE DE CAJA GENERAL & ARQUEO FINAL ---
  app.get('/api/shifts/close-details', (req, res) => {
    const userId = req.headers['x-user-id'] || 'user_cajero_1';
    try {
      const shift = db.prepare('SELECT * FROM shift_logs WHERE cajero_id = ? AND status IN ("OPEN", "PENDING_CLOSE_AUTHORIZATION") ORDER BY id DESC LIMIT 1').get(userId) as any;
      if (!shift) {
        return res.status(404).json({ error: 'No se encontró un turno activo para este cajero.' });
      }

      // 1. Sum up operations
      const purchases = db.prepare(`
        SELECT id, client_name, currency_in, amount_in, currency_out, amount_out, rate, created_at 
        FROM Operaciones_Captacion 
        WHERE created_at >= ? AND branch_id = 'MAIN_BRANCH'
      `).all(shift.hora_apertura) as any[];

      const sales = db.prepare(`
        SELECT id, client_name, currency_in, amount_in, currency_out, amount_out, rate, created_at 
        FROM Operaciones_Liquidacion_P2P 
        WHERE created_at >= ? AND branch_id = 'MAIN_BRANCH'
      `).all(shift.hora_apertura) as any[];

      // 2. Fetch expenses
      const expenses = db.prepare(`
        SELECT id, concept, amount, currency, authorized_by, receipt_image_url, created_at 
        FROM caja_gastos 
        WHERE shift_id = ? OR (created_at >= ? AND sucursal_id = 'MAIN_BRANCH')
      `).all(shift.id, shift.hora_apertura) as any[];

      // 3. Calculate expected balances per currency
      const openingCount = JSON.parse(shift.saldo_declarado_json || '{}');
      const expectedBalances: Record<string, number> = {};

      const currencies = ['MXN', 'USD', 'EUR', 'USDT'];
      currencies.forEach(curr => {
        let openingVal = 0;
        if (openingCount[curr]) {
          Object.entries(openingCount[curr]).forEach(([denom, qty]) => {
            openingVal += Number(denom) * Number(qty);
          });
        }
        expectedBalances[curr] = openingVal;
      });

      // Adjust with operations:
      // Captaciones (COMPRA): Receive currency_in, Pay currency_out
      purchases.forEach(c => {
        if (expectedBalances[c.currency_in] !== undefined) expectedBalances[c.currency_in] += c.amount_in;
        if (expectedBalances[c.currency_out] !== undefined) expectedBalances[c.currency_out] -= c.amount_out;
      });

      // Liquidaciones (VENTA): Receive currency_in, Pay currency_out
      sales.forEach(l => {
        if (expectedBalances[l.currency_in] !== undefined) expectedBalances[l.currency_in] += l.amount_in;
        if (expectedBalances[l.currency_out] !== undefined) expectedBalances[l.currency_out] -= l.amount_out;
      });

      // Subtract expenses
      expenses.forEach(e => {
        if (expectedBalances[e.currency] !== undefined) {
          expectedBalances[e.currency] -= e.amount;
        }
      });

      res.json({
        shift,
        purchases,
        sales,
        expenses,
        expectedBalances
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Save PDF report endpoint
  app.post('/api/shifts/save-pdf', upload.single('pdf'), async (req, res) => {
    const { shift_id, sucursal_id, fecha } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: "No se proporcionó archivo PDF" });
    }
    try {
      const pdfBuffer = fs.readFileSync(req.file.path);
      const filename = `turno_${shift_id}.pdf`;
      const targetPath = `${fecha}/${sucursal_id}/${filename}`;

      // 1. Try to upload to Supabase Storage
      const supabaseUrl = await uploadToSupabase(targetPath, pdfBuffer);

      // 2. Also save to a local directory for preview and fallback
      const localDir = path.join(process.cwd(), 'uploads', 'cortes', fecha, sucursal_id);
      fs.mkdirSync(localDir, { recursive: true });
      const localFilePath = path.join(localDir, filename);
      fs.writeFileSync(localFilePath, pdfBuffer);

      const localUrl = `/uploads/cortes/${fecha}/${sucursal_id}/${filename}`;

      // Save PDF URL in database
      db.prepare("UPDATE shift_logs SET pdf_report_url = ? WHERE id = ?").run(supabaseUrl || localUrl, shift_id);

      res.json({
        success: true,
        supabaseUrl,
        localUrl,
        url: supabaseUrl || localUrl,
        message: "PDF guardado y registrado exitosamente."
      });
    } catch (error) {
      console.error("Error saving PDF:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/shifts/expenses', (req, res) => {
    const userId = req.headers['x-user-id'] || 'user_cajero_1';
    try {
      const shift = db.prepare('SELECT id, hora_apertura FROM shift_logs WHERE cajero_id = ? AND status IN ("OPEN", "PENDING_CLOSE_AUTHORIZATION") ORDER BY id DESC LIMIT 1').get(userId) as any;
      if (!shift) {
        return res.json({ expenses: [] });
      }
      const expenses = db.prepare(`
        SELECT * FROM caja_gastos 
        WHERE shift_id = ? OR (created_at >= ? AND sucursal_id = 'MAIN_BRANCH')
        ORDER BY id DESC
      `).all(shift.id, shift.hora_apertura);
      res.json({ expenses });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/shifts/add-expense', upload.single('receipt'), (req, res) => {
    const userId = req.headers['x-user-id'] || 'user_cajero_1';
    const { concept, amount, currency, authorized_by } = req.body;

    if (!concept || !amount || !currency) {
      return res.status(400).json({ error: "Datos de gasto incompletos." });
    }

    try {
      const shift = db.prepare('SELECT id FROM shift_logs WHERE cajero_id = ? AND status = "OPEN" ORDER BY id DESC LIMIT 1').get(userId) as any;
      const shiftId = shift ? shift.id : null;
      const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

      const result = db.prepare(`
        INSERT INTO caja_gastos (sucursal_id, shift_id, concept, amount, currency, authorized_by, receipt_image_url)
        VALUES ('MAIN_BRANCH', ?, ?, ?, ?, ?, ?)
      `).run(shiftId, concept, parseFloat(amount), currency, authorized_by || 'ADMIN_MASTER', receiptUrl);

      res.status(201).json({
        success: true,
        message: "Gasto registrado exitosamente en caja.",
        id: result.lastInsertRowid,
        receipt_image_url: receiptUrl
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/shifts/close-blind', (req, res) => {
    const userId = req.headers['x-user-id'] || 'user_cajero_1';
    const { shift_id, counts, heredarSaldos } = req.body; // counts: { MXN: { "500": 10, ... } }

    try {
      const shift = db.prepare('SELECT * FROM shift_logs WHERE id = ? AND cajero_id = ?').get(shift_id, userId) as any;
      if (!shift) {
        return res.status(404).json({ error: 'Turno no encontrado.' });
      }

      // Calculate expected balances
      const expectedBalances: Record<string, number> = {};
      const openingCount = JSON.parse(shift.saldo_declarado_json || '{}');
      const currencies = ['MXN', 'USD', 'EUR', 'USDT'];
      
      currencies.forEach(curr => {
        let openingVal = 0;
        if (openingCount[curr]) {
          Object.entries(openingCount[curr]).forEach(([denom, qty]) => {
            openingVal += Number(denom) * Number(qty);
          });
        }
        expectedBalances[curr] = openingVal;
      });

      // Fetch transactions since hora_apertura
      const purchases = db.prepare(`
        SELECT currency_in, amount_in, currency_out, amount_out FROM Operaciones_Captacion 
        WHERE created_at >= ? AND branch_id = 'MAIN_BRANCH'
      `).all(shift.hora_apertura) as any[];

      const sales = db.prepare(`
        SELECT currency_in, amount_in, currency_out, amount_out FROM Operaciones_Liquidacion_P2P 
        WHERE created_at >= ? AND branch_id = 'MAIN_BRANCH'
      `).all(shift.hora_apertura) as any[];

      const expenses = db.prepare(`
        SELECT currency, amount FROM caja_gastos 
        WHERE shift_id = ? OR (created_at >= ? AND sucursal_id = 'MAIN_BRANCH')
      `).all(shift.id, shift.hora_apertura) as any[];

      // Accumulate
      purchases.forEach(c => {
        if (expectedBalances[c.currency_in] !== undefined) expectedBalances[c.currency_in] += c.amount_in;
        if (expectedBalances[c.currency_out] !== undefined) expectedBalances[c.currency_out] -= c.amount_out;
      });

      sales.forEach(l => {
        if (expectedBalances[l.currency_in] !== undefined) expectedBalances[l.currency_in] += l.amount_in;
        if (expectedBalances[l.currency_out] !== undefined) expectedBalances[l.currency_out] -= l.amount_out;
      });

      expenses.forEach(e => {
        if (expectedBalances[e.currency] !== undefined) {
          expectedBalances[e.currency] -= e.amount;
        }
      });

      // Calculate physical totals
      const declaredTotals: Record<string, number> = {};
      const deviations: Record<string, { declared: number, expected: number, diff: number, valueDiff: number }> = {};
      let hasDeviation = false;

      currencies.forEach(curr => {
        declaredTotals[curr] = 0;
        const currDecMap = (counts || {})[curr] || {};
        
        Object.keys(currDecMap).forEach(denom => {
          const qty = Number(currDecMap[denom] || 0);
          declaredTotals[curr] += (Number(denom) * qty);
        });

        const expectedTotal = expectedBalances[curr] || 0;
        const declaredTotal = declaredTotals[curr] || 0;
        const diff = declaredTotal - expectedTotal;

        if (Math.abs(diff) > 0.01) {
          hasDeviation = true;
          // Generate a cash_deviation row
          db.prepare(`
            INSERT INTO cash_deviations (shift_id, sucursal_id, cajero_id, type, currency, expected_amount, declared_amount, difference, status)
            VALUES (?, 'MAIN_BRANCH', ?, 'CIERRE', ?, ?, ?, ?, 'PENDING')
          `).run(shift_id, userId, curr, expectedTotal, declaredTotal, diff);
        }

        const ratePair = `${curr}_MXN`;
        const buyRate = redisRates[ratePair as keyof typeof redisRates]?.buy || 1.0;
        const valueDiff = diff * buyRate;

        deviations[curr] = {
          declared: declaredTotal,
          expected: expectedTotal,
          diff: diff,
          valueDiff: valueDiff
        };
      });

      if (hasDeviation) {
        // Locked waiting for authorization
        db.prepare(`
          UPDATE shift_logs 
          SET status = 'PENDING_CLOSE_AUTHORIZATION', 
              cierre_declarado_json = ?, 
              cierre_esperado_json = ?, 
              cierre_desviaciones_json = ?
          WHERE id = ?
        `).run(JSON.stringify(counts), JSON.stringify(expectedBalances), JSON.stringify(deviations), shift_id);

        return res.json({
          success: false,
          status: 'PENDING_CLOSE_AUTHORIZATION',
          message: 'Desviación detectada al cierre de caja. Se requiere autorización de Administrador (Nivel 5) para cerrar.',
          deviations
        });
      } else {
        // Close perfectly
        db.prepare(`
          UPDATE shift_logs 
          SET status = 'CLOSED', 
              hora_cierre = CURRENT_TIMESTAMP,
              cierre_declarado_json = ?, 
              cierre_esperado_json = ?, 
              cierre_desviaciones_json = ?
          WHERE id = ?
        `).run(JSON.stringify(counts), JSON.stringify(expectedBalances), JSON.stringify(deviations), shift_id);

        // If Heredar Saldos is checked, align inventory & boveda to final counts
        if (heredarSaldos) {
          const updateInv = db.prepare(`
            INSERT INTO Inventario_Boveda_Detalle (branch_id, currency, denominacion, quantity, last_update)
            VALUES ('MAIN_BRANCH', ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(branch_id, currency, denominacion) 
            DO UPDATE SET quantity = excluded.quantity, last_update = CURRENT_TIMESTAMP
          `);

          Object.keys(counts).forEach(curr => {
            const denoms = counts[curr];
            let currencyTotalValue = 0;
            Object.keys(denoms).forEach(denomStr => {
              const denom = Number(denomStr);
              const qty = Number(denoms[denomStr] || 0);
              currencyTotalValue += (denom * qty);
              updateInv.run(curr, denom, qty);
            });

            db.prepare('UPDATE Boveda SET balance = ?, last_update = CURRENT_TIMESTAMP WHERE currency = ?')
              .run(currencyTotalValue, curr);
          });
        }

        return res.json({
          success: true,
          status: 'CLOSED',
          message: 'Corte de caja guardado con éxito. Caja cuadrada al 100%.'
        });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/shifts/authorize-close', (req, res) => {
    const managerId = req.headers['x-user-id'] || 'user_gerente_1';
    const { shift_id, heredarSaldos } = req.body;

    try {
      // Must be Nivel 5 (Admin Nivel 5) to authorize a closing deviation
      const managerProfile = db.prepare('SELECT nickname, role_level FROM User_Profiles WHERE auth_user_id = ?').get(managerId) as any;
      if (!managerProfile || managerProfile.role_level < 5) {
        return res.status(403).json({ error: 'Acceso Denegado: Se requiere autorización de Administrador (Nivel 5).' });
      }

      const shift = db.prepare('SELECT * FROM shift_logs WHERE id = ?').get(shift_id) as any;
      if (!shift) {
        return res.status(404).json({ error: 'Turno no encontrado.' });
      }

      if (shift.status !== 'PENDING_CLOSE_AUTHORIZATION') {
        return res.status(400).json({ error: 'El turno no requiere autorización de cierre.' });
      }

      const counts = JSON.parse(shift.cierre_declarado_json || '{}');
      const deviations = JSON.parse(shift.cierre_desviaciones_json || '{}');

      // 1. Authorize deviations in cash_deviations table
      db.prepare(`
        UPDATE cash_deviations 
        SET status = 'AUTHORIZED', authorized_by = ?, authorization_date = CURRENT_TIMESTAMP 
        WHERE shift_id = ? AND status = 'PENDING'
      `).run(managerProfile.nickname, shift_id);

      // 2. Set shift status to CLOSED
      db.prepare(`
        UPDATE shift_logs 
        SET status = 'CLOSED', hora_cierre = CURRENT_TIMESTAMP, authorized_by = ?, authorization_date = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(managerProfile.nickname, shift_id);

      // 3. Post double-entry adjustment journal entries
      let totalDeviationMxnValue = 0;
      Object.keys(deviations).forEach(curr => {
        const devInfo = deviations[curr];
        if (devInfo) {
          totalDeviationMxnValue += (devInfo.valueDiff || 0);
        }
      });

      if (Math.abs(totalDeviationMxnValue) > 0.01) {
        const txId = `ADJUST-CL-${shift.folio_documento}`;
        const desc = `Ajuste contable por desviación autorizada en cierre. Folio: ${shift.folio_documento}`;
        
        if (totalDeviationMxnValue > 0) {
          // Cash surplus: Debit 1101, Credit 4102
          recordJournalEntry(txId, desc, [
            { account: '1101', debit: totalDeviationMxnValue, credit: 0 },
            { account: '4102', debit: 0, credit: totalDeviationMxnValue }
          ]);
        } else {
          // Cash deficit: Debit 5201, Credit 1101
          const absVal = Math.abs(totalDeviationMxnValue);
          recordJournalEntry(txId, desc, [
            { account: '5201', debit: absVal, credit: 0 },
            { account: '1101', debit: 0, credit: absVal }
          ]);
        }
      }

      // 4. Align inventory/Boveda if Heredar Saldos is checked
      if (heredarSaldos) {
        const updateInv = db.prepare(`
          INSERT INTO Inventario_Boveda_Detalle (branch_id, currency, denominacion, quantity, last_update)
          VALUES ('MAIN_BRANCH', ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(branch_id, currency, denominacion) 
          DO UPDATE SET quantity = excluded.quantity, last_update = CURRENT_TIMESTAMP
        `);

        Object.keys(counts).forEach(curr => {
          const denoms = counts[curr];
          let currencyTotalValue = 0;
          Object.keys(denoms).forEach(denomStr => {
            const denom = Number(denomStr);
            const qty = Number(denoms[denomStr] || 0);
            currencyTotalValue += (denom * qty);
            updateInv.run(curr, denom, qty);
          });

          db.prepare('UPDATE Boveda SET balance = ?, last_update = CURRENT_TIMESTAMP WHERE currency = ?')
            .run(currencyTotalValue, curr);
        });
      }

      res.json({
        success: true,
        status: 'CLOSED',
        message: 'Desviación de cierre autorizada por Administrador. Turno cerrado con éxito.'
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- MÓDULO LEGALTECH: WIZARD DE CONTRATACIÓN Y EXPEDIENTE DIGITAL ---
  app.use('/pre_contratacion', express.static(path.join(process.cwd(), 'public', 'pre_contratacion')));
  app.use('/brand_assets', express.static(path.join(process.cwd(), 'public', 'brand_assets')));

  // Template engine helpers
  const mapVariables = (template: string, data: Record<string, any>): string => {
    let result = template;
    Object.keys(data).forEach(key => {
      const val = data[key] !== undefined && data[key] !== null ? String(data[key]) : '';
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), val);
    });
    return result;
  };

  const CONTRATO_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Contrato Individual de Trabajo - {{nombre_completo}}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #111; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 30px; text-transform: uppercase; border-bottom: 2px solid #111; padding-bottom: 10px; }
    h2 { font-size: 13px; font-weight: bold; margin-top: 20px; text-transform: uppercase; border-left: 3px solid #111; padding-left: 8px; }
    p, li { font-size: 12px; text-align: justify; }
    ol { padding-left: 20px; }
    .signature-container { margin-top: 50px; display: flex; justify-content: space-between; }
    .signature-box { width: 45%; border-top: 1px solid #111; text-align: center; padding-top: 8px; font-size: 11px; }
    .stamp { border: 2px dashed #9ca3af; padding: 12px; margin-top: 40px; font-family: monospace; font-size: 9px; background: #f9fafb; color: #374151; }
  </style>
</head>
<body>
  <h1>CONTRATO INDIVIDUAL DE TRABAJO POR TIEMPO INDETERMINADO</h1>
  <p>CONTRATO INDIVIDUAL DE TRABAJO QUE CELEBRAN POR UNA PARTE, <strong>BAAS CAMBIARIA S.A. DE C.V.</strong> (EN LO SUCESIVO DENOMINADA EL "PATRÓN"), REPRESENTADA EN ESTE ACTO POR SU OFICIAL DE CUMPLIMIENTO LEGAL, Y POR LA OTRA PARTE, EL C. <strong>{{nombre_completo}}</strong> (EN LO SUCESIVO EL "TRABAJADOR"), AL TENOR DE LAS SIGUIENTES DECLARACIONES Y CLÁUSULAS:</p>

  <h2>DECLARACIONES</h2>
  <p><strong>I. DECLARA EL "PATRÓN":</strong></p>
  <ol>
    <li>Ser una Sociedad Anónima de Capital Variable legalmente constituida bajo las leyes de los Estados Unidos Mexicanos, con domicilio legal corporativo ubicado en <strong>Paseo de la Reforma 505, Piso 12, Cuauhtémoc, Ciudad de México, C.P. 06500</strong>.</li>
    <li>Que tiene por objeto social la operación, captación, liquidación y corretaje de divisas físicas y digitales, contando con la infraestructura, elementos propios, herramientas y recursos contables suficientes para cumplir con sus obligaciones laborales.</li>
    <li>Que requiere los servicios del TRABAJADOR para desempeñar las funciones relativas al puesto de <strong>{{puesto}}</strong> en la sucursal de asignación <strong>{{sucursal}}</strong>.</li>
  </ol>

  <p><strong>II. DECLARA EL "TRABAJADOR":</strong></p>
  <ol>
    <li>Llamarse como ha quedado escrito, de nacionalidad <strong>{{nacionalidad}}</strong>, estado civil <strong>{{estado_civil}}</strong>, con fecha de nacimiento <strong>{{fecha_nacimiento}}</strong>, originario de <strong>{{lugar_nacimiento}}</strong>, clave CURP <strong>{{curp}}</strong>, Registro Federal de Contribuyentes (RFC) <strong>{{rfc}}</strong>, con número de seguridad social (NSS) <strong>{{nss}}</strong> y con domicilio particular en <strong>{{domicilio}}</strong>.</li>
    <li>Bajo protesta de decir verdad, declara que cuenta con los conocimientos, aptitudes y capacidades físicas y mentales requeridas para desempeñar el puesto de <strong>{{puesto}}</strong> de manera óptima.</li>
  </ol>

  <h2>CLÁUSULAS</h2>
  <p><strong>PRIMERA. MATERIA DEL CONTRATO.</strong> El TRABAJADOR se obliga a prestar sus servicios personales subordinados al PATRÓN desempeñando las funciones inherentes al puesto de <strong>{{puesto}}</strong>, sujetándose a las políticas internas, manuales de cumplimiento PLD/FT y directrices operativas que dicte el PATRÓN.</p>
  
  <p><strong>SEGUNDA. LUGAR DE TRABAJO.</strong> Las partes convienen en que el lugar de prestación de los servicios será la sucursal identificada como <strong>{{sucursal}}</strong>. El PATRÓN se reserva el derecho de reasignar al TRABAJADOR a otra sucursal por necesidades operativas legítimas de la plataforma fintech.</p>

  <p><strong>TERCERA. DURACIÓN.</strong> El presente contrato se celebra por <strong>tiempo indeterminado</strong> a partir de la fecha de inicio laboral el <strong>{{fecha_inicio}}</strong>. Se pacta un periodo de prueba inicial de 30 días naturales conforme a lo dispuesto en la Ley Federal del Trabajo.</p>

  <p><strong>CUARTA. JORNADA LABORAL.</strong> La jornada semanal de trabajo será de 48 horas distribuidas de conformidad con las necesidades operativas de la sucursal y el reglamento interior de trabajo del PATRÓN.</p>

  <p><strong>QUINTA. SALARIO Y FORMA DE PAGO.</strong> El TRABAJADOR percibirá por la prestación de sus servicios un sueldo bruto mensual de <strong>$ {{sueldo_mensual}} MXN</strong> (PESOS MEXICANOS), el cual se cubrirá en forma quincenal mediante transferencia electrónica bancaria. El sueldo pactado incluye la prima dominical e integraciones correspondientes.</p>

  <p><strong>SEXTA. PRESTACIONES.</strong> El TRABAJADOR disfrutará de las prestaciones mínimas de ley, consistentes en: Aguinaldo equivalente a 15 días de salario por año completo, periodo de vacaciones anual conforme al artículo 76 de la Ley Federal del Trabajo, prima vacacional del 25% y las prestaciones adicionales señaladas como: <strong>{{prestaciones}}</strong>.</p>

  <p><strong>SÉPTIMA. RECONOCIMIENTO DE PATRÓN ÚNICO.</strong> El TRABAJADOR reconoce de manera expresa que <strong>BAAS CAMBIARIA S.A. DE C.V.</strong> es su único y exclusivo patrón para todos los efectos legales, laborales y fiscales, liberando de toda responsabilidad a cualquier otra subsidiaria o tercero de la red fintech.</p>

  <p><strong>OCTAVA. OBLIGACIONES DE CUMPLIMIENTO FINTECH.</strong> El TRABAJADOR, debido a la naturaleza de su puesto en el manejo de valores y divisas, se obliga a observar estricta confidencialidad de la información y abstenerse de cualquier práctica prohibida por la CNBV, sujetándose a las auditorías arqueológicas ciegas de turno obligatorias.</p>

  <p>Leído que fue el presente contrato por ambas partes y debidamente enteradas de su contenido y alcance legal, lo firman por duplicado en la Ciudad de México el día <strong>{{fecha_inicio}}</strong>.</p>

  <div class="signature-container">
    <div class="signature-box">
      EL PATRÓN<br>
      BAAS CAMBIARIA S.A. DE C.V.<br>
      Representante de Cumplimiento
    </div>
    <div class="signature-box">
      EL TRABAJADOR<br>
      {{nombre_completo}}<br>
      CURP: {{curp}}
    </div>
  </div>

  <div class="stamp">
    AUDITORÍA LEGALTECH SECURE HASH: SHA256-{{curp}}-CONTRACT-SECURE-ENVELOPE<br>
    REGISTRO DIGITAL HR_VAULT: /pre_contratacion/{{curp}}/contrato_individual_trabajo.html
  </div>
</body>
</html>`;

  const AVISO_CONTRATACION_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Aviso de Contratación y Recepción - {{nombre_completo}}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #111; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { text-align: center; font-size: 16px; font-weight: bold; margin-bottom: 25px; text-transform: uppercase; border-bottom: 2px solid #111; padding-bottom: 10px; }
    p { font-size: 12px; text-align: justify; }
    .checklist { background: #f3f4f6; padding: 20px; border-radius: 8px; font-size: 11px; font-family: monospace; }
    .checklist-item { margin-bottom: 6px; display: flex; align-items: center; }
    .checkbox { width: 12px; height: 12px; border: 1px solid #111; margin-right: 8px; display: inline-block; background: #10b981; }
    .signature-container { margin-top: 50px; display: flex; justify-content: space-between; }
    .signature-box { width: 45%; border-top: 1px solid #111; text-align: center; padding-top: 8px; font-size: 11px; }
  </style>
</head>
<body>
  <h1>AVISO DE CONTRATACIÓN Y ACUSE DE EXPEDIENTE DIGITAL</h1>
  <p><strong>FECHA:</strong> {{fecha_inicio}}</p>
  <p><strong>PARA:</strong> DIRECCIÓN DE RECURSOS HUMANOS Y OFICIALÍA DE CUMPLIMIENTO</p>
  <p>Por medio de este instrumento, se hace constar formalmente el inicio de la relación laboral del C. <strong>{{nombre_completo}}</strong> para ocupar el puesto de <strong>{{puesto}}</strong> asignado a la sucursal <strong>{{sucursal}}</strong>, con un sueldo mensual bruto de <strong>$ {{sueldo_mensual}} MXN</strong>.</p>
  
  <p><strong>DECLARACIÓN DE VERACIDAD (BAJO PROTESTA DE DECIR VERDAD):</strong><br>
  El TRABAJADOR declara bajo protesta de decir verdad que toda la información provista para el alta y expediente es verídica, exacta y vigente. Asimismo, acepta que cualquier falsedad o alteración en los documentos entregados constituirá causa de rescisión inmediata de la relación de trabajo sin responsabilidad alguna para el PATRÓN, de conformidad con el artículo 47 de la Ley Federal del Trabajo.</p>

  <p><strong>ACUSE DE RECIBO DE DOCUMENTOS DE EXPEDIENTE (CHECKLIST DIGITAL HR_VAULT):</strong><br>
  La Dirección de Capital Humano acusa de recibido los siguientes documentos integrados digitalmente en el repositorio seguro bajo la ruta <code>/pre_contratacion/{{curp}}/</code>:</p>

  <div class="checklist">
    <div class="checklist-item"><span class="checkbox"></span> [X] IDENTIFICACIÓN OFICIAL VIGENTE (INE / PASAPORTE)</div>
    <div class="checklist-item"><span class="checkbox"></span> [X] ACTA DE NACIMIENTO ORIGINAL EN COPIA CERTIFICADA (OBLIGATORIA)</div>
    <div class="checklist-item"><span class="checkbox"></span> [X] COMPROBANTE DE DOMICILIO RECIENTE (MÁXIMO 3 MESES DE ANTIGÜEDAD)</div>
    <div class="checklist-item"><span class="checkbox"></span> [X] CARTAS DE RECOMENDACIÓN LABORALES / PERSONALES</div>
    <div class="checklist-item"><span class="checkbox"></span> [X] CÉDULA DE IDENTIFICACIÓN FISCAL (RFC) Y CLAVE ÚNICA DE REGISTRO DE POBLACIÓN (CURP)</div>
    <div class="checklist-item"><span class="checkbox"></span> [X] CONSTANCIA DE NÚMERO DE SEGURIDAD SOCIAL (NSS / IMSS)</div>
    <div class="checklist-item"><span class="checkbox"></span> [X] DECLARATORIA DE CRÉDITO INFONAVIT / FONACOT (ESTATUS: {{infonavit_fonacot}})</div>
  </div>

  <p>Se otorga la validación legal del expediente para proceder con la habilitación biométrica y de credenciales en el sistema transaccional de ventanilla FX.</p>

  <div class="signature-container">
    <div class="signature-box">
      RECURSOS HUMANOS / AUDITORÍA<br>
      BaaS Cambiaria S.A. de C.V.
    </div>
    <div class="signature-box">
      ACUSE DE ENTERADO Y CONFORMIDAD<br>
      {{nombre_completo}}<br>
      CURP: {{curp}}
    </div>
  </div>
</body>
</html>`;

  const AVISO_PRIVACIDAD_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Aviso de Privacidad Integral - {{nombre_completo}}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #111; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { text-align: center; font-size: 15px; font-weight: bold; margin-bottom: 25px; text-transform: uppercase; border-bottom: 2px solid #111; padding-bottom: 10px; }
    p { font-size: 11px; text-align: justify; }
    ol { padding-left: 20px; font-size: 11px; }
    .signature-container { margin-top: 50px; display: flex; justify-content: space-between; }
    .signature-box { width: 45%; border-top: 1px solid #111; text-align: center; padding-top: 8px; font-size: 11px; }
  </style>
</head>
<body>
  <h1>AVISO DE PRIVACIDAD INTEGRAL PARA COLABORADORES Y EXPEDIENTES HR_VAULT</h1>
  <p><strong>RESPONSABLE DEL TRATAMIENTO:</strong> BAAS CAMBIARIA S.A. DE C.V., con domicilio en Paseo de la Reforma 505, Piso 12, Cuauhtémoc, Ciudad de México, C.P. 06500, es el responsable del uso, protección y tratamiento de sus datos personales y sensibles, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).</p>

  <p><strong>DATOS PERSONALES RECABADOS Y TRATADOS:</strong><br>
  Para llevar a cabo el proceso de contratación, alta y auditoría contable, se recaban los siguientes datos personales:</p>
  <ol>
    <li><strong>Datos de Identificación:</strong> Nombre completo, lugar y fecha de nacimiento, nacionalidad, estado civil, RFC, CURP, domicilio, firmas autógrafas.</li>
    <li><strong>Datos Socioeconómicos y Laborales:</strong> Puesto anterior, puesto asignado, sueldo mensual, NSS, estatus Infonavit/Fonacot, referencias personales.</li>
    <li><strong>Datos Sensibles y Biométricos (PLD/FT):</strong> Datos de voz, huellas dactilares y/o reconocimiento facial para la autorización y desbloqueo de turnos en bóveda, así como antecedentes penales/legales vinculados a la oficialía de cumplimiento de la red cambiaria.</li>
  </ol>

  <p><strong>FINALIDADES PRINCIPALES DEL TRATAMIENTO:</strong><br>
  Los datos personales recabados serán utilizados para las siguientes finalidades necesarias:</p>
  <ol>
    <li>Formalizar la relación de trabajo mediante el contrato de trabajo por tiempo indeterminado.</li>
    <li>Dar cumplimiento a obligaciones de seguridad social (IMSS, Infonavit, Fonacot) e impositivas (SAT).</li>
    <li>Integrar el expediente laboral digital histórico en el repositorio seguro <code>hr_vault</code> bajo el path <code>/pre_contratacion/{{curp}}/</code>.</li>
    <li>Habilitar los controles biométricos de acceso a caja y auditorías ciegas de balance conforme a las normas CNBV aplicables a transmisores de dinero.</li>
  </ol>

  <p><strong>DERECHOS ARCO:</strong><br>
  Usted tiene derecho a conocer qué datos personales tenemos de usted, para qué los utilizamos y las condiciones del uso que les damos (Acceso). Asimismo, es su derecho solicitar la corrección de su información personal en caso de que esté desactualizada, sea inexacta o incompleta (Rectificación); que la eliminemos de nuestros registros o bases de datos cuando considere que la misma no está siendo utilizada adecuadamente (Cancelación); así como oponerse al uso de sus datos personales para fines específicos (Oposición). Estos derechos se conocen como derechos ARCO. Para el ejercicio de cualquiera de los derechos ARCO, usted de conformidad con la LFPDPPP podrá presentar la solicitud respectiva ante la Oficialía de Privacidad del PATRÓN.</p>

  <p>Al firmar el presente instrumento, el TRABAJADOR otorga su consentimiento expreso para el tratamiento de sus datos personales, patrimoniales y sensibles para las finalidades aquí descritas.</p>

  <div class="signature-container">
    <div class="signature-box">
      EL RESPONSABLE<br>
      BAAS CAMBIARIA S.A. DE C.V.
    </div>
    <div class="signature-box">
      OTORGO MI CONSENTIMIENTO EXPRESO<br>
      {{nombre_completo}}<br>
      Firma del Colaborador
    </div>
  </div>
</body>
</html>`;

  // Endpoint 1: Get list of pre-hires
  app.get('/api/hr/vault', (req, res) => {
    const managerId = req.headers['x-user-id'] || 'user_gerente_1';
    try {
      const manager = db.prepare('SELECT role_level FROM User_Profiles WHERE auth_user_id = ?').get(managerId) as any;
      if (!manager || manager.role_level < 5) {
        return res.status(403).json({ error: 'Acceso Denegado: Se requieren privilegios de Administrador u Oficial de Cumplimiento (Nivel 5).' });
      }

      const rows = db.prepare('SELECT * FROM hr_vault_metadata ORDER BY id DESC').all() as any[];
      rows.forEach(r => {
        r.metadata_json = JSON.parse(r.metadata_json || '{}');
        r.documents_json = JSON.parse(r.documents_json || '{}');
      });
      res.json({ files: rows });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Endpoint 2: Get specific file
  app.get('/api/hr/vault/:curp', (req, res) => {
    const managerId = req.headers['x-user-id'] || 'user_gerente_1';
    const { curp } = req.params;
    try {
      const manager = db.prepare('SELECT role_level FROM User_Profiles WHERE auth_user_id = ?').get(managerId) as any;
      if (!manager || manager.role_level < 5) {
        return res.status(403).json({ error: 'Acceso Denegado.' });
      }

      const row = db.prepare('SELECT * FROM hr_vault_metadata WHERE curp = ?').get(curp) as any;
      if (!row) return res.status(404).json({ error: 'Registro de contratación no encontrado.' });

      row.metadata_json = JSON.parse(row.metadata_json || '{}');
      row.documents_json = JSON.parse(row.documents_json || '{}');
      res.json(row);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Endpoint 3: Generate legal documents and save to the file repository (public/pre_contratacion/{{curp}}/)
  app.post('/api/hr/vault/generate', (req, res) => {
    const managerId = req.headers['x-user-id'] || 'user_gerente_1';
    try {
      const manager = db.prepare('SELECT nickname, role_level FROM User_Profiles WHERE auth_user_id = ?').get(managerId) as any;
      if (!manager || manager.role_level < 5) {
        return res.status(403).json({ error: 'Acceso Denegado: Se requieren privilegios de Administrador u Oficial de Cumplimiento (Nivel 5) para generar contratos.' });
      }

      const form = req.body;
      const {
        nombre_completo, lugar_nacimiento, fecha_nacimiento, nacionalidad, estado_civil, rfc, curp, domicilio,
        puesto, sueldo_mensual, prestaciones, fecha_inicio, nss, infonavit_fonacot,
        referencia1_nombre, referencia1_telefono, referencia1_parentesco,
        referencia2_nombre, referencia2_telefono, referencia2_parentesco,
        doc_id_oficial, doc_acta_nacimiento, doc_comprobante_domicilio, doc_cartas_recomendacion, sucursal
      } = form;

      // Crucial Validation: If role has "Cajero" and original birth certificate (acta de nacimiento original) is missing, block!
      const isCajero = puesto && puesto.toLowerCase().includes('cajero');
      if (isCajero && !doc_acta_nacimiento) {
        return res.status(400).json({ error: 'Requisito de Cumplimiento Incumplido: El Acta de Nacimiento Original es de carácter estrictamente obligatorio para dar de alta perfiles con rol de Cajero en ventanilla.' });
      }

      // Check remaining basic fields
      if (!nombre_completo || !curp || !rfc || !puesto || !sueldo_mensual || !fecha_inicio || !nss || !domicilio) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para generar la pre-contratación.' });
      }

      // Variable mapping object
      const mappedData = {
        nombre_completo: String(nombre_completo).toUpperCase(),
        lugar_nacimiento: String(lugar_nacimiento || '').toUpperCase(),
        fecha_nacimiento: String(fecha_nacimiento || ''),
        nacionalidad: String(nacionalidad || 'MEXICANA').toUpperCase(),
        estado_civil: String(estado_civil || 'SOLTERO(A)').toUpperCase(),
        rfc: String(rfc).toUpperCase(),
        curp: String(curp).toUpperCase(),
        domicilio: String(domicilio).toUpperCase(),
        puesto: String(puesto).toUpperCase(),
        sueldo_mensual: Number(sueldo_mensual).toLocaleString('es-MX', { minimumFractionDigits: 2 }),
        prestaciones: String(prestaciones || 'VALES DE DESPENSA, FONDO DE AHORRO').toUpperCase(),
        fecha_inicio: String(fecha_inicio),
        nss: String(nss).toUpperCase(),
        infonavit_fonacot: String(infonavit_fonacot || 'NINGUNO').toUpperCase(),
        sucursal: String(sucursal === 'MAIN_BRANCH' ? 'MATRIZ - CENTRO' : sucursal === 'BRANCH_NORTH' ? 'SUCURSAL NORTE' : 'SUCURSAL SUR')
      };

      // Apply variable mappings
      const contratoHtml = mapVariables(CONTRATO_TEMPLATE, mappedData);
      const avisoContratacionHtml = mapVariables(AVISO_CONTRATACION_TEMPLATE, mappedData);
      const avisoPrivacidadHtml = mapVariables(AVISO_PRIVACIDAD_TEMPLATE, mappedData);

      // Create target directory in the safe /pre_contratacion/{{curp}} volume
      const targetDir = path.join(process.cwd(), 'public', 'pre_contratacion', curp);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Write files as beautifully styled HTML (client print-to-pdf friendly)
      fs.writeFileSync(path.join(targetDir, 'contrato_individual_trabajo.html'), contratoHtml, 'utf8');
      fs.writeFileSync(path.join(targetDir, 'aviso_contratacion.html'), avisoContratacionHtml, 'utf8');
      fs.writeFileSync(path.join(targetDir, 'aviso_privacidad.html'), avisoPrivacidadHtml, 'utf8');

      // Setup document paths
      const documentsObj = {
        contrato: `/pre_contratacion/${curp}/contrato_individual_trabajo.html`,
        aviso_contratacion: `/pre_contratacion/${curp}/aviso_contratacion.html`,
        aviso_privacidad: `/pre_contratacion/${curp}/aviso_privacidad.html`
      };

      // Save or update metadata database record
      const stmt = db.prepare(`
        INSERT INTO hr_vault_metadata (curp, full_name, puesto, sucursal, sueldo_mensual, metadata_json, documents_json, created_by, is_finalized)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(curp) DO UPDATE SET
          full_name = excluded.full_name,
          puesto = excluded.puesto,
          sucursal = excluded.sucursal,
          sueldo_mensual = excluded.sueldo_mensual,
          metadata_json = excluded.metadata_json,
          documents_json = excluded.documents_json,
          created_by = excluded.created_by,
          is_finalized = 0
      `);

      stmt.run(
        curp.toUpperCase(),
        nombre_completo.toUpperCase(),
        puesto.toUpperCase(),
        sucursal,
        Number(sueldo_mensual),
        JSON.stringify(form),
        JSON.stringify(documentsObj),
        manager.nickname
      );

      res.status(201).json({
        success: true,
        message: 'Contratos e instrumentos legales generados con éxito bajo estándar LegalTech.',
        curp,
        documents: documentsObj
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Endpoint 4: Finalize Onboarding & Insert into User_Profiles
  app.post('/api/hr/vault/finalize', async (req, res) => {
    const managerId = req.headers['x-user-id'] || 'user_gerente_1';
    const { curp } = req.body;
    try {
      const manager = db.prepare('SELECT role_level FROM User_Profiles WHERE auth_user_id = ?').get(managerId) as any;
      if (!manager || manager.role_level < 5) {
        return res.status(403).json({ error: 'Acceso Denegado: No está autorizado para finalizar altas.' });
      }

      if (!curp) return res.status(400).json({ error: 'El CURP es requerido para formalizar el alta.' });

      const fileRecord = db.prepare('SELECT * FROM hr_vault_metadata WHERE curp = ?').get(curp.toUpperCase()) as any;
      if (!fileRecord) return res.status(404).json({ error: 'No se encontraron documentos contractuales generados para este CURP. Debe completar la etapa de generación de instrumentos antes de formalizar el alta.' });

      if (fileRecord.is_finalized === 1) {
        return res.status(400).json({ error: 'Este colaborador ya cuenta con alta definitiva en el sistema.' });
      }

      const metadata = JSON.parse(fileRecord.metadata_json || '{}');

      // Create unique Auth user ID for transaction logging and shift logs
      const nickname = String(fileRecord.full_name).split(' ')[0] + '_' + Math.floor(100 + Math.random() * 900);
      const authUserId = `user_${nickname.toLowerCase()}`;

      const defaultPermissions = JSON.stringify({
        tc_limit: 2.5,
        can_cancel: false,
        show_vault_balance: false
      });

      // Insert operator into User_Profiles with auto-generated password
      // FIX 2026-09-05: usaba SHA-256 → verifyPassword (bcrypt) nunca coincidía.
      // Ahora siempre bcrypt.
      const tempPassword = curp.substring(0, 4).toUpperCase() + '2026';
      const passwordHash = await hashPassword(tempPassword);

      db.prepare(`
        INSERT INTO User_Profiles (auth_user_id, nickname, puesto, branch_id, hire_date, role_level, custom_permissions, password_hash)
        VALUES (?, ?, ?, ?, ?, 2, ?, ?)
      `).run(
        authUserId,
        fileRecord.full_name,
        fileRecord.puesto,
        fileRecord.sucursal || 'MAIN_BRANCH',
        metadata.fecha_inicio || new Date().toISOString().split('T')[0],
        defaultPermissions,
        passwordHash
      );

      // Create cajas entry for the new cashier (initial balance = 0)
      db.prepare('INSERT OR IGNORE INTO cajas (cajero_id, saldo_actual_mxn, sucursal_id) VALUES (?, 0, ?)')
        .run(authUserId, fileRecord.sucursal || "MAIN_BRANCH");

      // Update HR Vault record to set finalized status
      db.prepare('UPDATE hr_vault_metadata SET is_finalized = 1 WHERE curp = ?').run(curp.toUpperCase());

      res.json({
        success: true,
        message: 'Alta definitiva consolidada.',
        auth_user_id: authUserId,
        nickname: fileRecord.full_name,
        temp_password: tempPassword
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- SUB-MÓDULO ALTA DE SUCURSAL ---
  app.get('/api/sucursales', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM sucursales ORDER BY created_at DESC').all();
      res.json({ status: 'success', data: rows });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  app.get('/api/sucursales/:id', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM sucursales WHERE sucursal_id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ status: 'error', message: 'Sucursal no encontrada' });
      res.json({ status: 'success', data: row });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  app.post('/api/sucursales', (req, res) => {
    const {
      sucursal_id, razon_social, nombre, rfc, calle, numero, colonia, ciudad, codigo_postal, telefono, email, licencia_cnbv, logo_url, es_matriz
    } = req.body;

    if (!nombre) {
      return res.status(400).json({ status: 'error', message: 'El nombre de la sucursal es obligatorio.' });
    }

    const id = sucursal_id || `sucursal_${nombre.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
    const isMatrizVal = (es_matriz === 1 || es_matriz === true || es_matriz === '1') ? 1 : 0;

    try {
      if (isMatrizVal === 1) {
        // Enforce unique constraint check for head office
        const existingMatriz = db.prepare('SELECT sucursal_id, nombre FROM sucursales WHERE es_matriz = 1 AND sucursal_id != ?').get(id) as any;
        if (existingMatriz) {
          return res.status(400).json({
            status: 'error',
            message: `Ya existe una sucursal matriz configurada: "${existingMatriz.nombre}". No se permite registrar múltiples matrices.`
          });
        }
      }

      let finalRazonSocial = razon_social;
      let finalRfc = rfc;
      let finalLicenciaCnbv = licencia_cnbv;

      // LÓGICA DE HERENCIA: Si es una sucursal secundaria, copiar automáticamente los datos fiscales de la matriz existente
      if (isMatrizVal === 0) {
        const matriz = db.prepare('SELECT razon_social, rfc, licencia_cnbv FROM sucursales WHERE es_matriz = 1 LIMIT 1').get() as any;
        if (matriz) {
          finalRazonSocial = finalRazonSocial || matriz.razon_social;
          finalRfc = finalRfc || matriz.rfc;
          finalLicenciaCnbv = finalLicenciaCnbv || matriz.licencia_cnbv;
        }
      }

      db.prepare(`
        INSERT INTO sucursales (
          sucursal_id, razon_social, nombre, rfc, calle, numero, colonia, ciudad, codigo_postal, telefono, email, licencia_cnbv, logo_url, es_matriz
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sucursal_id) DO UPDATE SET
          razon_social = excluded.razon_social,
          nombre = excluded.nombre,
          rfc = excluded.rfc,
          calle = excluded.calle,
          numero = excluded.numero,
          colonia = excluded.colonia,
          ciudad = excluded.ciudad,
          codigo_postal = excluded.codigo_postal,
          telefono = excluded.telefono,
          email = excluded.email,
          licencia_cnbv = excluded.licencia_cnbv,
          logo_url = excluded.logo_url,
          es_matriz = excluded.es_matriz
      `).run(
        id, 
        finalRazonSocial || '', 
        nombre, 
        finalRfc || '', 
        calle || '', 
        numero || '', 
        colonia || '', 
        ciudad || '', 
        codigo_postal || '', 
        telefono || '', 
        email || '', 
        finalLicenciaCnbv || '', 
        logo_url || '',
        isMatrizVal
      );

      const saved = db.prepare('SELECT * FROM sucursales WHERE sucursal_id = ?').get(id);
      res.json({ status: 'success', data: saved });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  app.post('/api/sucursales/push-fiscal', (req, res) => {
    try {
      const matriz = db.prepare('SELECT razon_social, rfc, licencia_cnbv FROM sucursales WHERE es_matriz = 1 LIMIT 1').get() as any;
      if (!matriz) {
        return res.status(404).json({ status: 'error', message: 'No se encontró ninguna sucursal matriz configurada para empujar datos fiscales.' });
      }

      const info = db.prepare(`
        UPDATE sucursales 
        SET razon_social = ?, rfc = ?, licencia_cnbv = ? 
        WHERE es_matriz = 0 OR es_matriz IS NULL
      `).run(matriz.razon_social, matriz.rfc, matriz.licencia_cnbv);

      res.json({
        status: 'success',
        message: `Se han propagado y sincronizado los datos fiscales de la matriz a ${info.changes} sucursales secundarias con éxito.`
      });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  app.post('/api/sucursales/upload-logo', (req, res) => {
    const { sucursal_id, logo_base64 } = req.body;

    if (!sucursal_id || !logo_base64) {
      return res.status(400).json({ status: 'error', message: 'sucursal_id y logo_base64 son requeridos.' });
    }

    try {
      // Parse base64 string
      const matches = logo_base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return res.status(400).json({ status: 'error', message: 'Formato de imagen base64 inválido.' });
      }

      const buffer = Buffer.from(matches[2], 'base64');
      const targetDir = path.join(process.cwd(), 'public', 'brand_assets', 'sucursales', sucursal_id);
      
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const filePath = path.join(targetDir, 'logo.png');
      fs.writeFileSync(filePath, buffer);

      const logoUrl = `/brand_assets/sucursales/${sucursal_id}/logo.png`;

      // Update in DB
      db.prepare('UPDATE sucursales SET logo_url = ? WHERE sucursal_id = ?').run(logoUrl, sucursal_id);

      res.json({ status: 'success', logo_url: logoUrl });
    } catch (error) {
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  app.post('/api/sucursales/sync', (req, res) => {
    // Invalidate Cache and return success
    res.json({ status: 'success', message: 'Sincronización de interfaz completada. Caché invalidada con éxito.' });
  });

  // --- LÓGICA DE PARTIDA DOBLE Y FIFO (SaaS ERP Core) ---
  const recordJournalEntry = (txId: string, description: string, entries: { account: string, debit: number, credit: number }[]) => {
    const stmt = db.prepare(`INSERT INTO Accounting_Journal (transaction_id, account_code, description, debit, credit) VALUES (?, ?, ?, ?, ?)`);
    entries.forEach(e => {
      stmt.run(txId, e.account, description, e.debit, e.credit);
      db.prepare(`UPDATE Accounting_Accounts SET balance = balance + ? - ? WHERE account_code = ?`).run(e.debit, e.credit, e.account);
    });
  };

  const process_fx_transaction = (
    ticketId: string, 
    partnerId: string, 
    ticketCode: string, 
    foreignAmount: number, 
    currentRate: number, 
    spreadMxn: number, 
    totalCommissionMxn: number
  ) => {
    const partner = db.prepare(`SELECT name FROM Partners WHERE partner_id = ?`).get(partnerId) as any;
    const partnerName = partner ? partner.name : 'Aliado';
    const totalValue = foreignAmount * currentRate;

    // Asiento automático: Cargo a Caja (1101) / Abono a Spread (4101) / Abono a Pasivo de Comisiones (2101)
    recordJournalEntry(ticketId, `Liquidación de Transacción Aliado [${ticketCode}] - ${partnerName}`, [
      { account: '1101', debit: totalValue, credit: 0 },
      { account: '4101', debit: 0, credit: spreadMxn },
      { account: '2101', debit: 0, credit: totalCommissionMxn }
    ]);
  };

  const processFIFO = (currency: string, quantityToSell: number, salePrice: number, txId: string) => {
    // Delega al módulo extraído (Fase 5) para que el fraccionamiento de lotes
    // sea testeable de forma aislada. Mantiene la misma firma y comportamiento.
    const resultado = ejecutarFIFO(db, currency, quantityToSell);
    return resultado.costoTotal;
  };

  // Módulo de Cierre: Revaluación de Inventario (Balance FIX)
  app.post('/api/accounting/eod-valuation', (req, res) => {
    const { fixRates } = req.body; // { 'USD': 17.50, 'EUR': 19.20 }
    
    try {
      db.transaction(() => {
        for (const [currency, fixPrice] of Object.entries(fixRates)) {
          // 1. Obtener saldo total en inventario (costo según FIFO)
          const result = db.prepare(`SELECT SUM(remaining_quantity) as total_qty, SUM(remaining_quantity * cost_basis) as total_cost FROM Inventory_Batches WHERE currency_code = ?`).get(currency) as any;
          
          if (result && result.total_qty > 0) {
            const currentTotalValue = result.total_qty * (fixPrice as number);
            const unrealizedGainLoss = currentTotalValue - result.total_cost;
            
            // 2. Registro Contable de Revaluación
            // Cargo/Abono a Inventario (1201) contra Utilidad/Pérdida Cambiaria (4101/5201)
            if (unrealizedGainLoss > 0) {
              recordJournalEntry('EOD-FIX', `Revaluación FIX ${currency}: Utilidad`, [
                { account: '1201', debit: unrealizedGainLoss, credit: 0 },
                { account: '4101', debit: 0, credit: unrealizedGainLoss }
              ]);
            } else if (unrealizedGainLoss < 0) {
              const loss = Math.abs(unrealizedGainLoss);
              recordJournalEntry('EOD-FIX', `Revaluación FIX ${currency}: Pérdida`, [
                { account: '5201', debit: loss, credit: 0 },
                { account: '1201', debit: 0, credit: loss }
              ]);
            }
          }
        }
      })();
      res.json({ status: 'success', message: 'Revaluación diaria completada' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- MÓDULO DE ALIADOS (PROGRAMA DE CAPTACIÓN) ---
  
  // 1. Crear Nuevo Aliado
  app.post('/api/partners', (req, res) => {
    const { name, phone, isWholesale } = req.body;
    try {
      const partnerId = `P_${Date.now()}`;
      const partnerCode = `M${Math.floor(100 + Math.random() * 899)}`;
      db.prepare(`INSERT INTO Partners (partner_id, name, phone, partner_code, is_wholesale) VALUES (?, ?, ?, ?, ?)`)
        .run(partnerId, name, phone, partnerCode, isWholesale ? 1 : 0);
      res.status(201).json({ partner_id: partnerId, partner_code: partnerCode });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 2. Pre-Registro de Captación (QR/Public Interface)
  app.post('/api/partners/pre-register', (req, res) => {
    const { partnerCode, amountUsd, customerName } = req.body;
    try {
      const partner = db.prepare(`SELECT partner_id FROM Partners WHERE partner_code = ? AND is_active = 1`).get(partnerCode) as any;
      if (!partner) return res.status(404).json({ error: 'Aliado no encontrado o inactivo' });

      const ticketCode = `TICKET-${Math.floor(1000 + Math.random() * 8999)}`;
      db.prepare(`INSERT INTO Affiliate_Pre_Registros (ticket_code, partner_id, affiliate_code, amount_usd, customer_name) VALUES (?, ?, ?, ?, ?)`)
        .run(ticketCode, partner.partner_id, partnerCode, amountUsd, customerName);
      
      res.status(201).json({ ticketCode, status: 'PENDIENTE' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 2.3 Validar Aliado por Token o UUID (Acceso Seguro)
  app.get('/api/partners/by-token', (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Token o código es requerido' });
    }
    try {
      const searchVal = (token as string).toUpperCase().trim();
      const partner = db.prepare(`
        SELECT * FROM Partners 
        WHERE (UPPER(partner_id) = ? OR UPPER(partner_code) = ?) AND is_active = 1
      `).get(searchVal, searchVal) as any;

      if (!partner) {
        return res.status(404).json({ error: 'Acceso denegado: Token inválido o inactivo.' });
      }

      res.json({
        partner_id: partner.partner_id,
        name: partner.name,
        phone: partner.phone,
        partner_code: partner.partner_code,
        is_wholesale: partner.is_wholesale === 1
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 2.5 Dashboard de Monitoreo para el Aliado (Consulta Pública con Seguridad)
  app.get('/api/partners/dashboard-stats', (req, res) => {
    const { partnerCode, token } = req.query;
    const identifier = (partnerCode || token || '') as string;
    if (!identifier) {
      return res.status(400).json({ error: 'Código de aliado o token requerido' });
    }
    try {
      const searchVal = identifier.toUpperCase().trim();
      const partner = db.prepare(`
        SELECT * FROM Partners 
        WHERE (UPPER(partner_code) = ? OR UPPER(partner_id) = ?) AND is_active = 1
      `).get(searchVal, searchVal) as any;
      
      if (!partner) {
        return res.status(404).json({ error: 'Aliado no encontrado o inactivo' });
      }

      const partnerId = partner.partner_id;

      // Primer día del mes actual para acumulados
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0,0,0,0);
      const startIso = startOfMonth.toISOString();

      // Total USD operado liquidado en el mes
      const stats = db.prepare(`
        SELECT COALESCE(SUM(amount_usd), 0) as total_usd
        FROM Affiliate_Pre_Registros
        WHERE partner_id = ? AND status = 'LIQUIDADO' AND created_at >= ?
      `).get(partnerId, startIso) as { total_usd: number };

      // Comisión acumulada de operaciones liquidadas
      const commStats = db.prepare(`
        SELECT COALESCE(SUM(total_commission_mxn), 0) as total_mxn
        FROM Aliado_Comisiones
        WHERE partner_id = ? AND accrued_at >= ?
      `).get(partnerId, startIso) as { total_mxn: number };

      // Obtener todos los tickets de pre-registro
      const tickets = db.prepare(`
        SELECT * FROM Affiliate_Pre_Registros
        WHERE partner_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `).all(partnerId) as any[];

      // Obtener recolecciones (Vault-as-a-Service)
      const recolecciones = db.prepare(`
        SELECT * FROM Partner_Recolecciones
        WHERE partner_id = ?
        ORDER BY created_at DESC
      `).all(partnerId) as any[];

      // Obtener cortes de comercio (Ventas Consolidadas)
      const cortes = db.prepare(`
        SELECT * FROM Partner_Cortes
        WHERE partner_id = ?
        ORDER BY created_at DESC
      `).all(partnerId) as any[];

      const totalUsdOperatedMonth = stats.total_usd;
      const earnedCommissionMxn = commStats.total_mxn;

      // Calcular comisiones estimadas para tickets individuales según el Tabulador Fijo por Evento:
      // Ticket de $100 a $300 USD -> $0.10 MXN por dólar
      // Ticket de $301 a $999 USD -> $0.15 MXN por dólar
      // Ticket >= $1,000 USD -> $0.20 MXN por dólar
      let pendingCommissionMxn = 0;
      const processedTickets = tickets.map(t => {
        let estimatedRate = 0;
        const amt = parseFloat(t.amount_usd);
        if (amt >= 1000) {
          estimatedRate = 0.20;
        } else if (amt >= 301) {
          estimatedRate = 0.15;
        } else if (amt >= 100) {
          estimatedRate = 0.10;
        } else {
          estimatedRate = 0.05; // Standard minor rate below 100 USD
        }
        
        const estComm = amt * estimatedRate;
        if (t.status === 'PENDIENTE') {
          pendingCommissionMxn += estComm;
        }
        return {
          ...t,
          estimated_rate: estimatedRate,
          estimated_commission_mxn: estComm
        };
      });

      res.json({
        partner: {
          partner_id: partner.partner_id,
          name: partner.name,
          partner_code: partner.partner_code,
          phone: partner.phone,
          is_wholesale: partner.is_wholesale === 1
        },
        totalUsdOperatedMonth,
        earnedCommissionMxn,
        pendingCommissionMxn,
        totalCommissionMxn: earnedCommissionMxn + pendingCommissionMxn,
        tickets: processedTickets,
        recolecciones,
        cortes
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 2.6 Registrar Recolección de Valores (Vault-as-a-Service para Mayoristas)
  app.post('/api/partners/recoleccion', (req, res) => {
    const { partnerId, packagesCount, safetySeals, photoUrl } = req.body;
    if (!partnerId) {
      return res.status(400).json({ error: 'ID de aliado requerido' });
    }
    try {
      db.prepare(`
        INSERT INTO Partner_Recolecciones (partner_id, packages_count, safety_seals, photo_url, status)
        VALUES (?, ?, ?, ?, 'Efectivo en Tránsito')
      `).run(partnerId, parseInt(packagesCount) || 1, safetySeals || '', photoUrl || '');

      res.status(201).json({ message: 'Solicitud de Recolección exitosa. Efectivo en Tránsito.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 2.7 Corte de Comercio para Mayoristas (Venta Consolidada Diaria)
  app.post('/api/partners/corte', (req, res) => {
    const { partnerId, amountUsd, commissionRate, commissionMxn } = req.body;
    if (!partnerId || !amountUsd) {
      return res.status(400).json({ error: 'Monto y aliado requeridos para el corte' });
    }
    try {
      db.prepare(`
        INSERT INTO Partner_Cortes (partner_id, amount_usd, commission_rate, commission_mxn, status)
        VALUES (?, ?, ?, ?, 'LIQUIDADO_CORTE')
      `).run(partnerId, parseFloat(amountUsd), parseFloat(commissionRate) || 0.20, parseFloat(commissionMxn) || 0);

      res.status(201).json({ message: 'Corte consolidado del comercio guardado y liquidado con éxito.' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 3. Validar Ticket de Captación (Cajero)
  app.get('/api/partners/tickets/:code', (req, res) => {
    try {
      const ticket = db.prepare(`
        SELECT t.*, p.name as partner_name, p.partner_code 
        FROM Affiliate_Pre_Registros t 
        JOIN Partners p ON t.partner_id = p.partner_id 
        WHERE t.ticket_code = ?
      `).get(req.params.code) as any;

      if (!ticket) {
        return res.status(404).json({ error: 'TICKET_NOT_FOUND', message: 'Ticket no registrado o inexistente' });
      }

      if (ticket.status === 'LIQUIDADO') {
        return res.status(400).json({ error: 'TICKET_ALREADY_PROCESSED', message: 'TICKET YA PROCESADO' });
      }

      if (ticket.status !== 'PENDIENTE') {
        return res.status(400).json({ error: 'TICKET_NOT_PENDING', message: 'El ticket no está pendiente' });
      }

      res.json(ticket);
    } catch (error) {
      res.status(500).json({ error: 'SERVER_ERROR', message: (error as Error).message });
    }
  });

  // 3.1 Listar Aliados (Directorio)
  app.get('/api/partners/list', (req, res) => {
    try {
      const partners = db.prepare(`SELECT * FROM Partners ORDER BY created_at DESC`).all();
      res.json(partners);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 3.2 Historial de Comisiones por Aliado
  app.get('/api/partners/:id/history', (req, res) => {
    try {
      const history = db.prepare(`SELECT * FROM Aliado_Comisiones WHERE partner_id = ? ORDER BY accrued_at DESC LIMIT 50`).all(req.params.id);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // 4. Función de Cálculo de Comisión Escalafonaria (Motor de Negocio)
  const calculateTieredCommission = (partnerId: string, amountUsd: number) => {
    // Modelo de Tasas Fijas por Evento:
    // Regla de Oro: Ticket >= $1,000 USD -> $0.20 MXN por dólar
    if (amountUsd >= 1000) return 0.20;
    
    // Ticket de $301 a $999 USD -> $0.15 MXN por dólar
    if (amountUsd >= 301) return 0.15;
    
    // Ticket de $100 a $300 USD -> $0.10 MXN por dólar
    if (amountUsd >= 100) return 0.10;
    
    // Menos de $100 USD -> $0.05 MXN por dólar
    return 0.05;
  };

  // --- SEGURIDAD FINANCIERA: MONITOREO DE SALDOS Y BLOQUEO AUTOMÁTICO ---
  const checkAndSetTerminalLocks = (branchId: string) => {
    try {
      const thresholds = db.prepare(`SELECT * FROM security_thresholds WHERE sucursal_id = ?`).all(branchId) as any[];
      let isAnyExceeded = false;
      let exceededCurrencies: Array<{ currency: string; balance: number; limit: number }> = [];

      for (const t of thresholds) {
        const balanceRow = db.prepare(`
          SELECT COALESCE(SUM(remaining_quantity), 0) as total_qty 
          FROM Inventory_Batches 
          WHERE currency_code = ? AND branch_id = ?
        `).get(t.divisa, branchId) as any;

        const totalBalance = balanceRow?.total_qty || 0;
        if (totalBalance > t.monto_maximo) {
          isAnyExceeded = true;
          exceededCurrencies.push({
            currency: t.divisa,
            balance: totalBalance,
            limit: t.monto_maximo
          });
        }
      }

      let terminal = db.prepare(`SELECT * FROM terminales WHERE sucursal_id = ?`).get(branchId) as any;
      if (!terminal) {
        db.prepare(`INSERT INTO terminales (terminal_id, sucursal_id, terminal_locked, warning_count, last_warning_at) VALUES (?, ?, ?, ?, ?)`).run(
          `TERM-${branchId}`,
          branchId,
          0,
          0,
          null
        );
        terminal = db.prepare(`SELECT * FROM terminales WHERE sucursal_id = ?`).get(branchId) as any;
      }

      if (isAnyExceeded) {
        const now = new Date();
        let warningCount = terminal.warning_count;
        let lastWarningAtStr = terminal.last_warning_at;
        let locked = terminal.terminal_locked;

        if (warningCount === 0) {
          warningCount = 1;
          lastWarningAtStr = now.toISOString();
        } else {
          const lastWarningAt = new Date(lastWarningAtStr);
          const elapsedMs = now.getTime() - lastWarningAt.getTime();
          const elapsedIntervals = Math.floor(elapsedMs / (1000 * 60 * 10)); // 10 minutes

          if (elapsedIntervals > 0) {
            warningCount = Math.min(3, warningCount + elapsedIntervals);
            const updatedTime = new Date(lastWarningAt.getTime() + elapsedIntervals * 10 * 60 * 1000);
            lastWarningAtStr = updatedTime.toISOString();
          }
        }

        if (warningCount >= 3) {
          locked = 1;
        }

        db.prepare(`
          UPDATE terminales 
          SET warning_count = ?, terminal_locked = ?, last_warning_at = ? 
          WHERE sucursal_id = ?
        `).run(warningCount, locked, lastWarningAtStr, branchId);

        return {
          locked: locked === 1,
          warningCount,
          lastWarningAt: lastWarningAtStr,
          exceeded: true,
          exceededCurrencies
        };
      } else {
        db.prepare(`
          UPDATE terminales 
          SET warning_count = 0, terminal_locked = 0, last_warning_at = NULL 
          WHERE sucursal_id = ?
        `).run(branchId);

        return {
          locked: false,
          warningCount: 0,
          lastWarningAt: null,
          exceeded: false,
          exceededCurrencies: []
        };
      }
    } catch (error) {
      console.error("Error in checkAndSetTerminalLocks:", error);
      return {
        locked: false,
        warningCount: 0,
        lastWarningAt: null,
        exceeded: false,
        exceededCurrencies: []
      };
    }
  };

  app.get("/api/terminal/status", (req, res) => {
    try {
      const userId = req.headers['x-user-id'] || 'user_cajero_1';
      const profile = db.prepare('SELECT branch_id FROM User_Profiles WHERE auth_user_id = ?').get(userId) as any;
      if (!profile) {
        return res.status(404).json({ status: "error", message: "User profile not found" });
      }
      const branchId = profile.branch_id;
      const status = checkAndSetTerminalLocks(branchId);
      res.json({
        status: "success",
        ...status
      });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.get("/api/security-thresholds", (req, res) => {
    try {
      const thresholds = db.prepare(`SELECT * FROM security_thresholds`).all();
      res.json({ status: "success", thresholds });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.post("/api/security-thresholds", (req, res) => {
    try {
      const { sucursal_id, divisa, monto_maximo } = req.body;
      if (!sucursal_id || !divisa || monto_maximo === undefined) {
        return res.status(400).json({ status: "error", message: "Missing required fields" });
      }
      db.prepare(`
        INSERT INTO security_thresholds (sucursal_id, divisa, monto_maximo)
        VALUES (?, ?, ?)
        ON CONFLICT(sucursal_id, divisa) DO UPDATE SET monto_maximo = excluded.monto_maximo
      `).run(sucursal_id, divisa, parseFloat(monto_maximo));

      checkAndSetTerminalLocks(sucursal_id);

      res.json({ status: "success", message: "Límite de seguridad guardado correctamente." });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.post("/api/transactions/retiro", (req, res) => {
    try {
      const { currency, amount } = req.body;
      if (!currency || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ status: "error", message: "Missing or invalid fields" });
      }

      const userId = req.headers['x-user-id'] || 'user_cajero_1';
      const profile = db.prepare('SELECT branch_id FROM User_Profiles WHERE auth_user_id = ?').get(userId) as any;
      if (!profile) {
        return res.status(404).json({ status: "error", message: "User profile not found" });
      }
      const branchId = profile.branch_id;
      const amt = parseFloat(amount);

      const balanceRow = db.prepare(`
        SELECT COALESCE(SUM(remaining_quantity), 0) as total_qty 
        FROM Inventory_Batches 
        WHERE currency_code = ? AND branch_id = ?
      `).get(currency, branchId) as any;

      const currentBalance = balanceRow?.total_qty || 0;
      if (currentBalance < amt) {
        return res.status(400).json({ status: "error", message: `Saldo insuficiente en caja para retirar ${amt} ${currency}. Saldo actual: ${currentBalance}` });
      }

      db.transaction(() => {
        const ticketId = `RET-${Math.floor(100000 + Math.random() * 900000)}`;

        let remaining = amt;
        let totalCostBasis = 0;
        const batches = db.prepare(`
          SELECT * FROM Inventory_Batches 
          WHERE currency_code = ? AND branch_id = ? AND remaining_quantity > 0 
          ORDER BY created_at ASC
        `).all(currency, branchId) as any[];

        for (const batch of batches) {
          const takeFromBatch = Math.min(remaining, batch.remaining_quantity);
          totalCostBasis += takeFromBatch * batch.cost_basis;
          db.prepare(`UPDATE Inventory_Batches SET remaining_quantity = remaining_quantity - ? WHERE id = ?`).run(takeFromBatch, batch.id);
          remaining -= takeFromBatch;
          if (remaining <= 0) break;
        }

        db.prepare(`
          INSERT INTO Operaciones_Liquidacion_P2P (
            id, customer_id, client_name, currency_in, amount_in, method_in, 
            currency_out, amount_out, method_out, rate, markup, status, transfer_bank_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ticketId,
          null,
          'RETIRO DE CAJA A BÓVEDA',
          currency,
          amt,
          'CASH',
          currency,
          amt,
          'RETIRO',
          1,
          0,
          'COMPLETED',
          'Boveda Central'
        );

        db.prepare(`
          UPDATE Boveda 
          SET balance = balance + ?, last_update = CURRENT_TIMESTAMP 
          WHERE currency = ?
        `).run(amt, currency);

        recordJournalEntry(ticketId, `Retiro de caja a Bóveda: ${amt} ${currency}`, [
          { account: '1101', debit: amt, credit: 0 },
          { account: '1201', debit: 0, credit: totalCostBasis }
        ]);
      })();

      const lockStatus = checkAndSetTerminalLocks(branchId);

      res.json({
        status: "success",
        message: "Retiro realizado con éxito. El inventario ha sido resguardado en la Bóveda.",
        lockStatus
      });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // Background threshold & warning increment checker
  setInterval(() => {
    try {
      const branches = db.prepare(`SELECT sucursal_id FROM sucursales`).all() as any[];
      for (const b of branches) {
        checkAndSetTerminalLocks(b.sucursal_id);
      }
    } catch (e) {
      console.error("Error in background threshold checker:", e);
    }
  }, 10000); // Check every 10 seconds

  // 5. Inyección en el flujo de cierre de transacción
  // (Esta parte reemplaza la lógica simplificada previa en /api/transactions/close)
  app.post("/api/transactions/close", upload.fields([
    { name: 'incomingReceipt', maxCount: 1 },
    { name: 'outgoingReceipt', maxCount: 1 }
  ]), (req, res) => {
    const { 
      clientName, 
      customerId,
      currencyIn,
      methodIn,
      currencyOut,
      methodOut,
      amountIn,
      amountOut,
      rate,
      markup,
      // Denominations Breakdown (JSON strings)
      denominationsIn,
      denominationsOut,
      // Incoming Transfer Details
      incomingBankName,
      incomingAccountNumber,
      incomingPayerName,
      incomingDate,
      incomingTrackingId,
      incomingTxid,
      // Outgoing Transfer Details
      outgoingBankName,
      outgoingAccountNumber,
      outgoingPayerName,
      outgoingDate,
      outgoingTrackingId,
      outgoingTxid,
      partnerId, // ID de Aliado Estratégico (Directo)
      ticketCode // Nuevo: Código de pre-registro
    } = req.body;
    
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const incomingReceipt = files?.incomingReceipt?.[0];
    const outgoingReceipt = files?.outgoingReceipt?.[0];
    
    const incomingReceiptUrl = incomingReceipt ? `/uploads/${incomingReceipt.filename}` : null;
    const outgoingReceiptUrl = outgoingReceipt ? `/uploads/${outgoingReceipt.filename}` : null;
    
    // 1. Validation Logic
    if (!clientName || !currencyIn || !currencyOut || !amountIn || !amountOut) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }

    try {
      const userId = req.headers['x-user-id'] || 'user_cajero_1';
      const profile = db.prepare('SELECT branch_id, role_level, custom_permissions FROM User_Profiles WHERE auth_user_id = ?').get(userId) as any;
      
      if (!profile) throw new Error('Usuario no autorizado: Perfil inexistente');
      if (profile.role_level < 2) throw new Error('Nivel de autorización insuficiente para registrar operaciones');

      const perms = JSON.parse(profile.custom_permissions || '{}');
      const branchId = profile.branch_id;

      // Validar Límite de Marcaje (TC)
      if (parseFloat(markup) > perms.tc_limit) {
        throw new Error(`Excede el límite de marcaje permitido (${perms.tc_limit}%)`);
      }

      const ticketId = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
      
      const denomsInArray = denominationsIn ? JSON.parse(denominationsIn) : [];
      const denomsOutArray = denominationsOut ? JSON.parse(denominationsOut) : [];

      // 2. PostgreSQL Logic (Simulated with SQLite for MVP)
      const ticketResult = db.transaction(() => {
        // Enforce B2B / Flujo Kappa monthly limit of $14,000 USD
        const amtIn = parseFloat(amountIn);
        const amtOut = parseFloat(amountOut);
        
        if (customerId) {
          const clientData = db.prepare('SELECT * FROM Customers WHERE id = ?').get(customerId) as any;
          if (clientData && clientData.is_b2b === 1) {
            let usdAmountOfTransaction = 0;
            if (currencyIn === 'USD') {
              usdAmountOfTransaction = amtIn;
            } else if (currencyOut === 'USD') {
              usdAmountOfTransaction = amtOut;
            } else {
              // Approximate other currencies to USD via MXN pivot
              const rateInData = redisRates[`${currencyIn}_MXN` as keyof typeof redisRates] || { buy: 18.5 };
              const mxnVal = amtIn * rateInData.buy;
              usdAmountOfTransaction = mxnVal / (redisRates['USD_MXN']?.sell || 19.5);
            }

            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0,0,0,0);

            const monthTxIn = db.prepare(`
              SELECT SUM(amount_in) as total 
              FROM Operaciones_Captacion 
              WHERE customer_id = ? AND currency_in = 'USD' AND created_at >= ? AND status = 'COMPLETED'
            `).get(customerId, startOfMonth.toISOString()) as any;

            const monthTxOut = db.prepare(`
              SELECT SUM(amount_out) as total 
              FROM Operaciones_Liquidacion_P2P 
              WHERE customer_id = ? AND currency_out = 'USD' AND created_at >= ? AND status = 'COMPLETED'
            `).get(customerId, startOfMonth.toISOString()) as any;

            const totalUsdSpentThisMonth = (monthTxIn?.total || 0) + (monthTxOut?.total || 0);

            if (totalUsdSpentThisMonth + usdAmountOfTransaction > 14000) {
              throw new Error(`Operación bloqueada (Límite B2B excedido): El cliente B2B ha acumulado $${totalUsdSpentThisMonth.toFixed(2)} USD este mes. Esta operación de $${usdAmountOfTransaction.toFixed(2)} USD superaría el límite de $14,000 USD del Flujo Kappa.`);
            }
          }
        }

        // Validation: Sufficient stock for outgoing CASH
        if (methodOut === 'CASH') {
          // 1. Validar saldo total de bóveda para la divisa de salida
          const boveda = db.prepare('SELECT balance FROM Boveda WHERE currency = ?').get(currencyOut) as any;
          const saldoBoveda = boveda?.balance || 0;
          if (saldoBoveda < parseFloat(amountOut)) {
            throw new Error(`Existencia insuficiente de ${currencyOut} en bóveda. Saldo actual: ${saldoBoveda}. Se requieren: ${amountOut}. Solicite una dotación de emergencia.`);
          }

          // 2. Validar denominaciones individuales si se proporcionaron
          if (denomsOutArray.length > 0) {
            for (const d of denomsOutArray) {
              const stock = db.prepare("SELECT quantity FROM Inventario_Boveda_Detalle WHERE currency = ? AND denominacion = ? AND branch_id = ?").get(currencyOut, d.denominacion, branchId);
              if (!stock || stock.quantity < d.quantity) {
                throw new Error(`Existencia insuficiente (${stock?.quantity || 0}) para la denominación de ${d.denominacion} ${currencyOut}. Solicite una dotación de emergencia.`);
              }
            }
          }
        }

        // Insert into Captacion (What we receive)
        db.prepare(`
          INSERT INTO Operaciones_Captacion (
            id, customer_id, client_name, currency_in, amount_in, method_in, 
            currency_out, amount_out, method_out, rate, markup, 
            transfer_bank_name, transfer_account_number, transfer_payer_name, 
            transfer_date, transfer_tracking_id, transfer_txid, transfer_receipt_url,
            status, settlement_status, branch_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ticketId, 
          customerId, 
          clientName, 
          currencyIn, 
          amountIn, 
          methodIn, 
          currencyOut, 
          amountOut, 
          methodOut, 
          rate, 
          markup, 
          incomingBankName || null,
          incomingAccountNumber || null,
          incomingPayerName || null,
          incomingDate || null,
          incomingTrackingId || null,
          incomingTxid || null,
          incomingReceiptUrl,
          'COMPLETED',
          currencyIn === 'MXN' ? 'N/A' : 'PENDING',
          branchId
        );

        // Insert into Liquidacion (What we deliver)
        db.prepare(`
          INSERT INTO Operaciones_Liquidacion_P2P (
            id, customer_id, client_name, currency_in, amount_in, method_in, 
            currency_out, amount_out, method_out, rate, markup,
            transfer_bank_name, transfer_account_number, transfer_payer_name, 
            transfer_date, transfer_tracking_id, transfer_txid, transfer_receipt_url,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ticketId, 
          customerId, 
          clientName, 
          currencyIn, 
          amountIn, 
          methodIn, 
          currencyOut, 
          amountOut, 
          methodOut, 
          rate, 
          markup, 
          outgoingBankName || null,
          outgoingAccountNumber || null,
          outgoingPayerName || null,
          outgoingDate || null,
          outgoingTrackingId || null,
          outgoingTxid || null,
          outgoingReceiptUrl,
          methodOut === 'TRANSFER' ? 'PENDING_DISBURSEMENT' : 'COMPLETED'
        );

        // Handle Denominations Detail and Stock
        if (methodIn === 'CASH' && denomsInArray.length > 0) {
          for (const d of denomsInArray) {
            db.prepare('INSERT INTO Operaciones_Denominaciones_Detalle (operation_id, direction, currency, denominacion, quantity) VALUES (?, ?, ?, ?, ?)')
              .run(ticketId, 'IN', currencyIn, d.denominacion, d.quantity);
            
            db.prepare("UPDATE Inventario_Boveda_Detalle SET quantity = quantity + ?, last_update = CURRENT_TIMESTAMP WHERE currency = ? AND denominacion = ? AND branch_id = ?")
              .run(d.quantity, currencyIn, d.denominacion, branchId);
          }
          db.prepare('UPDATE Boveda SET balance = balance + ?, last_update = CURRENT_TIMESTAMP WHERE currency = ?').run(amountIn, currencyIn);
        }

        if (methodOut === 'CASH' && denomsOutArray.length > 0) {
          for (const d of denomsOutArray) {
            db.prepare('INSERT INTO Operaciones_Denominaciones_Detalle (operation_id, direction, currency, denominacion, quantity) VALUES (?, ?, ?, ?, ?)')
              .run(ticketId, 'OUT', currencyOut, d.denominacion, d.quantity);
            
            db.prepare("UPDATE Inventario_Boveda_Detalle SET quantity = quantity - ?, last_update = CURRENT_TIMESTAMP WHERE currency = ? AND denominacion = ? AND branch_id = ?")
              .run(d.quantity, currencyOut, d.denominacion, branchId);
          }
          db.prepare('UPDATE Boveda SET balance = balance - ?, last_update = CURRENT_TIMESTAMP WHERE currency = ?').run(amountOut, currencyOut);
        }

        // If it's a transfer/wallet delivery, it goes to the Liquidacion Queue for Treasury
        if (methodOut === 'TRANSFER') {
          db.prepare(`
            INSERT INTO Liquidacion_Tickets (
              id, 
              customer_id,
              client_name, 
              base_currency, 
              base_amount, 
              quote_currency, 
              quote_amount, 
              markup, 
              delivery_method, 
              destination_bank, 
              destination_account, 
              wallet_address,
              transfer_receipt_url,
              status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            ticketId, 
            customerId,
            clientName, 
            currencyOut, 
            amountOut, 
            currencyIn, 
            amountIn, 
            markup || 0,
            methodOut,
            outgoingBankName || null,
            outgoingAccountNumber || null,
            outgoingTxid || null, // TXID used as wallet address if applicable
            outgoingReceiptUrl,
            'PENDING'
          );
        }

        // 3. CORE ERP & FIFO INTEGRATION (AI AGENT INJECTION)
        const currentRate = parseFloat(rate);

        // Caso A: COMPRA DE DIVISA (Entra Divisa, Sale MXN)
        if (currencyIn !== 'MXN') {
          // Crear lote FIFO (Costo = Precio Pagado en MXN)
          db.prepare(`INSERT INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, reference_op_id, branch_id) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(currencyIn, amtIn, amtIn, currentRate, ticketId, branchId);

          // Partida Doble: Cargo Inventario (1201), Abono Caja (1101)
          const valueInMXN = amtIn * currentRate;
          recordJournalEntry(ticketId, `Compra ${amtIn} ${currencyIn} @ ${currentRate}`, [
            { account: '1201', debit: valueInMXN, credit: 0 },
            { account: '1101', debit: 0, credit: valueInMXN }
          ]);
        }

        // Caso B: VENTA DE DIVISA (Entra MXN, Sale Divisa)
        if (currencyOut !== 'MXN') {
          // Valuación FIFO
          const totalCostBasis = processFIFO(currencyOut, amtOut, currentRate, ticketId);
          const totalSaleValue = amtOut * currentRate;
          const realizedProfit = totalSaleValue - totalCostBasis;

          // Partida Doble: Cargo Caja (1101), Abono Inventario (1201), Abono Utilidad (4101)
          recordJournalEntry(ticketId, `Venta ${amtOut} ${currencyOut} @ ${currentRate}`, [
            { account: '1101', debit: totalSaleValue, credit: 0 },
            { account: '1201', debit: 0, credit: totalCostBasis },
            { account: '4101', debit: 0, credit: realizedProfit }
          ]);
        }

        // Caso C: ALIADOS Y COMISIONES (MOTOR ESCALAFONARIO)
        let activePartnerId = partnerId;
        
        // C.1 Si es via TICKET de captación
        if (ticketCode) {
          const preReg = db.prepare(`SELECT partner_id, amount_usd, customer_name, affiliate_code FROM Affiliate_Pre_Registros WHERE ticket_code = ? AND status = 'PENDIENTE'`).get(ticketCode) as any;
          if (preReg) {
            activePartnerId = preReg.partner_id;
            db.prepare(`UPDATE Affiliate_Pre_Registros SET status = 'LIQUIDADO' WHERE ticket_code = ?`).run(ticketCode);

            // DISPARO DE WEBHOOK EN TIEMPO REAL (Supabase Simulation Webhook)
            const webhookUrl = process.env.SUPABASE_WEBHOOK_URL || 'https://api.supabase.co/v1/webhooks/partners';
            console.log(`\n======================================================`);
            console.log(`[REALTIME WEBHOOK TRIGGERED] Dispatching to ${webhookUrl}`);
            console.log(`EVENT: ticket.liquidated`);
            console.log(`PARTNER_CODE: ${preReg.affiliate_code || 'N/A'}`);
            console.log(`TICKET: ${ticketCode}`);
            console.log(`AMOUNT: $${preReg.amount_usd} USD`);
            console.log(`CUSTOMER: ${preReg.customer_name}`);
            console.log(`STATUS: LIQUIDADO`);
            console.log(`TIMESTAMP: ${new Date().toISOString()}`);
            console.log(`======================================================\n`);
          }
        }

        if (activePartnerId) {
          const partner = db.prepare(`SELECT * FROM Partners WHERE partner_id = ?`).get(activePartnerId) as any;
          if (partner) {
            const foreignAmount = (currencyIn !== 'MXN' ? amtIn : amtOut);
            const commissionPerUsd = calculateTieredCommission(activePartnerId, foreignAmount);
            const totalCommissionMxn = foreignAmount * commissionPerUsd;
            
            // 3.1 Motor de Spread (PEPS / FIFO)
            let spreadMxn = 0;
            if (currencyIn !== 'MXN') {
              // Compra: Se calcula el margen/spread estimando la diferencia contra el tipo de cambio de venta (liquidity rate)
              const sellRate = redisRates[`${currencyIn}_MXN` as keyof typeof redisRates]?.sell || 19.55;
              const spread = sellRate - currentRate;
              spreadMxn = spread * foreignAmount;
              
              if (spreadMxn > 0) {
                // Registrar contablemente en la cuenta 4101 "Ingreso por Spread Cambiario"
                recordJournalEntry(ticketId, `Spread de Compra Pre-Captura [${ticketCode || 'DIRECTO'}]: $${spread.toFixed(4)}/USD`, [
                  { account: '1101', debit: spreadMxn, credit: 0 },
                  { account: '4101', debit: 0, credit: spreadMxn }
                ]);
              }
            } else {
              // Venta: Se calcula el spread real barriendo los lotes más antiguos de Inventory_Batches (PEPS)
              const batches = db.prepare(`SELECT * FROM Inventory_Batches WHERE currency_code = ? AND remaining_quantity > 0 ORDER BY created_at ASC`).all(currencyOut) as any[];
              let remaining = foreignAmount;
              let costBasis = 0;
              for (const batch of batches) {
                const take = Math.min(remaining, batch.remaining_quantity);
                costBasis += take * batch.cost_basis;
                remaining -= take;
                if (remaining <= 0) break;
              }
              const totalSaleVal = foreignAmount * currentRate;
              spreadMxn = totalSaleVal - costBasis;
              
              // El spread de la venta ya se registró en el Caso B en la cuenta 4101, así que evitamos doble registro contable directo, pero lo guardamos para el reporte de comisiones.
            }

            if (spreadMxn < 0) spreadMxn = 0;

            if (totalCommissionMxn > 0) {
              db.prepare(`
                INSERT INTO Aliado_Comisiones (partner_id, operation_id, ticket_code, amount_usd, commission_per_usd, total_commission_mxn, spread_mxn) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(activePartnerId, ticketId, ticketCode || 'DIRECTO', foreignAmount, commissionPerUsd, totalCommissionMxn, spreadMxn);

              // Registro Contable (Partida Doble): Cargo Gasto Comisiones (5101), Abono Pasivo Aliados (2101)
              recordJournalEntry(ticketId, `Comisión Aliado [${partner.name}]: $${commissionPerUsd}/USD`, [
                { account: '5101', debit: totalCommissionMxn, credit: 0 },
                { account: '2101', debit: 0, credit: totalCommissionMxn }
              ]);
            }

            // Inserción en fx_transactions para trazabilidad histórica de liquidaciones
            db.prepare(`
              INSERT INTO fx_transactions (id, affiliate_id, ticket_code, amount_usd, amount_mxn, rate, spread_mxn, commission_mxn, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'LIQUIDADO')
            `).run(
              ticketId, 
              activePartnerId, 
              ticketCode || 'DIRECTO', 
              foreignAmount, 
              foreignAmount * currentRate, 
              currentRate, 
              spreadMxn, 
              totalCommissionMxn
            );

            // Asientos contables automáticos ERP (Cargo a Caja / Abono a Spread / Abono a Pasivo de Comisiones)
            process_fx_transaction(ticketId, activePartnerId, ticketCode || 'DIRECTO', foreignAmount, currentRate, spreadMxn, totalCommissionMxn);
          }
        }

        return ticketId;
      });

      ticketResult();

      // Recalculate security thresholds and terminal locks
      const lockStatus = checkAndSetTerminalLocks(branchId);

      console.log(`[FX TRADER] Operation Closed: ${ticketId} | ${amountIn} ${currencyIn} (${methodIn}) -> ${amountOut} ${currencyOut} (${methodOut})`);

      // Get branch details from sucursales
      let branchInfo = db.prepare('SELECT * FROM sucursales WHERE sucursal_id = ?').get(branchId) as any;
      if (!branchInfo) {
        branchInfo = db.prepare('SELECT * FROM sucursales WHERE sucursal_id = ?').get('MAIN_BRANCH') as any;
      }

      const cashierName = profile.nickname || "Admin User";

      // 3. Return structured JSON for Ticket Printing
      res.json({
        status: "success",
        message: "Transaction recorded and routed to Treasury if digital",
        lockStatus,
        ticket: {
          ticketId,
          client: clientName,
          ticketCode: ticketCode || null,
          currencyIn,
          methodIn,
          amountIn,
          currencyOut,
          methodOut,
          amountOut,
          rate: parseFloat(rate),
          markup,
          incomingTransfer: methodIn === 'TRANSFER' ? {
            bank: incomingBankName,
            account: incomingAccountNumber,
            payer: incomingPayerName,
            date: incomingDate,
            trackingId: incomingTrackingId,
            txid: incomingTxid,
            receiptUrl: incomingReceiptUrl
          } : null,
          outgoingTransfer: methodOut === 'TRANSFER' ? {
            bank: outgoingBankName,
            account: outgoingAccountNumber,
            payer: outgoingPayerName,
            date: outgoingDate,
            trackingId: outgoingTrackingId,
            txid: outgoingTxid,
            receiptUrl: outgoingReceiptUrl
          } : null,
          status: methodOut === 'TRANSFER' ? 'PENDING_DISBURSEMENT' : 'COMPLETED',
          timestamp: new Date().toISOString(),
          branch: branchInfo ? branchInfo.nombre : "Sucursal Matriz - Centro",
          branchDetails: branchInfo || {
            nombre: "Sucursal Matriz - Centro",
            razon_social: "FINTECH SOLUTIONS S.A. DE C.V.",
            rfc: "FSO121205ABC",
            calle: "Av. Paseo de la Reforma",
            numero: "222",
            colonia: "Juárez",
            ciudad: "Ciudad de México",
            codigo_postal: "06600",
            telefono: "5555555555",
            email: "matriz@fintechsolutions.mx",
            licencia_cnbv: "CNBV-LIC-100293-2024",
            logo_url: ""
          },
          cajero: cashierName,
          legalDisclaimer: "Esta operación está sujeta a liquidación por tesorería si es digital. Conserve este comprobante."
        }
      });
    } catch (error) {
      console.error("Error closing transaction:", error);
      res.status(500).json({ status: "error", message: "Database error" });
    }
  });

  // Treasury Queue Endpoint
  app.get("/api/treasury/queue", (req, res) => {
    try {
      const queue = db.prepare(`SELECT * FROM Liquidacion_Tickets WHERE status = 'PENDING' ORDER BY created_at DESC`).all();
      res.json({ status: "success", data: queue });
    } catch (error) {
      res.status(500).json({ status: "error", message: "Error fetching queue" });
    }
  });

  // Get System Config (Markup)
  app.get("/api/config/fx", (req, res) => {
    res.json({ status: "success", config: systemConfig });
  });

  app.get("/api/config/denominations/:currency", (req, res) => {
    const { currency } = req.params;
    try {
      const denoms = db.prepare('SELECT denominacion, type FROM Cat_Denominaciones WHERE currency = ? AND status = "ACTIVE" ORDER BY denominacion DESC').all(currency);
      res.json({ status: "success", data: denoms });
    } catch (error) {
      res.status(500).json({ status: "error", message: "Error fetching denominations" });
    }
  });

  // Mock MongoDB Document Expedientes
  app.get("/api/compliance/documents/:clientId", (req, res) => {
    // Simulated MongoDB fetch
    res.json({
      status: "success",
      source: "MongoDB Expedientes",
      clientId: req.params.clientId,
      documents: [
        { type: "ID", status: "VERIFIED", uploadedAt: "2023-01-15T10:00:00Z" },
        { type: "PROOF_OF_ADDRESS", status: "PENDING_REVIEW", uploadedAt: "2023-10-20T14:30:00Z" }
      ]
    });
  });

  // --- BaaS (Banking-as-a-Service) Module Data Structures ---
  // Data is now unified in SQLite database (baas_platform.db)

  // --- BaaS Endpoints ---

  // BaaS: Dashboard Data (Unified with SQLite)
  app.get("/api/baas/dashboard", (req, res) => {
    try {
      // Fetch all VIP customers
      const customers = db.prepare(`
        SELECT * FROM Customers WHERE is_vip = 1 ORDER BY created_at DESC
      `).all();

      const dashboardData = customers.map((customer: any) => {
        // Fetch wallet
        const wallet = db.prepare('SELECT * FROM Wallets WHERE customer_id = ?').get(customer.id);
        
        // Fetch card
        const card = db.prepare('SELECT * FROM Cards WHERE customer_id = ?').get(customer.id);
        
        // Fetch compliance expediente
        const compliance = db.prepare('SELECT * FROM Compliance_Expedientes WHERE customer_id = ?').get(customer.id);
        
        return {
          id: customer.id,
          name: customer.full_name,
          email: customer.email,
          phone: customer.phone,
          status: wallet?.status || 'ACTIVE',
          createdAt: customer.created_at,
          wallet: wallet ? {
            id: wallet.id,
            balances: {
              MXN: wallet.balance_mxn,
              USD: wallet.balance_usd,
              USDT: wallet.balance_usdt
            }
          } : null,
          card: card ? {
            id: card.id,
            cardNumber: card.card_number,
            type: card.type,
            status: card.status
          } : null,
          compliance: compliance ? {
            riskScore: compliance.risk_score,
            verified: compliance.verified === 1
          } : {
            riskScore: 'PENDING',
            verified: false
          }
        };
      });

      // Fetch global totals
      const totals = db.prepare(`
        SELECT 
          SUM(balance_mxn) as total_mxn,
          SUM(balance_usd) as total_usd,
          SUM(balance_usdt) as total_usdt
        FROM Wallets
      `).get();

      res.json({
        status: "success",
        source: "BaaS Ecosystem (PostgreSQL Unified Schema)",
        data: dashboardData,
        totals: {
          MXN: totals.total_mxn || 0,
          USD: totals.total_usd || 0,
          USDT: totals.total_usdt || 0
        }
      });
    } catch (error) {
      console.error("Error fetching BaaS dashboard:", error);
      res.status(500).json({ status: "error", message: "Error al cargar el dashboard de BaaS" });
    }
  });

  // Register VIP User
  // BaaS: Exclusive VIP Registration (Admin Only)
  app.post("/api/baas/vip-users", checkRole(['admin']), (req, res) => {
    const { 
      fullName, 
      email, 
      phone, 
      initialBalanceMXN,
      estimatedMonthlyAmount, 
      estimatedOperations, 
      sourceDestinationFunds 
    } = req.body;

    if (!fullName) {
      return res.status(400).json({ status: "error", message: "Full name is required" });
    }

    try {
      const customerId = `CUST-VIP-${Math.floor(100000 + Math.random() * 900000)}`;
      
      db.transaction(() => {
        // 1. Create Customer
        db.prepare(`
          INSERT INTO Customers (
            id, full_name, email, phone, is_vip,
            estimated_monthly_amount, 
            estimated_operations_per_month, 
            source_destination_funds
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          customerId, 
          fullName, 
          email || null, 
          phone || null, 
          1, // Always 1 for VIP registration
          estimatedMonthlyAmount || 0, 
          estimatedOperations || 0, 
          sourceDestinationFunds || null
        );

        // 2. Create Wallet
        const walletId = `WLT-${Math.floor(100000 + Math.random() * 900000)}`;
        db.prepare(`
          INSERT INTO Wallets (id, customer_id, balance_mxn, balance_usd, balance_usdt)
          VALUES (?, ?, ?, ?, ?)
        `).run(walletId, customerId, initialBalanceMXN || 0, 0, 0);

        // 3. Create Compliance Expediente
        db.prepare(`
          INSERT INTO Compliance_Expedientes (customer_id, risk_score, verified)
          VALUES (?, ?, ?)
        `).run(customerId, 'LOW', 1); // Auto-verify for demo/MVP
      })();

      console.log(`[BaaS] VIP Registered: ${customerId} | ${fullName}`);

      res.json({
        status: "success",
        message: "VIP Customer, Wallet and Compliance created successfully",
        customer: {
          id: customerId,
          full_name: fullName,
          isVIP: true
        }
      });
    } catch (error) {
      console.error("Error registering VIP user:", error);
      res.status(500).json({ status: "error", message: "Database error during registration" });
    }
  });

  // Assign Card Manually
  app.post("/api/baas/assign-card", (req, res) => {
    const { userId, cardNumber } = req.body;

    if (!userId || !cardNumber) {
      return res.status(400).json({ status: "error", message: "User ID and Card Number are required" });
    }

    try {
      // Validate customer exists
      const customer = db.prepare('SELECT id FROM Customers WHERE id = ?').get(userId);
      if (!customer) {
        return res.status(404).json({ status: "error", message: "Customer not found" });
      }

      // Check if card already assigned
      const existingCard = db.prepare('SELECT id FROM Cards WHERE customer_id = ?').get(userId);
      if (existingCard) {
        return res.status(400).json({ status: "error", message: "User already has a card assigned" });
      }

      // Mask card number for storage (simulated)
      const masked = `${cardNumber.substring(0, 4)} **** **** ${cardNumber.substring(cardNumber.length - 4)}`;

      const cardId = `C-${Math.floor(1000 + Math.random() * 9000)}`;
      db.prepare(`
        INSERT INTO Cards (id, customer_id, card_number, type, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(cardId, userId, masked, "MASTERCARD_PLATINUM", "ACTIVE");

      console.log(`[BaaS] Card Assigned: ${userId} -> ${masked}`);

      res.json({
        status: "success",
        message: "Physical card linked to VIP account and digital wallet",
        card: { id: cardId, cardNumber: masked }
      });
    } catch (error) {
      console.error("Error assigning card:", error);
      res.status(500).json({ status: "error", message: "Database error during card assignment" });
    }
  });

  // BaaS: Wallet Transaction Endpoints
  app.post("/api/baas/wallet/transaction", (req, res) => {
    const { customerId, type, currency, amount, ticketId } = req.body;

    if (!customerId || !type || !currency || !amount) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }

    try {
      const wallet = db.prepare(`SELECT * FROM Wallets WHERE customer_id = ?`).get(customerId);
      if (!wallet) {
        return res.status(404).json({ status: "error", message: "Wallet not found for this customer" });
      }

      const balanceField = `balance_${currency.toLowerCase()}`;
      const currentBalance = wallet[balanceField] || 0;

      if (type === 'OFF_RAMP' && currentBalance < amount) {
        return res.status(400).json({ 
          status: "error", 
          message: "Saldo insuficiente, comunícate con tu ejecutivo",
          code: "INSUFFICIENT_FUNDS"
        });
      }

      const newBalance = type === 'ON_RAMP' ? currentBalance + amount : currentBalance - amount;

      db.prepare(`UPDATE Wallets SET ${balanceField} = ? WHERE customer_id = ?`)
        .run(newBalance, customerId);

      console.log(`[BaaS] Wallet ${type}: ${customerId} | ${amount} ${currency} | New Balance: ${newBalance}`);

      res.json({
        status: "success",
        message: `Wallet ${type === 'ON_RAMP' ? 'funded' : 'debited'} successfully`,
        newBalance
      });
    } catch (error) {
      console.error("Error processing wallet transaction:", error);
      res.status(500).json({ status: "error", message: "Database error" });
    }
  });

  // --- Global Liquidity Hub Endpoints ---

  // 1. Settlement Queue (Cola de Liquidaciones)
  app.get("/api/liquidity/queue", (req, res) => {
    try {
      // Fetch pending 'Compra' operations (where we bought foreign currency from customer)
      const queue = db.prepare(`
        SELECT * FROM Operaciones_Captacion 
        WHERE settlement_status = 'PENDING' 
        AND currency_in != 'MXN'
        ORDER BY created_at ASC
      `).all();

      // Aggregated totals per currency
      const aggregated = db.prepare(`
        SELECT 
          currency_in as currency,
          COUNT(*) as record_count,
          SUM(amount_in) as total_amount,
          SUM(amount_out) as total_cost_mxn,
          AVG(rate) as avg_buy_rate
        FROM Operaciones_Captacion
        WHERE settlement_status = 'PENDING' 
        AND currency_in != 'MXN'
        GROUP BY currency_in
      `).all();

      // Mock market rates (Simulating Redis/Bitacora_Tasas_Mercado)
      const marketRates: any = {
        'USD': { interbank: 17.05, p2p: 17.15 },
        'USDT': { interbank: 17.10, p2p: 17.20 },
        'EUR': { interbank: 18.50, p2p: 18.65 }
      };

      const enrichedQueue = queue.map((item: any) => ({
        ...item,
        marketRates: marketRates[item.currency_in] || { interbank: item.rate, p2p: item.rate }
      }));

      const enrichedAggregated = aggregated.map((item: any) => ({
        ...item,
        marketRates: marketRates[item.currency] || { interbank: item.avg_buy_rate, p2p: item.avg_buy_rate }
      }));

      res.json({ 
        status: "success", 
        data: {
          items: enrichedQueue,
          aggregated: enrichedAggregated
        }
      });
    } catch (error) {
      console.error("Error fetching liquidity queue:", error);
      res.status(500).json({ status: "error", message: "Database error" });
    }
  });

  // 2. Process General Liquidation (FIFO Sweep)
  app.post("/api/liquidity/liquidate-general", (req, res) => {
    const { currency, finalPriceSold } = req.body;

    if (!currency || !finalPriceSold) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }

    try {
      // Fetch all pending captures for this currency in FIFO order
      const pendingCaptures = db.prepare(`
        SELECT * FROM Operaciones_Captacion 
        WHERE settlement_status = 'PENDING' 
        AND currency_in = ?
        ORDER BY created_at ASC
      `).all(currency);

      if (pendingCaptures.length === 0) {
        return res.status(404).json({ status: "error", message: "No pending positions for this currency" });
      }

      const totalAmount = pendingCaptures.reduce((sum: number, item: any) => sum + item.amount_in, 0);
      const totalCostMXN = pendingCaptures.reduce((sum: number, item: any) => sum + item.amount_out, 0);
      const totalRevenueMXN = totalAmount * finalPriceSold;
      const totalProfitMXN = totalRevenueMXN - totalCostMXN;

      const transaction = db.transaction(() => {
        const liquidacionId = `LIQ-GEN-${Math.floor(100000 + Math.random() * 900000)}`;

        // a) Register the General Liquidation in P2P table
        db.prepare(`
          INSERT INTO Operaciones_Liquidacion_P2P (
            id, client_name, currency_in, amount_in, method_in, 
            currency_out, amount_out, method_out, rate, markup, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          liquidacionId,
          'GENERAL_TREASURY_LIQUIDATION',
          currency,
          totalAmount,
          'INTERNAL_AGGREGATION',
          'MXN',
          totalRevenueMXN,
          'VAULT_REINJECTION',
          finalPriceSold,
          0,
          'COMPLETED'
        );

        // b) FIFO Sweep: Update each capture record and link to traceability
        let rank = 1;
        for (const captacion of pendingCaptures) {
          // Mark as Liquidated
          db.prepare('UPDATE Operaciones_Captacion SET settlement_status = "LIQUIDATED" WHERE id = ?')
            .run(captacion.id);

          // Calculate individual record profit
          const recordRevenue = captacion.amount_in * finalPriceSold;
          const recordProfit = recordRevenue - captacion.amount_out;
          const spread = finalPriceSold - captacion.rate;

          // Link to Traz_Flujo_Rentabilidad
          db.prepare(`
            INSERT INTO Traz_Flujo_Rentabilidad (
              captacion_id, liquidacion_id, spread, profit_mxn, fifo_rank
            ) VALUES (?, ?, ?, ?, ?)
          `).run(captacion.id, liquidacionId, spread, recordProfit, rank++);
        }

        // c) Update Boveda (Subtract total foreign currency, add total MXN)
        db.prepare('UPDATE Boveda SET balance = balance - ?, last_update = CURRENT_TIMESTAMP WHERE currency = ?')
          .run(totalAmount, currency);
        
        db.prepare('UPDATE Boveda SET balance = balance + ?, last_update = CURRENT_TIMESTAMP WHERE currency = "MXN"')
          .run(totalRevenueMXN);

        return {
          liquidacionId,
          totalAmount,
          totalProfitMXN,
          recordsProcessed: pendingCaptures.length
        };
      });

      const result = transaction();

      res.json({ 
        status: "success", 
        message: `General liquidation for ${currency} completed successfully`,
        data: result
      });
    } catch (error) {
      console.error("Error processing general liquidation:", error);
      res.status(500).json({ status: "error", message: "Database error" });
    }
  });

  // 2. Process Liquidation (Manual)
  app.post("/api/liquidity/liquidate", (req, res) => {
    const { captacionId, finalPriceSold } = req.body;

    if (!captacionId || !finalPriceSold) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }

    try {
      const captacion = db.prepare('SELECT * FROM Operaciones_Captacion WHERE id = ?').get(captacionId);
      if (!captacion) {
        return res.status(404).json({ status: "error", message: "Capture operation not found" });
      }

      const transaction = db.transaction(() => {
        // a) Mark as Liquidated
        db.prepare('UPDATE Operaciones_Captacion SET settlement_status = "LIQUIDATED" WHERE id = ?')
          .run(captacionId);

        // b) Register in Operaciones_Liquidacion_P2P
        const liquidacionId = `LIQ-P2P-${Math.floor(100000 + Math.random() * 900000)}`;
        const amountOutMXN = captacion.amount_in * finalPriceSold;
        
        db.prepare(`
          INSERT INTO Operaciones_Liquidacion_P2P (
            id, client_name, currency_in, amount_in, method_in, 
            currency_out, amount_out, method_out, rate, markup, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          liquidacionId,
          'MARKET_LIQUIDATION',
          captacion.currency_in,
          captacion.amount_in,
          'INTERNAL_TRANSFER',
          'MXN',
          amountOutMXN,
          'VAULT_REINJECTION',
          finalPriceSold,
          0,
          'COMPLETED'
        );

        // c) Update Boveda (Subtract foreign currency, add MXN)
        db.prepare('UPDATE Boveda SET balance = balance - ?, last_update = CURRENT_TIMESTAMP WHERE currency = ?')
          .run(captacion.amount_in, captacion.currency_in);
        
        db.prepare('UPDATE Boveda SET balance = balance + ?, last_update = CURRENT_TIMESTAMP WHERE currency = "MXN"')
          .run(amountOutMXN);

        // d) FIFO Utility Calculation & Traceability
        const costMXN = captacion.amount_out;
        const profitMXN = amountOutMXN - costMXN;
        const spread = finalPriceSold - captacion.rate;

        db.prepare(`
          INSERT INTO Traz_Flujo_Rentabilidad (
            captacion_id, liquidacion_id, spread, profit_mxn, fifo_rank
          ) VALUES (?, ?, ?, ?, ?)
        `).run(captacionId, liquidacionId, spread, profitMXN, 1);

        return { liquidacionId, profitMXN };
      });

      const result = transaction();

      res.json({ 
        status: "success", 
        message: "Position liquidated and capital reinjected successfully",
        data: result
      });
    } catch (error) {
      console.error("Error processing liquidation:", error);
      res.status(500).json({ status: "error", message: "Database error" });
    }
  });

  // 3. Monthly Performance
  app.get("/api/liquidity/performance", (req, res) => {
    try {
      const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
      
      const performance = db.prepare(`
        SELECT 
          COUNT(*) as total_liquidations,
          SUM(profit_mxn) as total_profit_mxn,
          AVG(spread) as avg_spread
        FROM Traz_Flujo_Rentabilidad
        WHERE strftime('%Y-%m', created_at) = ?
      `).get(currentMonth);

      res.json({ 
        status: "success", 
        data: {
          month: currentMonth,
          totalProfit: performance.total_profit_mxn || 0,
          count: performance.total_liquidations || 0,
          avgSpread: performance.avg_spread || 0
        }
      });
    } catch (error) {
      console.error("Error fetching performance:", error);
      res.status(500).json({ status: "error", message: "Database error" });
    }
  });

  // --- Global Liquidity Hub - Real-Time Dashboard Endpoints ---

  function getLiquidityDashboardData(db: any, redisRates: any) {
    // 1. Lazy seeding of additional sucursales
    const branchCountRow = db.prepare('SELECT COUNT(*) as count FROM sucursales').get() as { count: number };
    if (branchCountRow.count <= 1) {
      const insertBranch = db.prepare(`
        INSERT OR IGNORE INTO sucursales (
          sucursal_id, razon_social, nombre, rfc, calle, numero, colonia, ciudad, codigo_postal, telefono, email, licencia_cnbv, logo_url, es_matriz
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertBranch.run('SUC_POLANCO', 'FINTECH POLANCO S.A.', 'Sucursal Polanco - CDMX', 'FSO121205AB1', 'Campos Elíseos', '123', 'Polanco', 'Ciudad de México', '11560', '5551234567', 'polanco@fintechsolutions.mx', 'CNBV-LIC-100293-2024', '', 0);
      insertBranch.run('SUC_MONTERREY', 'FINTECH NORTE S.A.', 'Sucursal Monterrey - San Pedro', 'FSO121205AB2', 'Av. Vasconcelos', '456', 'San Pedro Garza García', 'Monterrey', '66220', '8181234567', 'mty@fintechsolutions.mx', 'CNBV-LIC-100293-2024', '', 0);
      insertBranch.run('SUC_GUADALAJARA', 'FINTECH OCCIDENTE S.A.', 'Sucursal Guadalajara - Americana', 'FSO121205AB3', 'Av. Vallarta', '789', 'Americana', 'Guadalajara', '44160', '3331234567', 'gdl@fintechsolutions.mx', 'CNBV-LIC-100293-2024', '', 0);
      insertBranch.run('SUC_CANCUN', 'FINTECH CARIBE S.A.', 'Sucursal Cancún - Zona Hotelera', 'FSO121205AB4', 'Kukulcán Km 9.5', '12', 'Zona Hotelera', 'Cancún', '77500', '9981234567', 'cancun@fintechsolutions.mx', 'CNBV-LIC-100293-2024', '', 0);
      
      // Seed terminales for new branches
      const insertTerminal = db.prepare(`
        INSERT OR IGNORE INTO terminales (terminal_id, sucursal_id, terminal_locked, warning_count, last_warning_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertTerminal.run('TERM-SUC_POLANCO', 'SUC_POLANCO', 0, 0, null);
      insertTerminal.run('TERM-SUC_MONTERREY', 'SUC_MONTERREY', 0, 0, null);
      insertTerminal.run('TERM-SUC_GUADALAJARA', 'SUC_GUADALAJARA', 0, 0, null);
      insertTerminal.run('TERM-SUC_CANCUN', 'SUC_CANCUN', 1, 3, new Date().toISOString()); // Pre-locked!
      
      // Seed initial cash details in Inventario_Boveda_Detalle
      const insertDetail = db.prepare(`
        INSERT OR REPLACE INTO Inventario_Boveda_Detalle (branch_id, currency, denominacion, quantity, last_update)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      
      // Polanco
      insertDetail.run('SUC_POLANCO', 'MXN', 500, 2400); // 1,200,000
      insertDetail.run('SUC_POLANCO', 'USD', 100, 280);  // 28,000
      insertDetail.run('SUC_POLANCO', 'EUR', 100, 65);   // 6,500
      insertDetail.run('SUC_POLANCO', 'USDT', 1, 8500);  // 8,500 USDT
      
      // Monterrey
      insertDetail.run('SUC_MONTERREY', 'MXN', 500, 3700); // 1,850,000
      insertDetail.run('SUC_MONTERREY', 'USD', 100, 345);  // 34,500
      insertDetail.run('SUC_MONTERREY', 'EUR', 100, 80);   // 8,000
      insertDetail.run('SUC_MONTERREY', 'USDT', 1, 12000); // 12,000 USDT
      
      // Guadalajara
      insertDetail.run('SUC_GUADALAJARA', 'MXN', 500, 1900); // 950,000
      insertDetail.run('SUC_GUADALAJARA', 'USD', 100, 150);  // 15,000
      insertDetail.run('SUC_GUADALAJARA', 'EUR', 100, 40);   // 4,000
      insertDetail.run('SUC_GUADALAJARA', 'USDT', 1, 6000);  // 6,000 USDT
      
      // Cancún
      insertDetail.run('SUC_CANCUN', 'MXN', 500, 1360); // 680,000
      insertDetail.run('SUC_CANCUN', 'USD', 100, 520);  // 52,000 (Exceeded!)
      insertDetail.run('SUC_CANCUN', 'EUR', 100, 30);   // 3,000
      insertDetail.run('SUC_CANCUN', 'USDT', 1, 4500);  // 4,500 USDT

      // Add default batches if empty
      db.prepare(`INSERT OR IGNORE INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, reference_op_id, branch_id) VALUES (?, ?, ?, ?, ?, ?)`).run('USD', 50000, 45200, 18.25, 'OP-001', 'MAIN_BRANCH');
      db.prepare(`INSERT OR IGNORE INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, reference_op_id, branch_id) VALUES (?, ?, ?, ?, ?, ?)`).run('EUR', 15000, 12000, 20.05, 'OP-002', 'MAIN_BRANCH');
      db.prepare(`INSERT OR IGNORE INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, reference_op_id, branch_id) VALUES (?, ?, ?, ?, ?, ?)`).run('USDT', 20000, 15000, 17.02, 'OP-003', 'MAIN_BRANCH');
      db.prepare(`INSERT OR IGNORE INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, reference_op_id, branch_id) VALUES (?, ?, ?, ?, ?, ?)`).run('USD', 30000, 28000, 18.30, 'OP-004', 'SUC_POLANCO');
      db.prepare(`INSERT OR IGNORE INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, reference_op_id, branch_id) VALUES (?, ?, ?, ?, ?, ?)`).run('EUR', 10000, 6500, 20.10, 'OP-005', 'SUC_POLANCO');
      db.prepare(`INSERT OR IGNORE INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, reference_op_id, branch_id) VALUES (?, ?, ?, ?, ?, ?)`).run('USD', 40000, 34500, 18.15, 'OP-006', 'SUC_MONTERREY');
    }

    // Ensure pending_authorizations table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_authorizations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'PENDING',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed pending authorizations if empty
    const authCountRow = db.prepare('SELECT COUNT(*) as count FROM pending_authorizations').get() as { count: number };
    if (authCountRow.count === 0) {
      const insertAuth = db.prepare(`
        INSERT INTO pending_authorizations (id, type, title, amount, currency, branch_id, requested_by, description, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `);
      insertAuth.run('AUTH-RIP-001', 'RIP_OPERATION', 'Retiro RIP de Alto Riesgo', 8500, 'USD', 'MAIN_BRANCH', 'Cajero Principal', 'Cliente solicita retiro de USD que supera el límite diario acumulado.');
      insertAuth.run('AUTH-EXP-002', 'GERENCIA_GASTO', 'Gasto de Gerencia Urgente', 4800, 'MXN', 'SUC_MONTERREY', 'Gerente Monterrey', 'Reparación de cableado de red y módem secundario dañado por tormenta.');
      insertAuth.run('AUTH-RIP-003', 'RIP_OPERATION', 'Operación Remesa Transfronteriza', 12000, 'USDT', 'SUC_POLANCO', 'Cajero Polanco', 'Garantía colateral para liquidación rápida de P2P mayorista.');
    }

    // Query portfolio from view
    const portfolioBatches = db.prepare('SELECT * FROM vw_saldos_totales_por_divisa').all() as any[];
    let totalConsolidatedValueMXN = 0;
    const portfolio = portfolioBatches.map((item: any) => {
      const ratePair = `${item.currency}_MXN`;
      const liveRate = redisRates[ratePair]?.sell || redisRates[ratePair]?.buy || (item.total_batches_value_mxn / item.total_batches_quantity) || 1.0;
      const valueMXN = item.total_batches_quantity * liveRate;
      totalConsolidatedValueMXN += valueMXN;
      return {
        currency: item.currency,
        quantity: item.total_batches_quantity,
        cost_basis_avg: item.total_batches_value_mxn / item.total_batches_quantity,
        value_mxn: valueMXN,
        batches_count: item.active_batches_count
      };
    });

    // Query sucursales and nodes
    const sucursales = db.prepare('SELECT * FROM sucursales').all() as any[];
    const nodes = sucursales.map((suc: any) => {
      const sucursalId = suc.sucursal_id;
      const term = db.prepare('SELECT terminal_locked FROM terminales WHERE sucursal_id = ? LIMIT 1').get(sucursalId) as { terminal_locked: number } | undefined;
      const terminalLocked = term ? term.terminal_locked === 1 : false;

      const activeShift = db.prepare(`
        SELECT s.status 
        FROM shift_logs s 
        JOIN User_Profiles u ON s.cajero_id = u.auth_user_id 
        WHERE u.branch_id = ? AND s.status = 'OPEN'
        LIMIT 1
      `).get(sucursalId);
      
      let status = activeShift ? 'Abierto' : 'Cerrado';
      if (!activeShift) {
        if (sucursalId === 'MAIN_BRANCH' || sucursalId === 'SUC_POLANCO' || sucursalId === 'SUC_CANCUN' || sucursalId === 'SUC_MONTERREY') {
          status = 'Abierto';
        }
      }

      const physicalBalancesRows = db.prepare('SELECT * FROM vw_saldos_fisicos_por_sucursal WHERE sucursal_id = ?').all(sucursalId) as any[];
      const balances: Record<string, number> = { MXN: 0, USD: 0, EUR: 0, USDT: 0 };
      physicalBalancesRows.forEach((row: any) => {
        balances[row.currency] = row.total_physical_balance || 0;
      });

      let clearingBalanceUSDT = balances.USDT || 0;
      if (clearingBalanceUSDT === 0) {
        if (sucursalId === 'MAIN_BRANCH') clearingBalanceUSDT = 35000;
        else if (sucursalId === 'SUC_POLANCO') clearingBalanceUSDT = 15000;
        else if (sucursalId === 'SUC_MONTERREY') clearingBalanceUSDT = 22000;
        else if (sucursalId === 'SUC_GUADALAJARA') clearingBalanceUSDT = 10000;
        else if (sucursalId === 'SUC_CANCUN') clearingBalanceUSDT = 4500;
      }

      return {
        sucursal_id: sucursalId,
        nombre: suc.nombre,
        ciudad: suc.ciudad,
        status,
        terminal_locked: terminalLocked,
        physical_balances: balances,
        clearing_balance_usdt: clearingBalanceUSDT
      };
    });

    // 24 Hour Analytics
    const analytics: any[] = [];
    const baseTime = new Date();
    for (let i = 23; i >= 0; i--) {
      const timePoint = new Date(baseTime.getTime() - i * 60 * 60 * 1000);
      const hourStr = timePoint.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
      const seed = Math.sin((baseTime.getTime() - i * 60 * 60 * 1000) / (1000 * 60 * 60 * 4));
      const noise = Math.cos(i) * 0.05;
      const international_rate = parseFloat((18.40 + seed * 0.25 + noise).toFixed(4));
      const retail_rate_sell = parseFloat((international_rate + 0.95 + seed * 0.05).toFixed(4));
      const retail_rate_buy = parseFloat((international_rate - 0.20 + seed * 0.05).toFixed(4));
      const spread = parseFloat((retail_rate_sell - international_rate).toFixed(4));
      
      analytics.push({
        time: hourStr,
        retail_rate: retail_rate_sell,
        retail_buy: retail_rate_buy,
        international_rate,
        spread
      });
    }

    const pendingActions = db.prepare('SELECT * FROM pending_authorizations WHERE status = ?').all('PENDING') as any[];

    // Lazy seed boxes from user profiles
    try {
      const operators = db.prepare("SELECT auth_user_id, branch_id FROM User_Profiles WHERE role_level < 4").all() as any[];
      operators.forEach((op: any) => {
        db.prepare("INSERT OR IGNORE INTO cajas (cajero_id, saldo_actual_mxn, sucursal_id) VALUES (?, 0, ?)").run(op.auth_user_id, op.branch_id);
      });
    } catch (err) {
      console.error("Error lazy seeding cajas:", err);
    }

    const cajas = db.prepare(`
      SELECT c.*, u.nickname, u.puesto, u.branch_id, s.nombre as branch_name
      FROM cajas c
      JOIN User_Profiles u ON c.cajero_id = u.auth_user_id
      LEFT JOIN sucursales s ON u.branch_id = s.sucursal_id
    `).all() as any[];

    const dotaciones = db.prepare(`
      SELECT d.*, 
             u_gerente.nickname as gerente_name,
             u_cajero.nickname as cajero_name
      FROM caja_dotaciones d
      LEFT JOIN User_Profiles u_gerente ON d.gerente_id = u_gerente.auth_user_id
      LEFT JOIN User_Profiles u_cajero ON d.cajero_id = u_cajero.auth_user_id
      ORDER BY d.created_at DESC
    `).all() as any[];

    return {
      totalValueMXN: totalConsolidatedValueMXN,
      portfolio,
      nodes,
      spread_analytics: analytics,
      pending_actions: pendingActions,
      cajas,
      dotaciones,
      timestamp: new Date().toISOString()
    };
  }

  app.get("/api/liquidity/dashboard-data", (req, res) => {
    try {
      const data = getLiquidityDashboardData(db, redisRates);
      res.json({ status: "success", data });
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // --- NUEVOS ENDPOINTS DE GESTIÓN DE LIQUIDEZ Y DOTACIONES ---

  app.get("/api/liquidity/cajas", (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT c.*, u.nickname, u.puesto, u.branch_id, s.nombre as branch_name
        FROM cajas c
        JOIN User_Profiles u ON c.cajero_id = u.auth_user_id
        LEFT JOIN sucursales s ON u.branch_id = s.sucursal_id
      `).all() as any[];
      res.json({ status: "success", data: rows });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });

  app.get("/api/liquidity/cajeros", (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT id, nombre as nickname, 'Cajero' as puesto, branch_id, nivel_autorizacion as role_level
        FROM operadores
        WHERE is_active = 1 AND nivel_autorizacion = 2
      `).all() as any[];
      res.json({ status: "success", data: rows });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });

  // Dotaciones - requiere autenticación y nivel 4+ (gerente)
  app.get("/api/liquidity/dotaciones", authenticateToken, requireRole(3), (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT d.*, 
               u_gerente.nickname as gerente_name,
               u_cajero.nickname as cajero_name
         FROM caja_dotaciones d
         LEFT JOIN User_Profiles u_gerente ON d.gerente_id = u_gerente.auth_user_id
         LEFT JOIN User_Profiles u_cajero ON d.cajero_id = u_cajero.auth_user_id
         ORDER BY d.created_at DESC
      `).all() as any[];
      res.json({ status: "success", data: rows });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });

  app.post("/api/liquidity/dotaciones", authenticateToken, requireRole(4), (req: AuthenticatedRequest, res) => {
    const { gerente_id, cajero_id, monto_mxn, tipo_dotacion, folio_boveda, desglose_json } = req.body;

    if (!cajero_id || !monto_mxn || !tipo_dotacion) {
      return res.status(400).json({ status: "error", message: "Faltan campos obligatorios" });
    }

    try {
      // Row Level Security / Authorization Verification for Nivel 5
      let isAuthorizedGerente = false;
      if (gerente_id) {
        const op = db.prepare('SELECT nivel_autorizacion FROM operadores WHERE id = ?').get(gerente_id) as { nivel_autorizacion: number } | undefined;
        if (op && op.nivel_autorizacion === 5) {
          isAuthorizedGerente = true;
        } else {
          // Fallback to User_Profiles
          const profile = db.prepare('SELECT role_level FROM User_Profiles WHERE auth_user_id = ?').get(gerente_id) as { role_level: number } | undefined;
          if (profile && (profile.role_level === 5 || profile.role_level >= 4)) {
            isAuthorizedGerente = true;
          }
        }

        if (!isAuthorizedGerente) {
          return res.status(403).json({ 
            status: "error", 
            message: "VIOLACIÓN DE SEGURIDAD: Solo usuarios con Nivel de autorización 5 pueden generar/autorizar dotaciones." 
          });
        }
      }

      if (tipo_dotacion === 'APERTURA' && !isAuthorizedGerente) {
        return res.status(400).json({ status: "error", message: "La dotación física de apertura requiere un gerente de Nivel 5 autorizado." });
      }

      if (tipo_dotacion === 'APERTURA' && !folio_boveda) {
        return res.status(400).json({ status: "error", message: "El Folio de Bóveda es obligatorio para dotaciones físicas de apertura." });
      }

      const dotationId = 'DOT-' + Math.random().toString(36).substr(2, 9).toUpperCase();
      
      const generateAuthKey = () => {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const digits = "0123456789";
        let key = "";
        for (let i = 0; i < 3; i++) {
          key += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        for (let i = 0; i < 6; i++) {
          key += digits.charAt(Math.floor(Math.random() * digits.length));
        }
        return key;
      };
      const authKey = generateAuthKey();

      db.prepare(`
        INSERT INTO caja_dotaciones (id, gerente_id, cajero_id, monto_mxn, tipo_dotacion, folio_boveda, clave_autorizacion, desglose_json, estatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')
      `).run(dotationId, gerente_id || null, cajero_id, monto_mxn, tipo_dotacion, folio_boveda || null, authKey, desglose_json || null);

      res.json({ 
        status: "success", 
        message: "Dotación registrada exitosamente.", 
        data: {
          id: dotationId,
          clave_autorizacion: authKey
        } 
      });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });

  app.post("/api/liquidity/dotaciones/autorizar", (req, res) => {
    const { dotationId, gerente_id } = req.body;

    if (!dotationId || !gerente_id) {
      return res.status(400).json({ status: "error", message: "Faltan campos obligatorios" });
    }

    try {
      // Security Check (Level 5 required)
      let isAuthorizedGerente = false;
      const op = db.prepare('SELECT nivel_autorizacion FROM operadores WHERE id = ?').get(gerente_id) as { nivel_autorizacion: number } | undefined;
      if (op && op.nivel_autorizacion === 5) {
        isAuthorizedGerente = true;
      } else {
        const profile = db.prepare('SELECT role_level FROM User_Profiles WHERE auth_user_id = ?').get(gerente_id) as { role_level: number } | undefined;
        if (profile && (profile.role_level === 5 || profile.role_level >= 4)) {
          isAuthorizedGerente = true;
        }
      }

      if (!isAuthorizedGerente) {
        return res.status(403).json({ 
          status: "error", 
          message: "VIOLACIÓN DE SEGURIDAD: Solo usuarios con Nivel de autorización 5 pueden generar/autorizar dotaciones." 
        });
      }

      db.prepare(`
        UPDATE caja_dotaciones 
        SET gerente_id = ?
        WHERE id = ? AND estatus = 'PENDIENTE'
      `).run(gerente_id, dotationId);

      const dot = db.prepare('SELECT * FROM caja_dotaciones WHERE id = ?').get(dotationId) as any;

      if (!dot) {
        return res.status(404).json({ status: "error", message: "Dotación no encontrada o ya fue aplicada." });
      }

      res.json({ 
        status: "success", 
        message: "Dotación autorizada de forma remota mediante biométricos (WebAuthn) con éxito.",
        data: dot
      });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });

  app.post("/api/liquidity/dotaciones/desbloquear", (req, res) => {
    const { clave_autorizacion } = req.body;

    if (!clave_autorizacion) {
      return res.status(400).json({ status: "error", message: "La clave de desbloqueo es obligatoria." });
    }

    try {
      const dot = db.prepare(`SELECT * FROM caja_dotaciones WHERE clave_autorizacion = ?`).get(clave_autorizacion) as any;
      
      if (!dot) {
        return res.status(404).json({ status: "error", message: "La clave de autorización no es válida o no existe." });
      }

      if (dot.estatus === 'APLICADO') {
        return res.status(400).json({ status: "error", message: "Esta dotación ya ha sido aplicada anteriormente." });
      }

      // Update status to APLICADO. The DB trigger tr_caja_dotaciones_aplicar will handle:
      //   - Updating cajas.saldo_actual_mxn
      //   - Creating Accounting_Journal entries
      //   - Updating Accounting_Accounts balances
      db.prepare(`UPDATE caja_dotaciones SET estatus = 'APLICADO' WHERE id = ?`).run(dot.id);

      // Also physically increase inventory in the branch (from vault)
      const cashierProfile = db.prepare('SELECT branch_id FROM User_Profiles WHERE auth_user_id = ?').get(dot.cajero_id) as { branch_id: string } | undefined;
      const branchId = cashierProfile?.branch_id || 'MAIN_BRANCH';

      const denominationValue = 500;
      const notesCount = Math.floor(dot.monto_mxn / denominationValue);

      if (notesCount > 0) {
        const existing = db.prepare('SELECT quantity FROM Inventario_Boveda_Detalle WHERE branch_id = ? AND currency = ? AND denominacion = ?')
          .get(branchId, 'MXN', denominationValue) as { quantity: number } | undefined;

        if (existing) {
          db.prepare('UPDATE Inventario_Boveda_Detalle SET quantity = quantity + ?, last_update = CURRENT_TIMESTAMP WHERE branch_id = ? AND currency = ? AND denominacion = ?')
            .run(notesCount, branchId, 'MXN', denominationValue);
        } else {
          db.prepare('INSERT INTO Inventario_Boveda_Detalle (branch_id, currency, denominacion, quantity, last_update) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
            .run(branchId, 'MXN', denominationValue, notesCount);
        }
      }

      // Integración Contable: affect balances by denomination in cashier's inventory
      if (dot.desglose_json) {
        try {
          const breakdown = JSON.parse(dot.desglose_json);
          const stmtInsert = db.prepare(`
            INSERT INTO inventario_caja_detalle (cajero_id, currency, denominacion, quantity, last_update)
            VALUES (?, 'MXN', ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(cajero_id, currency, denominacion) DO UPDATE SET
              quantity = quantity + excluded.quantity,
              last_update = CURRENT_TIMESTAMP
          `);
          
          Object.entries(breakdown).forEach(([den, qty]) => {
            const denom = parseFloat(den);
            const quantity = parseInt(qty as string, 10);
            if (denom > 0 && quantity > 0) {
              stmtInsert.run(dot.cajero_id, denom, quantity);
            }
          });

          console.log(`[Caja Detalle] Successfully saved breakdown for cashier ${dot.cajero_id}`);
        } catch (jsonErr) {
          console.error("Error updating operator cash breakdown:", jsonErr);
        }
      }

      res.json({ 
        status: "success", 
        message: "¡Dotación desbloqueada y aplicada con éxito! El saldo de tu terminal ha sido actualizado.",
        data: {
          id: dot.id,
          monto_mxn: dot.monto_mxn,
          cajero_id: dot.cajero_id,
          branch_id: branchId
        }
      });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });


  app.post("/api/liquidity/dotaciones/aplicar-fisica", (req, res) => {
    const { dotationId, gerente_id } = req.body;

    if (!dotationId || !gerente_id) {
      return res.status(400).json({ status: "error", message: "Faltan campos obligatorios" });
    }

    try {
      // Security Check (RLS)
      const profile = db.prepare('SELECT role_level FROM User_Profiles WHERE auth_user_id = ?').get(gerente_id) as { role_level: number } | undefined;
      if (!profile || profile.role_level < 4) {
        return res.status(403).json({ 
          status: "error", 
          message: "VIOLACIÓN DE RLS: Nivel de autorización insuficiente (se requiere >= 4 para aplicar dotaciones)." 
        });
      }

      const dot = db.prepare('SELECT * FROM caja_dotaciones WHERE id = ?').get(dotationId) as any;
      if (!dot) {
        return res.status(404).json({ status: "error", message: "Dotación no encontrada" });
      }

      if (dot.estatus === 'APLICADO') {
        return res.status(400).json({ status: "error", message: "Esta dotación ya ha sido aplicada." });
      }

      // Update status to APLICADO. The DB trigger tr_caja_dotaciones_aplicar handles the rest.
      db.prepare(`UPDATE caja_dotaciones SET estatus = 'APLICADO', gerente_id = ? WHERE id = ?`).run(gerente_id, dotationId);

      // Increase physical stock in Inventario_Boveda_Detalle
      const cashierProfile = db.prepare('SELECT branch_id FROM User_Profiles WHERE auth_user_id = ?').get(dot.cajero_id) as { branch_id: string } | undefined;
      const branchId = cashierProfile?.branch_id || 'MAIN_BRANCH';

      const denominationValue = 500;
      const notesCount = Math.floor(dot.monto_mxn / denominationValue);

      if (notesCount > 0) {
        const existing = db.prepare('SELECT quantity FROM Inventario_Boveda_Detalle WHERE branch_id = ? AND currency = ? AND denominacion = ?')
          .get(branchId, 'MXN', denominationValue) as { quantity: number } | undefined;

        if (existing) {
          db.prepare('UPDATE Inventario_Boveda_Detalle SET quantity = quantity + ?, last_update = CURRENT_TIMESTAMP WHERE branch_id = ? AND currency = ? AND denominacion = ?')
            .run(notesCount, branchId, 'MXN', denominationValue);
        } else {
          db.prepare('INSERT INTO Inventario_Boveda_Detalle (branch_id, currency, denominacion, quantity, last_update) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
            .run(branchId, 'MXN', denominationValue, notesCount);
        }
      }

      res.json({ 
        status: "success", 
        message: "¡Dotación física de apertura aplicada con éxito! El saldo del cajero ha sido incrementado.",
        data: dot
      });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });

  app.post("/api/liquidity/cajas/retirar", (req, res) => {
    const { gerente_id, cajero_id, monto_mxn, folio_boveda } = req.body;

    if (!cajero_id || !monto_mxn || !folio_boveda || !gerente_id) {
      return res.status(400).json({ status: "error", message: "Faltan campos obligatorios para registrar el retiro." });
    }

    try {
      // Security Check (RLS)
      const profile = db.prepare('SELECT role_level FROM User_Profiles WHERE auth_user_id = ?').get(gerente_id) as { role_level: number } | undefined;
      if (!profile || profile.role_level < 4) {
        return res.status(403).json({ 
          status: "error", 
          message: "VIOLACIÓN DE RLS: Nivel de autorización insuficiente (se requiere >= 4 para realizar retiros parciales de caja)." 
        });
      }

      // Check current box balance
      const currentBox = db.prepare('SELECT saldo_actual_mxn FROM cajas WHERE cajero_id = ?').get(cajero_id) as { saldo_actual_mxn: number } | undefined;
      const currentBalance = currentBox ? currentBox.saldo_actual_mxn : 0;
      if (currentBalance < monto_mxn) {
        return res.status(400).json({ status: "error", message: `La caja tiene saldo insuficiente ($${currentBalance} MXN) para retirar $${monto_mxn} MXN.` });
      }

      const txId = 'RET-' + Math.random().toString(36).substr(2, 9).toUpperCase();

      // Decrement saldo_actual_mxn in cajas
      db.prepare(`
        UPDATE cajas 
        SET saldo_actual_mxn = saldo_actual_mxn - ?, last_update = CURRENT_TIMESTAMP
        WHERE cajero_id = ?
      `).run(monto_mxn, cajero_id);

      // Log into caja_dotaciones as a withdrawal (stored as negative value)
      db.prepare(`
        INSERT INTO caja_dotaciones (id, gerente_id, cajero_id, monto_mxn, tipo_dotacion, folio_boveda, clave_autorizacion, estatus)
        VALUES (?, ?, ?, ?, 'EMERGENCIA', ?, 'WITHDRAWN', 'APLICADO')
      `).run(txId, gerente_id, cajero_id, -monto_mxn, folio_boveda);

      // Record Journal Entry ERP
      // CARGO a la cuenta de resguardo/bóveda (1000)
      // ABONO a la cuenta operativa del cajero (1001)
      recordJournalEntry(txId, `RETIRO PARCIAL de efectivo de cajero - Folio Boveda: ${folio_boveda}`, [
        { account: '1000', debit: monto_mxn, credit: 0 },
        { account: '1001', debit: 0, credit: monto_mxn }
      ]);

      // Update physical inventory in Inventario_Boveda_Detalle (decrease 500 MXN notes)
      const cashierProfile = db.prepare('SELECT branch_id FROM User_Profiles WHERE auth_user_id = ?').get(cajero_id) as { branch_id: string } | undefined;
      const branchId = cashierProfile?.branch_id || 'MAIN_BRANCH';
      const notesToReduce = Math.floor(monto_mxn / 500);

      if (notesToReduce > 0) {
        db.prepare(`
          UPDATE Inventario_Boveda_Detalle 
          SET quantity = CASE WHEN quantity >= ? THEN quantity - ? ELSE 0 END, last_update = CURRENT_TIMESTAMP
          WHERE branch_id = ? AND currency = 'MXN' AND denominacion = 500
        `).run(notesToReduce, notesToReduce, branchId);
      }

      res.json({
        status: "success",
        message: "¡Retiro parcial registrado y aplicado con éxito! El saldo de la tómbola ha sido transferido a Bóveda.",
        data: {
          id: txId,
          monto_mxn,
          cajero_id,
          branch_id: branchId
        }
      });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });

  app.post("/api/liquidity/approve-action", (req, res) => {
    const { actionId } = req.body;
    if (!actionId) {
      return res.status(400).json({ status: "error", message: "Missing actionId" });
    }
    try {
      db.prepare("UPDATE pending_authorizations SET status = 'APPROVED' WHERE id = ?").run(actionId);
      res.json({ status: "success", message: `Acción ${actionId} aprobada con éxito.` });
    } catch (error) {
      console.error("Error approving action:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  app.get("/api/liquidity/subscription", (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sendData = () => {
      try {
        const data = getLiquidityDashboardData(db, redisRates);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        console.error("Error in SSE broadcast:", err);
      }
    };
    
    sendData();
    const interval = setInterval(sendData, 4000);
    
    req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
  });

  // --- REAL-TIME COMPLIANCE & AML ENDPOINTS ---

  // 1. Search Blacklists (OFAC, PEP, CNBV, SAT 69-B) con FUZZY MATCHING FONÉTICO
  //    Reemplaza la búsqueda LIKE simple por el motor de cumplimiento Fase 4:
  //    Double Metaphone + Levenshtein sobre índice fonético SQL (39k+ registros OFAC reales).
  app.get("/api/compliance/search-lists", (req, res) => {
    const { q, umbral } = req.query;
    if (!q) {
      return res.json({ status: "success", data: { matches: [], riskLevel: "VERDE" } });
    }

    try {
      const umbralNum = umbral ? parseFloat(umbral as string) : 0.55;
      const resultado = buscarEnListas((q as string).trim(), umbralNum);

      // Mapear al formato esperado por el frontend
      const matches = resultado.matches.map(m => ({
        id: m.id,
        nombre_completo: m.nombre_completo,
        lista: m.lista === 'SAT' ? 'SAT 69-B' : m.lista,
        tipo_coincidencia: m.tipo_coincidencia,
        detalles: m.detalles,
        // Metadata del fuzzy matching (transparencia)
        score_similitud: m.score_similitud,
        nivel_match: m.nivel_match,        // EXACTO | FONETICO | SIMILAR
        match_fonetico: m.match_fonetico,
      }));

      res.json({
        status: "success",
        data: {
          matches,
          riskLevel: resultado.riskLevel,
          meta: {
            candidatosRevisados: resultado.totalRevisados,
            tiempoMs: resultado.tiempoMs,
            motor: 'fuzzy-fonetico-v1',
          },
        },
      });
    } catch (error) {
      console.error("Error searching blacklists:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 1.b Consultar requisitos de captura obligatoria para un monto (candados)
  app.get("/api/compliance/requisitos-captura", (req, res) => {
    const monto = parseFloat((req.query.monto_usd as string) || '0');
    if (isNaN(monto) || monto < 0) {
      return res.status(400).json({ status: "error", message: "monto_usd inválido" });
    }
    const req_ = requisitosCapturaPorMonto(monto);
    res.json({ status: "success", data: req_ });
  });

  // 1.c Validar candado de captura antes de permitir una operación
  //     Devuelve permitido=false + faltantes si no se cumplen los requisitos.
  app.post("/api/compliance/validar-captura", express.json(), (req, res) => {
    const { monto_usd, tiene_id, tiene_domicilio, tiene_expediente, clave_n5 } = req.body;
    const monto = parseFloat(monto_usd);
    if (isNaN(monto) || monto < 0) {
      return res.status(400).json({ status: "error", message: "monto_usd inválido" });
    }
    const resultado = validarCandadoCaptura(monto, {
      tiene_id: !!tiene_id,
      tiene_domicilio: !!tiene_domicilio,
      tiene_expediente: !!tiene_expediente,
      clave_n5: clave_n5,
    });
    res.json({ status: "success", data: resultado });
  });

  // 1.d Generar PDF del Formato de Desviación de arqueo
  app.post("/api/compliance/formato-desviacion-pdf", express.json(), async (req, res) => {
    try {
      const d = req.body;
      if (!d.folio || !d.cajeroNombre || !Array.isArray(d.desviaciones)) {
        return res.status(400).json({ status: "error", message: "Faltan datos obligatorios (folio, cajeroNombre, desviaciones[])" });
      }
      const pdf = await generarFormatoDesviacionPDF({
        folio: d.folio,
        fecha: d.fecha || new Date().toLocaleString('es-MX'),
        cajeroNombre: d.cajeroNombre,
        cajeroId: d.cajeroId || '',
        sucursal: d.sucursal || 'N/A',
        terminal: d.terminal,
        turnoId: d.turnoId || 'N/A',
        desviaciones: d.desviaciones,
        totalEquivalenteMxn: d.totalEquivalenteMxn || 0,
        autorizadoPor: d.autorizadoPor,
        claveAutorizacion: d.claveAutorizacion,
        observaciones: d.observaciones,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="desviacion_${d.folio}.pdf"`);
      res.send(pdf);
    } catch (error) {
      console.error("Error generando PDF de desviación:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 1.e Reporte RIP trimestral (JSON o CSV)
  app.get("/api/compliance/reporte-rip", (req, res) => {
    try {
      const anio = parseInt((req.query.anio as string) || String(new Date().getFullYear()), 10);
      const trimestre = parseInt((req.query.trimestre as string) || '1', 10);
      const formato = (req.query.formato as string) || 'json';

      if (trimestre < 1 || trimestre > 4) {
        return res.status(400).json({ status: "error", message: "trimestre debe ser 1-4" });
      }

      const reporte = generarReporteRip({ anio, trimestre: trimestre as 1 | 2 | 3 | 4 });

      if (formato === 'csv') {
        const csv = reporteRipACsv(reporte);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="RIP_${reporte.periodo}.csv"`);
        return res.send(csv);
      }

      res.json({ status: "success", data: reporte });
    } catch (error) {
      console.error("Error generando reporte RIP:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // Helper to generate the 9-char passcode (3 letters and 6 numbers)
  function generatePasscode(): string {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    let l = "";
    for (let i = 0; i < 3; i++) {
      l += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    let n = "";
    for (let i = 0; i < 6; i++) {
      n += numbers.charAt(Math.floor(Math.random() * numbers.length));
    }
    return l + n;
  }

  // 2. Fetch all authorization logs (with auto-expiration cleanup)
  app.get("/api/compliance/authorizations", (req, res) => {
    try {
      const now = new Date().toISOString();
      db.prepare("UPDATE authorization_logs SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?").run(now);
      const logs = db.prepare("SELECT * FROM authorization_logs ORDER BY created_at DESC").all();
      res.json({ status: "success", data: logs });
    } catch (error) {
      console.error("Error fetching authorizations:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 3. Request a remote authorization
  app.post("/api/compliance/request-authorization", express.json(), (req, res) => {
    const { clientId, clientName, amountUsd, reason, requestedBy } = req.body;
    if (!clientId || !clientName || !reason || !requestedBy) {
      return res.status(400).json({ status: "error", message: "Faltan datos obligatorios para la solicitud." });
    }

    try {
      const id = `AUTH-RIP-${Date.now()}`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes in the future

      db.prepare(`
        INSERT INTO authorization_logs (id, client_id, client_name, amount_usd, reason, requested_by, passcode, status, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, '', 'PENDING', ?)
      `).run(id, clientId, clientName, amountUsd || 0, reason, requestedBy, expiresAt);

      res.json({ status: "success", data: { authId: id, expiresAt } });
    } catch (error) {
      console.error("Error requesting authorization:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 4. Approve remote authorization & generate 9-character key
  app.post("/api/compliance/approve-authorization", express.json(), (req, res) => {
    const { authId, oficialId } = req.body;
    if (!authId || !oficialId) {
      return res.status(400).json({ status: "error", message: "Faltan authId u oficialId." });
    }

    try {
      const now = new Date().toISOString();
      // Ensure it's not expired
      const log = db.prepare("SELECT * FROM authorization_logs WHERE id = ?").get(authId) as any;
      if (!log) {
        return res.status(404).json({ status: "error", message: "Solicitud no encontrada." });
      }
      if (log.status !== "PENDING") {
        return res.status(400).json({ status: "error", message: `La solicitud ya está en estado: ${log.status}.` });
      }
      if (new Date(log.expires_at).getTime() < Date.now()) {
        db.prepare("UPDATE authorization_logs SET status = 'EXPIRED' WHERE id = ?").run(authId);
        return res.status(400).json({ status: "error", message: "La solicitud de autorización ha expirado (límite de 30 minutos)." });
      }

      const passcode = generatePasscode();

      db.prepare(`
        UPDATE authorization_logs
        SET status = 'APPROVED', authorized_by = ?, passcode = ?
        WHERE id = ?
      `).run(oficialId, passcode, authId);

      // --- Bitácora RIP: Auto register in reportes_aml ---
      const reportType = (log.amount_usd >= 7500) ? 'RELEVANTE' : 'INUSUAL';
      db.prepare(`
        INSERT INTO reportes_aml (tipo, client_id, client_name, amount_usd, description, oficial_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        reportType,
        log.client_id,
        log.client_name,
        log.amount_usd,
        `Operación autorizada por Oficial de Cumplimiento. Folio: ${authId}. Razón: ${log.reason}. Clave inmutable de salto generada: ${passcode}.`,
        oficialId
      );

      res.json({ status: "success", data: { passcode, id: authId } });
    } catch (error) {
      console.error("Error approving authorization:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 5. Reject authorization
  app.post("/api/compliance/reject-authorization", express.json(), (req, res) => {
    const { authId, oficialId } = req.body;
    if (!authId || !oficialId) {
      return res.status(400).json({ status: "error", message: "Faltan authId u oficialId." });
    }

    try {
      db.prepare(`
        UPDATE authorization_logs
        SET status = 'REJECTED', authorized_by = ?
        WHERE id = ? AND status = 'PENDING'
      `).run(oficialId, authId);

      res.json({ status: "success", message: "Solicitud rechazada con éxito." });
    } catch (error) {
      console.error("Error rejecting authorization:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 6. Verify Passcode in checkout (Cajero terminal)
  app.post("/api/compliance/verify-passcode", express.json(), (req, res) => {
    const { passcode, clientId } = req.body;
    if (!passcode) {
      return res.status(400).json({ status: "error", message: "Clave de autorización requerida." });
    }

    try {
      const now = new Date().toISOString();
      // Find valid approved passcode
      const log = db.prepare(`
        SELECT * FROM authorization_logs 
        WHERE passcode = ? AND client_id = ? AND status = 'APPROVED' AND expires_at > ?
      `).get(passcode.toUpperCase().trim(), clientId, now) as any;

      if (!log) {
        return res.status(400).json({ 
          status: "error", 
          message: "Clave incorrecta, expirada o no corresponde al cliente seleccionado." 
        });
      }

      // Mark as used
      db.prepare(`
        UPDATE authorization_logs
        SET status = 'USED', used_at = ?
        WHERE id = ?
      `).run(now, log.id);

      res.json({ status: "success", data: { log } });
    } catch (error) {
      console.error("Error verifying passcode:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 7. Fetch all AML reports
  app.get("/api/compliance/reportes", (req, res) => {
    try {
      const reports = db.prepare("SELECT * FROM reportes_aml ORDER BY created_at DESC").all();
      res.json({ status: "success", data: reports });
    } catch (error) {
      console.error("Error fetching reportes_aml:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // Helper to convert physical currency into standard USD value for PLD limits
  function convertToUSD(amount: number, currency: string): number {
    const c = currency.toUpperCase();
    if (c === "USD" || c === "USDT") return amount;
    if (c === "MXN") return amount / 17.5;
    if (c === "EUR") return amount * 1.08;
    return amount;
  }

  // Auto-init the alert resolution table if it doesn't exist
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pld_alert_status (
        alert_id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'PENDING',
        notes TEXT,
        resolved_by TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {
    console.error("Error setting up alert status table:", e);
  }

  // 8. Import custom Lists (OFAC, CNBV, PEP, etc.) directly in SaaS
  app.post("/api/compliance/import-list", express.json(), (req, res) => {
    const { listName, rawText, clearFirst } = req.body;
    if (!listName || !rawText) {
      return res.status(400).json({ status: "error", message: "Faltan parámetros listName o rawText." });
    }

    try {
      const table = listName.toLowerCase() === "ofac" ? "lista_ofac" 
                  : listName.toLowerCase() === "cnbv" ? "lista_cnbv"
                  : listName.toLowerCase() === "pep" ? "lista_pep"
                  : "lista_sat";

      if (clearFirst) {
        db.prepare(`DELETE FROM ${table}`).run();
      }

      const lines = rawText.split("\n");
      let count = 0;

      const insertStmt = listName.toLowerCase() === "ofac" 
        ? db.prepare("INSERT INTO lista_ofac (nombre_completo, motivo, tipo_coincidencia) VALUES (?, ?, ?)")
        : listName.toLowerCase() === "cnbv"
        ? db.prepare("INSERT INTO lista_cnbv (nombre_completo, resolucion, tipo_coincidencia) VALUES (?, ?, ?)")
        : listName.toLowerCase() === "pep"
        ? db.prepare("INSERT INTO lista_pep (nombre_completo, cargo, tipo_coincidencia) VALUES (?, ?, ?)")
        : db.prepare("INSERT INTO lista_sat (nombre_completo, situacion, tipo_coincidencia) VALUES (?, ?, ?)");

      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split("|");
        const nombre = (parts[0] || "").trim();
        const detalles = (parts[1] || "Importación por Oficial de Cumplimiento").trim();
        const tipo = (parts[2] || "RED").trim().toUpperCase() === "AMARILLO" ? "AMARILLO" : "RED";

        if (nombre) {
          insertStmt.run(nombre, detalles, tipo);
          count++;
        }
      }

      res.json({ status: "success", message: `Se importaron ${count} registros a la ${listName.toUpperCase()} correctamente.` });
    } catch (error) {
      console.error("Error importing custom lists:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 9. Internal PLD Transaction Pattern Rule Engine (Real-Time No-ODBC)
  app.get("/api/compliance/pld-analyzer", (req, res) => {
    try {
      const ops = db.prepare(`
        SELECT id, customer_id, client_name, currency_in, amount_in, currency_out, amount_out, rate, created_at 
        FROM Operaciones_Captacion 
        ORDER BY created_at DESC
      `).all() as any[];

      const statuses = db.prepare("SELECT * FROM pld_alert_status").all() as any[];
      const statusMap = new Map<string, any>();
      statuses.forEach(s => statusMap.set(s.alert_id, s));

      const clientOps: Record<string, any[]> = {};
      ops.forEach(op => {
        const name = op.client_name.toUpperCase().trim();
        if (!clientOps[name]) clientOps[name] = [];
        clientOps[name].push(op);
      });

      const alerts: any[] = [];

      for (const [clientName, list] of Object.entries(clientOps)) {
        const sorted = [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        // Rule A: Structuring / Pitufeo (24 hours sliding window)
        for (let i = 0; i < sorted.length; i++) {
          const windowStart = new Date(sorted[i].created_at).getTime();
          const windowEnd = windowStart + 24 * 60 * 60 * 1000;
          
          const windowOps = sorted.filter(op => {
            const t = new Date(op.created_at).getTime();
            return t >= windowStart && t <= windowEnd;
          });

          if (windowOps.length > 1) {
            const allUnderThreshold = windowOps.every(op => convertToUSD(op.amount_in, op.currency_in) < 3000);
            const totalUSD = windowOps.reduce((sum, op) => sum + convertToUSD(op.amount_in, op.currency_in), 0);

            if (allUnderThreshold && totalUSD >= 3000) {
              const alertId = `PITUFEO_24H_${clientName.replace(/\s+/g, "_")}_${sorted[i].id}`;
              const dbStatus = statusMap.get(alertId) || { status: 'PENDING', notes: '' };
              
              alerts.push({
                id: alertId,
                client_name: clientName,
                rule: "Fraccionamiento 24h (Pitufeo)",
                description: `Se detectaron ${windowOps.length} operaciones en menos de 24 horas que suman $${totalUSD.toFixed(2)} USD (todas menores a $3,000 USD para eludir el control de supervisor).`,
                risk: totalUSD >= 5000 ? "ROJO" : "AMARILLO",
                timestamp: sorted[i].created_at,
                operations: windowOps.map(op => op.id),
                status: dbStatus.status,
                notes: dbStatus.notes,
                updated_at: dbStatus.updated_at
              });
              break; // avoid duplicate alert triggers for overlapping periods
            }
          }
        }

        // Rule B: Staggered Operations (7 Days window)
        for (let i = 0; i < sorted.length; i++) {
          const windowStart = new Date(sorted[i].created_at).getTime();
          const windowEnd = windowStart + 7 * 24 * 60 * 60 * 1000;
          
          const windowOps = sorted.filter(op => {
            const t = new Date(op.created_at).getTime();
            return t >= windowStart && t <= windowEnd;
          });

          if (windowOps.length >= 3) {
            const totalUSD = windowOps.reduce((sum, op) => sum + convertToUSD(op.amount_in, op.currency_in), 0);
            if (totalUSD >= 7500) {
              const alertId = `FRAC_7D_${clientName.replace(/\s+/g, "_")}_${sorted[i].id}`;
              const dbStatus = statusMap.get(alertId) || { status: 'PENDING', notes: '' };

              alerts.push({
                id: alertId,
                client_name: clientName,
                rule: "Fraccionamiento Semanal",
                description: `Se registraron ${windowOps.length} operaciones en un lapso de 7 días que suman un volumen inusual de $${totalUSD.toFixed(2)} USD.`,
                risk: "ROJO",
                timestamp: sorted[i].created_at,
                operations: windowOps.map(op => op.id),
                status: dbStatus.status,
                notes: dbStatus.notes,
                updated_at: dbStatus.updated_at
              });
              break;
            }
          }
        }

        // Rule C: Transactional Profile Breach (30 days threshold)
        const totalMonthlyUSD = sorted.reduce((sum, op) => {
          const isWithin30Days = (Date.now() - new Date(op.created_at).getTime()) <= 30 * 24 * 60 * 60 * 1000;
          return isWithin30Days ? sum + convertToUSD(op.amount_in, op.currency_in) : sum;
        }, 0);

        if (totalMonthlyUSD >= 10000) {
          const alertId = `PERFIL_30D_${clientName.replace(/\s+/g, "_")}`;
          const dbStatus = statusMap.get(alertId) || { status: 'PENDING', notes: '' };

          alerts.push({
            id: alertId,
            client_name: clientName,
            rule: "Perfil Transaccional Excedido (30 días)",
            description: `El volumen acumulado del cliente en los últimos 30 días es de $${totalMonthlyUSD.toFixed(2)} USD, lo cual excede el perfil transaccional de ventanilla ($10,000 USD).`,
            risk: "AMARILLO",
            timestamp: sorted[sorted.length - 1].created_at,
            operations: sorted.map(op => op.id),
            status: dbStatus.status,
            notes: dbStatus.notes,
            updated_at: dbStatus.updated_at
          });
        }
      }

      res.json({ status: "success", data: alerts });
    } catch (error) {
      console.error("Error analyzing PLD rules:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 10. Resolve or take action on PLD behavior alerts
  app.post("/api/compliance/pld-alert-action", express.json(), (req, res) => {
    const { alertId, status, notes, resolvedBy } = req.body;
    if (!alertId || !status) {
      return res.status(400).json({ status: "error", message: "Faltan alertId o status." });
    }

    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO pld_alert_status (alert_id, status, notes, resolved_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(alert_id) DO UPDATE SET
          status = excluded.status,
          notes = excluded.notes,
          resolved_by = excluded.resolved_by,
          updated_at = excluded.updated_at
      `).run(alertId, status, notes || "", resolvedBy || "OFICIAL_CUMPLIMIENTO", now);

      res.json({ status: "success", message: "Alerta actualizada correctamente." });
    } catch (error) {
      console.error("Error taking action on PLD alert:", error);
      res.status(500).json({ status: "error", message: (error as Error).message });
    }
  });

  // 11. Export CNBV TXT Layout directly from SaaS DB
  app.get("/api/compliance/export-layout", (req, res) => {
    const { type } = req.query;
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    try {
      let content = "";
      if (type === "RELEVANTE") {
        const ops = db.prepare("SELECT * FROM Operaciones_Captacion ORDER BY created_at DESC").all() as any[];
        const relevantOps = ops.filter(op => convertToUSD(op.amount_in, op.currency_in) >= 7500);

        content += "TIPO_REPORTE|ID_OPERACION|FECHA|HORA|MONEDA|MONTO|CONVERSION_USD|CLIENTE|DETALLES|CUMPLIMIENTO\n";
        
        relevantOps.forEach(op => {
          const usdVal = convertToUSD(op.amount_in, op.currency_in);
          const dateObj = new Date(op.created_at);
          const dateStr = dateObj.toISOString().slice(0, 10);
          const timeStr = dateObj.toTimeString().slice(0, 8);

          content += `RELEVANTE|${op.id}|${dateStr}|${timeStr}|${op.currency_in}|${op.amount_in}|${usdVal.toFixed(2)}|${op.client_name.toUpperCase()}||CUMPLIDO_SOCI\n`;
        });
      } else {
        const reports = db.prepare("SELECT * FROM reportes_aml ORDER BY created_at DESC").all() as any[];
        content += "TIPO_REPORTE|ID_REPORTE|FECHA|MONTO_USD|CLIENTE|DESCRIPCION|OFICIAL_AUTORIZADOR\n";

        reports.forEach(r => {
          const dateStr = new Date(r.created_at).toISOString().slice(0, 10);
          content += `INUSUAL|${r.id}|${dateStr}|${r.amount_usd.toFixed(2)}|${r.client_name.toUpperCase()}|${r.description.replace(/\n/g, " ")}|${r.oficial_id || "OFICIAL_CUMPLIMIENTO"}\n`;
        });
      }

      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename=CNBV_LAYOUT_${type}_${nowStr}.txt`);
      res.status(200).send(content);
    } catch (err) {
      console.error("Error exporting CNBV layout:", err);
      res.status(500).send("Error generating CNBV layout text file.");
    }
  });

  // Serve uploads directory
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

async function startServer() {
  const app = await createApp();
  // FIX deploy 2026-09-03: puerto desde entorno (Hostinger asigna PORT por env).
  // Default 3000 para desarrollo local.
  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
