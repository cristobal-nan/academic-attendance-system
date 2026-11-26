"use client";

import { useState, useEffect } from 'react'; // Añade useEffect
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext'; // <--- USA EL CONTEXTO
import Button from '@/components/Button';

export default function LoginPage() {
  const router = useRouter();
  const { login, user, isLoading: authIsLoading } = useAuth(); // <--- OBTÉN login Y user DEL CONTEXTO
  const [isProcessingLogin, setIsProcessingLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirigir si el usuario ya está logueado
  useEffect(() => {
    if (!authIsLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, authIsLoading, router]);


  const handleLogin = async () => {
    setIsProcessingLogin(true);
    setError(null);
    try {
      await login(); // Llama a la función login del AuthContext
      // La redirección es manejada por AuthGuard al cambiar el estado `user`
        } catch (err) {
      console.error("Error al iniciar sesión desde LoginPage:", err);
      if (err instanceof Error) {
        setError(err.message || "Ocurrió un error durante el inicio de sesión.");
      } else {
        setError("Ocurrió un error durante el inicio de sesión.");
      }
        } finally {
      setIsProcessingLogin(false);
    }
  };

  // No mostrar nada o un spinner mientras se verifica el estado de auth inicial
  if (authIsLoading || (!authIsLoading && user)) {
    return <div className="flex items-center justify-center min-h-screen">Cargando...</div>;
  }

  return (
    // ... (El mismo JSX que antes, pero el botón usa isProcessingLogin)
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-3xl font-bold text-center text-gray-700 mb-6">
          Iniciar Sesión
        </h1>
        <p className="text-center text-gray-500 mb-8">
          Accede a la plataforma de gestión de asistencia.
        </p>
        {error && (
          <p className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">
            Error: {error}
          </p>
        )}
        <Button
          onClick={handleLogin}
          variant="primary"
          className="w-full py-3 text-lg"
          disabled={isProcessingLogin}
        >
          {isProcessingLogin ? 'Iniciando sesión...' : 'Iniciar sesión con Google'}
        </Button>
      </div>
    </div>
  );
}