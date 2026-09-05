import { createRoot } from 'react-dom/client';
import React from 'react';
import App from './App.tsx';
import './index.css';

/**
 * ErrorBoundary — FIX 2026-09-03 (pantalla blanca en módulos):
 * Antes, cualquier error de render tumbaba todo el árbol de React y dejaba
 * la pantalla en blanco (sin mensaje). Ahora se captura y se muestra una
 * pantalla de recuperación con el detalle del error y un botón para recargar.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Error de render capturado:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#0b0e11',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            maxWidth: 560,
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: 16,
            padding: 32,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Se produjo un error</h1>
            <p style={{ color: '#9ca3af', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Ocurrió un error inesperado al renderizar este módulo. Puede intentar recargar la aplicación.
            </p>
            <pre style={{
              background: '#0d1117',
              border: '1px solid #21262d',
              borderRadius: 8,
              padding: 12,
              textAlign: 'left',
              fontSize: 11,
              color: '#f87171',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              marginBottom: 16,
            }}>
              {this.state.error.message}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{
                width: '100%',
                padding: '12px 0',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
