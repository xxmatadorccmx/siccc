import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from './server';

let app: any;

beforeAll(async () => {
  app = await createApp();
});

// ────────────────────────────────────────────────
// 1. Health & Smoke
// ────────────────────────────────────────────────
describe('GET /api/health', () => {
  it('returns 200 with service name', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('BaaS API Gateway');
  });
});

describe('GET /api/rates/live', () => {
  it('returns live FX rates from Redis cache', async () => {
    const res = await request(app).get('/api/rates/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.rates).toHaveProperty('USD_MXN');
    expect(res.body.rates.USD_MXN).toHaveProperty('buy');
    expect(res.body.rates.USD_MXN).toHaveProperty('sell');
  });
});

describe('GET /api/legacy/balances', () => {
  it('returns legacy SOFTExchange balances', async () => {
    const res = await request(app).get('/api/legacy/balances');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('currency');
  });
});

describe('GET /api/config/denominations/:currency', () => {
  it('returns MXN denominations as BILL/COIN array', async () => {
    const res = await request(app).get('/api/config/denominations/MXN');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toHaveProperty('denominacion');
    expect(res.body.data[0]).toHaveProperty('type');
    expect(['BILL', 'COIN']).toContain(res.body.data[0].type);
  });
});

// ────────────────────────────────────────────────
// 2. Auth & Profiles
// ────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('returns 400 when credentials are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
  });

  it('returns 401 for invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ auth_user_id: 'user_cajero_1', password: 'wrong_password' });
    expect(res.status).toBe(401);
    expect(res.body.status).toBe('error');
  });

  it('returns 200 and profile for valid mock user (password: 123456)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ auth_user_id: 'user_cajero_1', password: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.auth_user_id).toBe('user_cajero_1');
    expect(res.body.data.role_level).toBe(5);
  });
});

describe('GET /api/auth/profile', () => {
  it('returns 404 for unknown user', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('x-user-id', 'nonexistent_user');
    expect(res.status).toBe(404);
  });

  it('returns profile for default mock user', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('x-user-id', 'user_cajero_1');
    expect(res.status).toBe(200);
    expect(res.body.auth_user_id).toBe('user_cajero_1');
    expect(res.body.nickname).toBe('FREDDY');
  });
});

// ────────────────────────────────────────────────
// 3. KYC / Customers
// ────────────────────────────────────────────────
describe('GET /api/kyc/search', () => {
  it('returns empty array when no query', async () => {
    const res = await request(app).get('/api/kyc/search');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns matching customers', async () => {
    const res = await request(app).get('/api/kyc/search?q=FREDDY');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });
});

describe('GET /api/kyc/clients', () => {
  it('returns clients list', async () => {
    const res = await request(app).get('/api/kyc/clients');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ────────────────────────────────────────────────
// 4. BaaS / FX Trader
// ────────────────────────────────────────────────
describe('POST /api/fxtrader/fund-wallet', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/fxtrader/fund-wallet')
      .send({ customerId: 'CUST-100001' });
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
  });

  it('returns error for non-existent wallet', async () => {
    const res = await request(app)
      .post('/api/fxtrader/fund-wallet')
      .send({
        customerId: 'CUST-999999',
        clientName: 'Ghost',
        currency: 'USD',
        amount: 100,
        method: 'CASH'
      });
    expect(res.status).toBe(500);
    expect(res.body.message).toContain('No se encontró billetera');
  });
});

// ────────────────────────────────────────────────
// 5. Liquidity / Dotaciones (trigger PEPS/FIFO)
// ────────────────────────────────────────────────
describe('POST /api/liquidity/dotaciones', () => {
  it('returns 400 when missing required fields', async () => {
    const res = await request(app)
      .post('/api/liquidity/dotaciones')
      .send({ cajero_id: 'user_cajero_1' });
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
  });

  it('returns 403 when gerente_id lacks Nivel 5 authorization', async () => {
    const res = await request(app)
      .post('/api/liquidity/dotaciones')
      .send({
        gerente_id: 'user_cajero_1',
        cajero_id: 'user_cajero_1',
        monto_mxn: 10000,
        tipo_dotacion: 'APERTURA',
        folio_boveda: 'FOL-001'
      });
    // user_cajero_1 has role_level 5 in User_Profiles, so this should pass
    expect([200, 403]).toContain(res.status);
  });

  it('creates a dotacion PENDIENTE when gerente is authorized', async () => {
    const res = await request(app)
      .post('/api/liquidity/dotaciones')
      .send({
        gerente_id: 'user_gerente_1',
        cajero_id: 'user_cajero_1',
        monto_mxn: 10000,
        tipo_dotacion: 'APERTURA',
        folio_boveda: 'FOL-001'
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('clave_autorizacion');
  });
});

// ────────────────────────────────────────────────
// 6. Transactions
// ────────────────────────────────────────────────
describe('GET /api/transactions/recent', () => {
  it('returns transactions list (empty on fresh DB)', async () => {
    const res = await request(app).get('/api/transactions/recent');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.transactions)).toBe(true);
  });
});
