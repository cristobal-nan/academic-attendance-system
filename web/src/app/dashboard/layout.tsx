// src/app/dashboard/layout.tsx
import AuthGuard from '@/context/AuthGuard';
import { ReactNode } from 'react';
import DashboardNavbar from '@/components/DashboardNavbar'; // Asegúrate que la ruta sea correcta

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthGuard> {/* AuthGuard envuelve todo el contenido del dashboard */}
      <div className="min-h-screen bg-gray-50">
        <DashboardNavbar /> {/* La Navbar se muestra aquí */}
        
        {/* El contenido específico de cada página del dashboard */}
        <main className="container mx-auto p-4 sm:p-6">
          {children}
        </main>
        
        {/* Podrías añadir un DashboardFooter aquí si lo necesitas */}
        {/* <footer className="bg-gray-200 p-4 text-center text-sm text-gray-600">
          © {new Date().getFullYear()} Plataforma de Gestión
        </footer> */}
      </div>
    </AuthGuard>
  );
}