import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css"; //
import { AuthProvider } from "@/context/AuthContext"; //
import SessionExpiredModal from "@/components/SessionExpiredModal"; // <-- IMPORTA EL MODAL

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Plataforma de Gestión UDP",
  description: "Registro de asistencia y gestión académica",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={inter.className}>
        <AuthProvider> {/* AuthProvider envuelve a los children Y al modal */}
          {children}
          <SessionExpiredModal /> {/* <-- AÑADE EL MODAL AQUÍ, DENTRO DE AuthProvider */}
        </AuthProvider>
      </body>
    </html>
  );
}