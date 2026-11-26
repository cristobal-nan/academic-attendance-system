"use client";

import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button'; // Tu componente Button existente

export default function DashboardNavbar() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Error al cerrar sesión desde navbar:", error);
      // Manejar error si es necesario
    }
  };

  const bgColor = "bg-[#F44235]"; // Puedes hacerlo una prop si quieres variaciones
  const textColor = "text-white";

  return (
    <header className={`${bgColor} ${textColor} p-4 shadow-md sticky top-0 z-50`}>
      <div className="container mx-auto flex flex-wrap justify-between items-center">
        {/* Título e Información del Usuario */}
        <div className="mb-2 sm:mb-0">
          <h1 className="text-xl sm:text-2xl font-bold">
            Panel de Administración
          </h1>
          {user && (
            <p className="text-xs sm:text-sm">
              Bienvenido, {user.displayName || 'Usuario'} ({user.email || 'No email'})
            </p>
          )}
        </div>

        {/* Botón de Cerrar Sesión */}
        {user && ( // Mostrar solo si hay usuario
          <Button 
            onClick={handleLogout} 
            variant="secondary" 
            className={`bg-white text-gray-700 hover:bg-gray-100 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm`}
          >
            Cerrar Sesión
          </Button>
        )}
      </div>
    </header>
  );
}