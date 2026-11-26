"use client";

import React from 'react';
import { useAuth } from '@/context/AuthContext'; // Necesitarás funciones de AuthContext
import Button from './Button'; // Tu componente Button
// No necesitas useRouter aquí si el logout y AuthGuard manejan la redirección

export default function SessionExpiredModal() {
  // Obtendremos isSessionExpiredModalOpen y la función para cerrar/logout del AuthContext
  const { isSessionExpiredModalOpen, closeSessionExpiredModalAndLogout } = useAuth();

  const handleGoToLogin = async () => {
    if (closeSessionExpiredModalAndLogout) { // Verifica si la función existe
      await closeSessionExpiredModalAndLogout();
    }
    // La redirección debería ser manejada por AuthGuard después del logout
  };

  if (!isSessionExpiredModalOpen) {
    return null; // No renderizar nada si el modal no debe estar abierto
  }

  return (
    // Overlay oscuro que cubre toda la pantalla
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[9999] p-4">
      {/* Contenedor del Modal */}
      <div className="bg-white p-6 sm:p-8 rounded-lg shadow-xl w-full max-w-md text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4">
          Sesión Expirada
        </h2>
        <p className="text-gray-600 mb-6 sm:mb-8">
          Tu sesión ha finalizado o es inválida. Por favor, inicia sesión nuevamente para continuar.
        </p>
        <Button
          onClick={handleGoToLogin}
          variant="primary" // O el variant que prefieras
          className="w-full py-2.5 sm:py-3 text-base" // Ajusta el padding y tamaño de texto si es necesario
        >
          Ir al Login
        </Button>
      </div>
    </div>
  );
}