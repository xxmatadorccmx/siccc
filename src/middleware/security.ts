import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

// Estructura para tracking de intentos fallidos por IP + usuario
interface FailedAttempts {
  [key: string]: {
    count: number;
    firstAttempt: number;
    lockUntil?: number;
  };
}

const failedAttempts: FailedAttempts = {};
const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutos en milliseconds
const ATTEMPT_WINDOW = 60 * 60 * 1000; // 1 hora en milliseconds

// Rate limiting general (1000 requests por 15 minutos por IP)
// Nota Fase 5: 100 era demasiado estricto para una SPA React — cada módulo
// hace múltiples llamadas API al cargar. 1000 es razonable para desarrollo.
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    status: 'error',
    message: 'Demasiadas solicitudes desde esta IP. Intente de nuevo en 15 minutos.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting estricto para login (20 intentos por 15 minutos por IP)
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 login attempts per windowMs
  message: {
    status: 'error',
    message: 'Demasiados intentos de login desde esta IP. Intente de nuevo en 15 minutos.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Middleware de bloqueo por usuario específico
export const accountLockout = (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const { auth_user_id } = req.body;
  
  if (!auth_user_id) {
    return next(); // Si no hay usuario, continúa (la validación fallará después)
  }

  const key = `${ip}:${auth_user_id}`;
  const now = Date.now();
  const attempt = failedAttempts[key];

  if (attempt) {
    // Si la cuenta está bloqueada, verificar si ya pasó el tiempo
    if (attempt.lockUntil && now < attempt.lockUntil) {
      const timeLeft = Math.ceil((attempt.lockUntil - now) / 1000 / 60); // minutos restantes
      return res.status(423).json({
        status: 'error',
        message: `Cuenta temporalmente bloqueada. Intente de nuevo en ${timeLeft} minutos.`,
        lockUntil: attempt.lockUntil
      });
    }

    // Si ya pasó el tiempo de bloqueo, resetear
    if (attempt.lockUntil && now >= attempt.lockUntil) {
      delete failedAttempts[key];
    }
  }

  next();
};

// Registrar intento fallido
export const recordFailedAttempt = (req: Request) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const { auth_user_id } = req.body;
  
  if (!auth_user_id) return;

  const key = `${ip}:${auth_user_id}`;
  const now = Date.now();
  const attempt = failedAttempts[key];

  if (!attempt) {
    // Primer intento fallido
    failedAttempts[key] = {
      count: 1,
      firstAttempt: now
    };
  } else {
    // Verificar si está dentro de la ventana de tiempo
    if (now - attempt.firstAttempt > ATTEMPT_WINDOW) {
      // Reset si pasó más de 1 hora desde el primer intento
      failedAttempts[key] = {
        count: 1,
        firstAttempt: now
      };
    } else {
      // Incrementar contador
      attempt.count++;

      // Bloquear si se alcanzó el máximo
      if (attempt.count >= MAX_FAILED_ATTEMPTS) {
        attempt.lockUntil = now + LOCKOUT_TIME;
        
        console.warn(`[SECURITY] Account lockout for ${auth_user_id} from IP ${ip}. ${attempt.count} failed attempts.`);
      }
    }
  }
};

// Limpiar intento exitoso
export const clearFailedAttempts = (req: Request) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const { auth_user_id } = req.body;
  
  if (!auth_user_id) return;

  const key = `${ip}:${auth_user_id}`;
  delete failedAttempts[key];
};

// Limpieza periódica de registros antiguos (ejecutar cada hora)
export const cleanupOldAttempts = () => {
  const now = Date.now();
  
  Object.keys(failedAttempts).forEach(key => {
    const attempt = failedAttempts[key];
    
    // Eliminar registros más antiguos que la ventana de tiempo
    if (now - attempt.firstAttempt > ATTEMPT_WINDOW && (!attempt.lockUntil || now > attempt.lockUntil)) {
      delete failedAttempts[key];
    }
  });
};

// Ejecutar limpieza cada hora
setInterval(cleanupOldAttempts, 60 * 60 * 1000);