"use client";

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

interface AuthGuardProps {
  children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !user && !token) {
      // Si no está cargando y no hay usuario/token, y no estamos ya en login
      if (pathname !== '/login') {
        router.replace('/login'); // Redirige a la página de login
      }
    }
  }, [user, token, isLoading, router, pathname]);

  // Si está cargando la info de auth, o si aún no hay usuario pero se está redirigiendo,
  // muestra un loader o nada para evitar un flash de contenido no autorizado.
  if (isLoading || (!user && pathname !== '/login')) {
    return <div className="flex items-center justify-center min-h-screen">Verificando sesión...</div>;
  }

  // Si hay usuario y token (y no estamos en login, aunque esto es para rutas protegidas), renderiza children
  if (user && token) {
    return <>{children}</>;
  }

  // Si estamos en la página de login y no hay usuario, permitimos que se renderice (ya manejado por login page)
  if (pathname === '/login' && !user) {
     return <>{children}</>;
  }

  return null; // O un loader general por si acaso
}