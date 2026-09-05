import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { 
  generateToken, 
  hashPassword, 
  verifyPassword, 
  sanitizeUser,
  AuthenticatedRequest 
} from '../middleware/auth';
import { 
  recordFailedAttempt, 
  clearFailedAttempts 
} from '../middleware/security';
import db from '../db/database';

// Validaciones para login
export const loginValidation = [
  body('auth_user_id')
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('ID de usuario inválido'),
  body('password')
    .isLength({ min: 6, max: 100 })
    .withMessage('La contraseña debe tener entre 6 y 100 caracteres')
];

// Validaciones para cambio de contraseña
export const passwordChangeValidation = [
  body('currentPassword')
    .isLength({ min: 1 })
    .withMessage('Contraseña actual requerida'),
  body('newPassword')
    .isLength({ min: 8, max: 100 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('La nueva contraseña debe tener al menos 8 caracteres, incluyendo mayúsculas, minúsculas, números y símbolos')
];

// Función para registrar eventos de seguridad
const logSecurityEvent = (authUserId: string, eventType: string, req: Request, success: boolean, details: any = null) => {
  try {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    const stmt = db.prepare(`
      INSERT INTO security_audit_log (auth_user_id, event_type, ip_address, user_agent, success, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(authUserId, eventType, ip, userAgent, success ? 1 : 0, JSON.stringify(details));
  } catch (error) {
    console.error('Error logging security event:', error);
  }
};

// Login con autenticación real
export const login = async (req: Request, res: Response) => {
  try {
    // Validar entrada
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Datos de entrada inválidos',
        errors: errors.array()
      });
    }

    const { auth_user_id, password } = req.body;

    // Buscar usuario en la base de datos
    const user = db.prepare(`
      SELECT * FROM User_Profiles 
      WHERE auth_user_id = ? AND password_hash IS NOT NULL
    `).get(auth_user_id);

    if (!user) {
      recordFailedAttempt(req);
      logSecurityEvent(auth_user_id, 'LOGIN_FAILED', req, false, { reason: 'User not found' });
      
      return res.status(401).json({
        status: 'error',
        message: 'Credenciales inválidas'
      });
    }

    // Verificar si la cuenta está bloqueada
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      logSecurityEvent(auth_user_id, 'LOGIN_FAILED', req, false, { reason: 'Account locked' });
      
      return res.status(423).json({
        status: 'error',
        message: 'Cuenta temporalmente bloqueada por motivos de seguridad'
      });
    }

    // Verificar contraseña
    const isValidPassword = await verifyPassword(password, user.password_hash);
    
    if (!isValidPassword) {
      recordFailedAttempt(req);
      
      // Incrementar contador de intentos fallidos en la base de datos
      const failedAttempts = (user.failed_login_attempts || 0) + 1;
      let updateFields = 'failed_login_attempts = ?';
      let updateValues = [failedAttempts];
      
      // Bloquear cuenta después de 3 intentos fallidos
      if (failedAttempts >= 3) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
        updateFields += ', locked_until = ?';
        updateValues.push(lockUntil.toISOString());
      }
      
      db.prepare(`UPDATE User_Profiles SET ${updateFields} WHERE auth_user_id = ?`)
        .run(...updateValues, auth_user_id);

      logSecurityEvent(auth_user_id, 'LOGIN_FAILED', req, false, { reason: 'Invalid password', attempts: failedAttempts });

      return res.status(401).json({
        status: 'error',
        message: 'Credenciales inválidas'
      });
    }

    // Login exitoso - limpiar intentos fallidos
    clearFailedAttempts(req);
    
    db.prepare(`
      UPDATE User_Profiles 
      SET failed_login_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP
      WHERE auth_user_id = ?
    `).run(auth_user_id);

    // Generar JWT
    const token: string = generateToken(user);
    
    // Crear sesión activa
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    db.prepare(`
      INSERT INTO active_sessions (id, auth_user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, auth_user_id, token.slice(0, 50), expiresAt.toISOString(), ip, userAgent);

    logSecurityEvent(auth_user_id, 'LOGIN_SUCCESS', req, true, { session_id: sessionId });

    res.json({
      status: 'success',
      message: 'Autenticación exitosa',
      data: {
        user: sanitizeUser(user),
        token,
        expiresAt: expiresAt.toISOString(),
        forcePasswordChange: user.force_password_change === 1
      }
    });

  } catch (error) {
    console.error('Error in login:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
};

// Obtener perfil del usuario autenticado
export const getProfile = (req: AuthenticatedRequest, res: Response) => {
  try {
    // FIX Fase 5: seleccionar el perfil COMPLETO incluyendo puesto,
    // custom_permissions e is_active. Antes solo devolvía 6 columnas y el
    // frontend (UserProfile) necesita custom_permissions para los permisos,
    // lo que causaba pantallas en blanco al recargar.
    const user = db.prepare(`
      SELECT auth_user_id, nickname, puesto, role_level, branch_id,
             custom_permissions, is_active, last_login, created_at
      FROM User_Profiles 
      WHERE auth_user_id = ?
    `).get(req.user?.auth_user_id);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'Usuario no encontrado'
      });
    }

    res.json(sanitizeUser(user));
  } catch (error) {
    console.error('Error getting profile:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
};

// Cambiar contraseña
export const changePassword = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Datos de entrada inválidos',
        errors: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;
    const authUserId = req.user?.auth_user_id;

    if (!authUserId) {
      return res.status(401).json({
        status: 'error',
        message: 'Usuario no autenticado'
      });
    }

    // Obtener usuario actual
    const user = db.prepare(`
      SELECT * FROM User_Profiles WHERE auth_user_id = ?
    `).get(authUserId);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'Usuario no encontrado'
      });
    }

    // Verificar contraseña actual
    const isCurrentValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isCurrentValid) {
      logSecurityEvent(authUserId, 'PASSWORD_CHANGE_FAILED', req, false, { reason: 'Invalid current password' });
      
      return res.status(400).json({
        status: 'error',
        message: 'La contraseña actual es incorrecta'
      });
    }

    // Generar hash de nueva contraseña
    const newPasswordHash = await hashPassword(newPassword);

    // Actualizar contraseña
    db.prepare(`
      UPDATE User_Profiles 
      SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, force_password_change = FALSE
      WHERE auth_user_id = ?
    `).run(newPasswordHash, authUserId);

    // Invalidar todas las sesiones activas del usuario (forzar re-login)
    db.prepare(`
      UPDATE active_sessions SET is_active = FALSE WHERE auth_user_id = ?
    `).run(authUserId);

    logSecurityEvent(authUserId, 'PASSWORD_CHANGE_SUCCESS', req, true);

    res.json({
      status: 'success',
      message: 'Contraseña cambiada exitosamente. Por seguridad, debe iniciar sesión nuevamente.'
    });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
};

// Logout
export const logout = (req: AuthenticatedRequest, res: Response) => {
  try {
    const authUserId = req.user?.auth_user_id;
    
    if (authUserId) {
      // Invalidar todas las sesiones activas del usuario
      db.prepare(`
        UPDATE active_sessions SET is_active = FALSE WHERE auth_user_id = ?
      `).run(authUserId);

      logSecurityEvent(authUserId, 'LOGOUT', req, true);
    }

    res.json({
      status: 'success',
      message: 'Sesión cerrada exitosamente'
    });

  } catch (error) {
    console.error('Error in logout:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
};