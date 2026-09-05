import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'sicc_super_secret_key_change_in_production_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    auth_user_id: string;
    role_level: number;
    branch_id: string;
    nickname: string;
  };
}

// Middleware de autenticación JWT
export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      status: 'error', 
      message: 'Token de acceso requerido' 
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ 
      status: 'error', 
      message: 'Token inválido o expirado' 
    });
  }
};

// Middleware de autorización por nivel
export const requireRole = (minLevel: number) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        status: 'error', 
        message: 'Usuario no autenticado' 
      });
    }

    if (req.user.role_level < minLevel) {
      return res.status(403).json({ 
        status: 'error', 
        message: `Nivel de autorización insuficiente. Requerido: ${minLevel}, actual: ${req.user.role_level}` 
      });
    }

    next();
  };
};

// Generación de JWT
export const generateToken = (user: any): string => {
  const payload = {
    id: user.id,
    auth_user_id: user.auth_user_id,
    role_level: user.role_level,
    branch_id: user.branch_id,
    nickname: user.nickname
  };

  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: '24h',
    issuer: 'SICC-BaaS-Platform',
    audience: 'sicc-users'
  });
};

// Hash de contraseña con bcrypt
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
};

// Verificación de contraseña
export const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return await bcrypt.compare(password, hashedPassword);
};

// Limpieza de datos de usuario (sin hash de contraseña)
export const sanitizeUser = (user: any) => {
  const { password_hash, ...safeUser } = user;
  return safeUser;
};