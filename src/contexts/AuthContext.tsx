/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * AuthContext con JWT - Integración con Backend Seguro
 * Reemplaza el sistema de headers HTTP por JWT + localStorage seguro
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, RoleLevel } from '../types/auth';
import Login from '../pages/Login';

interface AuthContextType {
  profile: UserProfile | null;
  loading: boolean;
  hasPermission: (level: RoleLevel) => boolean;
  checkCustomPermission: (key: keyof UserProfile['custom_permissions']) => any;
  login: (credentials: { auth_user_id: string; password: string }) => Promise<boolean>;
  logout: () => void;
  token: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // Función para verificar si un token es válido
  const validateToken = async (token: string): Promise<UserProfile | null> => {
    try {
      const response = await fetch('/api/auth/profile', {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      setLoading(true);
      
      try {
        // Verificar token almacenado
        const storedToken = localStorage.getItem('sicc_auth_token');
        
        if (storedToken) {
          const userData = await validateToken(storedToken);
          
          if (userData) {
            setToken(storedToken);
            setProfile(userData);
            setIsAuthenticated(true);
          } else {
            // Token inválido, limpiar
            localStorage.removeItem('sicc_auth_token');
            setIsAuthenticated(false);
          }
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const login = async (credentials: { auth_user_id: string; password: string }): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.status === 'success' && data.data.token) {
          const { token: newToken, user } = data.data;
          
          // Almacenar token de forma segura
          localStorage.setItem('sicc_auth_token', newToken);
          setToken(newToken);
          setProfile(user);
          setIsAuthenticated(true);
          
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const logout = async () => {
    try {
      if (token) {
        // Notificar al servidor del logout
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
      }
    } catch {
      // Error en logout del servidor, continuar con logout local
    } finally {
      // Limpiar estado local siempre
      localStorage.removeItem('sicc_auth_token');
      setToken(null);
      setProfile(null);
      setIsAuthenticated(false);
    }
  };

  const hasPermission = (requiredLevel: RoleLevel) => {
    if (!profile) return false;
    return profile.role_level >= requiredLevel;
  };

  const checkCustomPermission = (key: keyof UserProfile['custom_permissions']) => {
    return profile?.custom_permissions?.[key];
  };

  // Show login screen if not authenticated
  if (!loading && !isAuthenticated) {
    return <Login onLogin={login} />;
  }

  return (
    <AuthContext.Provider value={{ 
      profile, 
      loading, 
      hasPermission, 
      checkCustomPermission, 
      login, 
      logout,
      token 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};