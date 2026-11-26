"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'; // Importa useCallback
import { usePathname } from 'next/navigation'; // usePathname puede ser útil
import { onAuthStateChanged, User as FirebaseUser, signOut as firebaseSignOut, signInWithPopup, UserCredential } from 'firebase/auth';
import { auth, googleProvider, app } from '@/lib/firebaseConfig'; //
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { authenticatedFetch as originalAuthenticatedFetch } from '@/lib/apiClient'; //
import { UserData, AuthContextType } from '@/types';

const db = getFirestore(app);
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();

  // --- NUEVO ESTADO PARA EL MODAL ---
  const [isSessionExpiredModalOpen, setIsSessionExpiredModalOpen] = useState(false);
  // --- FIN NUEVO ESTADO ---

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        const idTokenResult = await firebaseUser.getIdTokenResult();
        const newIdToken = idTokenResult.token;
        let userRolesFromDb: string[] | null = null;
        let userNombresFromDb: string | null = null; // <--- AÑADIDO
        let userApellidosFromDb: string | null = null; // <--- AÑADIDO
        let userDisplayNameFromDb: string | null = firebaseUser.displayName; // Default al de Firebase Auth
        
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            const userDataFromDb = userDocSnap.data();
            // Roles
            const rolesField = userDataFromDb?.roles;
            if (Array.isArray(rolesField)) { /* ... lógica de roles ... */ userRolesFromDb = rolesField.filter(role => typeof role === 'string');}
            else if (typeof rolesField === 'string') { userRolesFromDb = [rolesField]; }
            else { userRolesFromDb = [];}

            // --- INICIO DE CAMBIO: Cargar nombres y apellidos desde Firestore ---
            userNombresFromDb = userDataFromDb?.nombres || null;
            userApellidosFromDb = userDataFromDb?.apellidos || null;
            // Priorizar displayName de Firestore si existe (puede haber sido establecido por un admin)
            if (userDataFromDb?.displayName) {
                userDisplayNameFromDb = userDataFromDb.displayName;
            }
            // --- FIN DE CAMBIO ---

          } else {
            console.warn(`Documento de usuario no encontrado en Firestore para UID: ${firebaseUser.uid}. Usando datos de Auth.`);
            userRolesFromDb = []; // O el default que prefieras
          }
        } catch (e) {
          console.error("Error fetching user profile details from Firestore:", e);
          userRolesFromDb = []; // Default en caso de error
        }

        const newUserData: UserData = {
          uid: firebaseUser.uid,
          displayName: userDisplayNameFromDb, // Usar el displayName de Firestore o el de Auth
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL,
          roles: userRolesFromDb,
          nombres: userNombresFromDb,         // <--- AÑADIDO
          apellidos: userApellidosFromDb,    // <--- AÑADIDO
        };

        setUser(newUserData);
        setToken(newIdToken);
        localStorage.setItem('firebaseIdToken', newIdToken);
        localStorage.setItem('userData', JSON.stringify(newUserData));
      } else {
        setUser(null);
        setToken(null);
        localStorage.removeItem('firebaseIdToken');
        localStorage.removeItem('userData');
        // Si el usuario se desloguea, cerramos el modal si estuviera abierto.
        // Esto podría pasar si el logout se invoca desde el modal.
        if (isSessionExpiredModalOpen) {
          setIsSessionExpiredModalOpen(false);
        }
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [isSessionExpiredModalOpen]); // Añadir isSessionExpiredModalOpen a las dependencias si lo modificas dentro

  const login = useCallback(async () => { // Envuelto en useCallback si aún no lo estaba
    try {
      const result: UserCredential = await signInWithPopup(auth, googleProvider);
      const firebaseUser = result.user;

      // --- INICIO DE VERIFICACIÓN DE DOMINIO ---
      if (firebaseUser && firebaseUser.email && !firebaseUser.email.toLowerCase().endsWith('@mail.udp.cl')) {
      console.warn(`Intento de inicio de sesión con correo no permitido: ${firebaseUser.email}`);
      await firebaseSignOut(auth); // Desloguear inmediatamente de Firebase
      // El listener onAuthStateChanged se encargará de limpiar el estado local (user, token).
      throw new Error('Solo se permiten cuentas de correo @mail.udp.cl para iniciar sesión.');
      }
      // --- FIN DE VERIFICACIÓN DE DOMINIO ---
    } catch (error) {
      console.error("Error en AuthContext login:", error);
      throw error;
    }
  }, []); 

  // Usa useCallback para `logout` y las nuevas funciones si se pasan como dependencias o props
  const logout = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
      // onAuthStateChanged limpiará user, token y localStorage.
      // AuthGuard se encargará de la redirección a /login.
      // No es necesario router.push('/login') aquí.
    } catch (error) {
      console.error("Error en AuthContext logout:", error);
    }
  }, []); // Vacío si no depende de nada que cambie, o añade dependencias como `router` si es necesario.

  // --- NUEVAS FUNCIONES PARA EL MODAL Y LOGOUT ---
  const showSessionExpiredModalInternal = useCallback(() => {
    // Solo mostrar el modal si no estamos ya en la página de login
    // y si el modal no está ya abierto (para evitar múltiples triggers)
    if (pathname !== '/login' && !isSessionExpiredModalOpen) {
      console.log("Mostrando modal de sesión expirada.");
      setIsSessionExpiredModalOpen(true);
    }
  }, [pathname, isSessionExpiredModalOpen]);

  const closeSessionExpiredModalAndLogout = useCallback(async () => {
    console.log("Cerrando modal y ejecutando logout.");
    setIsSessionExpiredModalOpen(false);
    await logout(); // Llama a la función principal de logout
  }, [logout]);
  // --- FIN NUEVAS FUNCIONES ---

  // --- NUEVA FUNCIÓN `authFetch` ENVUELTA ---
  const authFetch = useCallback(async (endpoint: string, options: RequestInit = {}): Promise<Response> => {
    try {
      const response = await originalAuthenticatedFetch(endpoint, options);
      // La lógica de `originalAuthenticatedFetch` ya lanza el error 'Sesión inválida o expirada.'
      // si el status es 401. No es necesario duplicar la verificación de status aquí.
      return response;
    } catch (error) {
      if (error instanceof Error && error.message === 'Sesión inválida o expirada.') {
      console.log("Error de sesión inválida capturado por authFetch, mostrando modal.");
      showSessionExpiredModalInternal();
      // Lanzamos el error de nuevo para que el componente que llamó pueda manejarlo (ej. detener un spinner)
      // PERO, si el modal se muestra, el flujo del usuario se interrumpe.
      // El componente probablemente no necesitará hacer mucho más con este error específico.
      }
      // Siempre relanzar el error para que el llamador original sepa que la petición falló
      throw error;
    }
  }, [showSessionExpiredModalInternal]); // `pathname` e `isSessionExpiredModalOpen` ya son dependencias de `showSessionExpiredModalInternal`
  // --- FIN NUEVA FUNCIÓN `authFetch` ---

  return (
    <AuthContext.Provider value={{
      user, token, isLoading, login, logout,
      isSessionExpiredModalOpen,
      closeSessionExpiredModalAndLogout,
      authFetch
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
};