export async function authenticatedFetch(
  endpoint: string, // Solo el endpoint, ej. '/meetings'
  options: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem('firebaseIdToken'); // O desde tu gestor de estado

  if (!token && !options.headers?.hasOwnProperty('Authorization')) { // No sobreescribir si ya se proveyó un Auth header
    // Manejar caso de no autenticado (podría lanzar error o redirigir)
    // Por ahora, lanzaremos un error para que el llamador lo maneje
    console.warn("Intentando hacer una llamada autenticada sin token.");
    // Opcionalmente, podrías querer permitir algunas llamadas sin token si el endpoint no siempre es protegido
    // throw new Error('Usuario no autenticado. Token no encontrado.');
  }

  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  let base: URL;
  try {
    base = new URL(configured ?? "");
  } catch {
    throw new Error("Configura NEXT_PUBLIC_API_BASE_URL con la URL HTTP(S) de tu API.");
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username ||
      base.password || base.search || base.hash) {
    throw new Error("Configura NEXT_PUBLIC_API_BASE_URL con la URL HTTP(S) de tu API.");
  }
  const url = `${base.href.replace(/\/+$/, "")}${endpoint}`;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const config: RequestInit = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers, // Permite sobreescribir o añadir más headers
    },
  };

  const response = await fetch(url, config);

  if (response.status === 401) {
    console.error("Error 401: No autorizado desde authenticatedFetch. Limpiando token y redirigiendo (ejemplo).");
    // Lógica para limpiar sesión y redirigir al login
    // localStorage.removeItem('firebaseIdToken');
    // localStorage.removeItem('userData');
    // if (typeof window !== "undefined") { // Asegurarse que se ejecuta en el cliente
    //   window.location.href = '/login'; // Redirección simple, usar router para mejor UX
    // }
    // Es mejor lanzar un error para que el componente que llama pueda manejar la UI.
    throw new Error('Sesión inválida o expirada.');
  }

  return response;
}
