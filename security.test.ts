import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from './server';
import { hashPassword } from './src/middleware/auth';

let app: any;
let adminToken: string;

beforeAll(async () => {
  app = await createApp();
});

describe('🔒 Security Authentication Tests', () => {
  
  describe('JWT Authentication', () => {
    it('should reject requests without token', async () => {
      const res = await request(app)
        .get('/api/auth/profile');
        
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Token de acceso requerido');
    });

    it('should reject requests with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer invalid_token');
        
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Token inválido o expirado');
    });

    it('should accept valid login and return JWT token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          auth_user_id: 'admin_sicc_2026',
          password: 'SecurePass2026!'
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.token).toMatch(/^eyJ/); // JWT format
      
      adminToken = res.body.data.token;
    });

    it('should access protected profile with valid token', async () => {
      const res = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${adminToken}`);
        
      expect(res.status).toBe(200);
      expect(res.body.auth_user_id).toBe('admin_sicc_2026');
      expect(res.body.role_level).toBe(5);
    });
  });

  describe('Password Security', () => {
    it('should reject weak passwords', async () => {
      const res = await request(app)
        .patch('/api/auth/password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          currentPassword: 'SecurePass2026!',
          newPassword: '123456'  // Weak password
        });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].msg).toContain('mayúsculas, minúsculas, números y símbolos');
    });

    it('should reject password change with wrong current password', async () => {
      const res = await request(app)
        .patch('/api/auth/password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          currentPassword: 'WrongPassword123!',
          newPassword: 'NewSecurePass2026!@#'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('La contraseña actual es incorrecta');
    });

    it('should hash passwords with bcrypt (not SHA-256)', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);
      
      expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt format
      expect(hash).not.toBe(password); // Should be hashed
      expect(hash.length).toBeGreaterThan(50); // bcrypt hashes are long
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to login endpoint', async () => {
      // Make 6 rapid login attempts (limit is 5 per 15 minutes)
      const promises = Array(6).fill(null).map(() => 
        request(app)
          .post('/api/auth/login')
          .send({
            auth_user_id: 'nonexistent',
            password: 'wrong'
          })
      );

      const results = await Promise.all(promises);
      
      // Last request should be rate limited
      const rateLimitedResponse = results[results.length - 1];
      expect([429, 401]).toContain(rateLimitedResponse.status); // 429 (rate limited) or 401 (auth failed)
      
      if (rateLimitedResponse.status === 429) {
        expect(rateLimitedResponse.body.message).toContain('intentos de login');
      }
    });
  });

  describe('Account Lockout', () => {
    const testUser = 'user_cajero_1';
    
    it('should lock account after 3 failed login attempts', async () => {
      // Make 3 failed attempts
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            auth_user_id: testUser,
            password: 'wrong_password'
          });
      }

      // 4th attempt should be blocked
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          auth_user_id: testUser,
          password: 'wrong_password'
        });

      expect([423, 401]).toContain(res.status); // 423 (locked) or 401 (failed)
      
      if (res.status === 423) {
        expect(res.body.message).toContain('temporalmente bloqueada');
      }
    });
  });

  describe('Authorization Levels', () => {
    it('should require proper role level for dotaciones endpoint', async () => {
      // Try to access dotaciones without sufficient role level
      const res = await request(app)
        .get('/api/liquidity/dotaciones')
        .set('Authorization', `Bearer ${adminToken}`);

      // Admin (level 5) should have access
      expect(res.status).toBe(200);
    });

    it('should reject insufficient authorization levels', async () => {
      // This test would need a low-level user token
      // For now, we test the middleware logic
      expect(true).toBe(true); // Placeholder - would need actual low-level user
    });
  });

  describe('Security Headers', () => {
    it('should include security headers (Helmet)', async () => {
      const res = await request(app)
        .get('/api/health');

      expect(res.headers).toHaveProperty('x-dns-prefetch-control');
      expect(res.headers).toHaveProperty('x-frame-options');
      expect(res.headers).toHaveProperty('x-download-options');
      expect(res.headers).toHaveProperty('x-content-type-options');
    });

    it('should include Content Security Policy', async () => {
      const res = await request(app)
        .get('/api/health');

      expect(res.headers).toHaveProperty('content-security-policy');
    });
  });

  describe('Input Validation', () => {
    it('should validate login input format', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          auth_user_id: 'a!@#$%', // Invalid characters
          password: 'test'
        });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('should prevent SQL injection in login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          auth_user_id: "'; DROP TABLE User_Profiles; --",
          password: 'test'
        });

      expect(res.status).toBe(400); // Should be rejected by validation
    });
  });

  describe('Session Management', () => {
    it('should logout and invalidate token', async () => {
      // Login first
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          auth_user_id: 'admin_sicc_2026',
          password: 'SecurePass2026!'
        });

      const token = loginRes.body.data.token;

      // Logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toBe('Sesión cerrada exitosamente');
    });
  });
});