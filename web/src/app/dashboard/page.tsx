"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext"; //
import { CourseWithSections, AdminOption } from "@/types"; //

export default function DashboardPage() {
    const { user, isLoading: authIsLoading, authFetch } = useAuth();

    const canManageCourses = user?.roles?.includes("admin") ?? false;
    const canManageSections = user?.roles?.includes("admin") ?? false;
    const canManageMeetings = user?.roles?.some(role => ["admin", "profesor", "ayudante"].includes(role)) ?? false;
    const canManageUsers = user?.roles?.includes("admin") ?? false;
    const canViewReports = user?.roles?.includes("admin") ?? false;
    const canViewMyCoursesSection = user?.roles?.some(role => ["admin", "profesor", "ayudante"].includes(role)) ?? false;
    const canViewCanvas = user?.roles?.includes("admin") ?? false;

    const [courses, setCourses] = useState<CourseWithSections[]>([]);
    const [pageLoading, setPageLoading] = useState(true); // pageLoading se refiere a la carga de los cursos
    const [error, setError] = useState<string | null>(null);

    const adminOptions: AdminOption[] = [];
    if (canManageCourses) {
        adminOptions.push({
            id: "manage-course",
            title: "Gestionar Cursos",
            description: "Define o elimina una nueva asignatura o curso en el sistema.",
            href: "/dashboard/admin/manage-courses",
        });
    }
    if (canManageSections) {
        adminOptions.push({
            id: "manage-section",
            title: "Gestionar Sección",
            description: "Añade o elimina una nueva sección o paralelo a un curso existente.",
            href: "/dashboard/admin/manage-sections",
        });
    }
    if (canManageMeetings) { // Si "Gestionar Reuniones" es una opción de admin, sino se muestra a todos los permitidos
        adminOptions.push({
            id: "manage-meeting",
            title: "Gestionar Reuniones",
            description: "Programa o elimina reuniones de clase para una sección.",
            href: "/dashboard/admin/manage-meetings",
        });
    }
    if (canManageUsers) {
        adminOptions.push({
            id: "manage-users",
            title: "Gestionar Usuarios",
            description: "Administra roles y acceso de usuarios.",
            href: "/dashboard/admin/manage-users",
        });
    }
    if (canViewReports) {
        adminOptions.push({
            id: "reportes-diarios",
            title: "Reportes Diarios",
            description: "Accede a analíticas de asistencia y secciones de hoy.",
            href: "/dashboard/admin/reports", // Esta será la nueva página principal de reportes
        });
        adminOptions.push({
            id: "alertas-tempranas",
            title: "Alertas Tempranas",
            description: "Accede a reportes de asistencia y alertas tempranas.",
            href: "/dashboard/admin/reports/early-warning", // Esta será la nueva página principal de reportes
        });
    }
    if (canViewCanvas) {
        adminOptions.push({
            id: "canvas-integration",
            title: "Integración con Canvas",
            description: "Administra la integración con la plataforma Canvas.",
            href: "/dashboard/admin/lms-integration",
        });
    }
    
    useEffect(() => {
        // La función fetchCourses ahora está definida dentro del useEffect o podría ser un useCallback
        async function fetchCoursesInternal() {
            // Ya no es necesario setPageLoading(true) aquí si el useEffect lo maneja
            // setError(null); // También se puede manejar en el useEffect
            try {
                // PASO 4: Reemplaza authenticatedFetch con authFetch
                const response = await authFetch( //
                    "/users/me/courses-with-sections"
                );
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(
                        errorData.detail ||
                        `Error al cargar los cursos: ${response.statusText}`
                    );
                }
                const data: CourseWithSections[] = await response.json();
                setCourses(data);
                // Limpiar errores en éxito
                            } catch (err) {
                                console.error("Error fetching courses in DashboardPage:", err);
                                // PASO 5: Ajusta el bloque catch
                                if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
                                    setError(err.message || "No se pudieron cargar los cursos.");
                                } else if (!(err instanceof Error)) {
                                    setError("No se pudieron cargar los cursos.");
                                }
                                setCourses([]); // Limpiar cursos en caso de error
                            } finally {
                setPageLoading(false); // Mover setPageLoading aquí asegura que se llame incluso si user no está definido al inicio
            }
        }

        if (authIsLoading) {
            setPageLoading(true); // Mantener cargando si el estado de auth está cargando
            return;
        }

        if (!user && !authIsLoading) {
            // No hay usuario y la autenticación ha terminado de cargar.
            // AuthGuard se encargará de la redirección.
            // Limpiamos el estado de la página y evitamos el fetch.
            setCourses([]);
            setPageLoading(false);
            setError(null); // O un mensaje como "Necesitas iniciar sesión"
            return;
        }

        if (user) { // Solo hacer fetch si hay un usuario
            setPageLoading(true); // Indicar que la carga de datos de la página comienza
            setError(null);
            fetchCoursesInternal();
        }

        // PASO 6: Añade authFetch al array de dependencias del useEffect
    }, [user, authIsLoading, authFetch]);
    if (authIsLoading || pageLoading) { // Mostrar cargando si auth o los datos de la página están cargando
        return (
            <div className="flex items-center justify-center min-h-[calc(100vh-100px)]"> {/* Ajusta min-h según tu navbar */}
                Cargando panel...
            </div>
        );
    }

    // Si no hay usuario después de la carga de auth, AuthGuard debería haber redirigido.
    // No es estrictamente necesario este return si AuthGuard es efectivo.
    if (!user) {
        return (
            <div className="flex items-center justify-center min-h-[calc(100vh-100px)]">
                Redirigiendo a login...
            </div>
        );
    }

    return (
        <>
            {/* Sección de Administración (solo se muestra si hay opciones de admin para este usuario) */}
            {adminOptions.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">
                        Administración
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-stretch">
                        {adminOptions.map((option) => (
                            <Link
                                key={option.id}
                                href={option.href}
                                className="block bg-white p-5 rounded-lg shadow hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300 ease-in-out cursor-pointer border border-gray-200 hover:border-red-500 h-full">
                                <h3 className="text-lg font-semibold text-red-700 mb-2 text-center sm:text-left">
                                    {option.title}
                                </h3>
                                <p className="text-sm text-gray-600 text-center sm:text-left">
                                    {option.description}
                                </p>
                            </Link>
                        ))}
                    </div>
                </section>
            )}

            {adminOptions.length > 0 && canViewMyCoursesSection && <hr className="my-8 border-gray-300" />}

            {/* Sección "Mis cursos" */}
            {/* --- INICIO CAMBIO: Mostrar sección "Mis Cursos" según permiso --- */}
            {canViewMyCoursesSection && (
                <section>
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">
                        Mis Cursos
                    </h2>
                    {error && ( /* Este error es de la carga de cursos */
                        <p className="text-red-500 bg-red-100 p-3 rounded-md">
                            Error: {error}
                        </p>
                    )}
                    {!pageLoading && !error && courses.length === 0 && (
                        <p className="text-gray-500 bg-blue-50 p-4 rounded-md">
                            No tienes cursos asignados actualmente o no se encontraron.
                        </p>
                    )}
                    {courses.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {courses.map((course) => (
                                <Link
                                    key={course.courseID}
                                    href={`/dashboard/course/${course.courseID}/sections`}
                                    className="block bg-white p-5 rounded-lg shadow hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300 ease-in-out cursor-pointer border border-gray-200 hover:border-red-500">
                                    {/* ... contenido de la tarjeta del curso ... */}
                                    <h3 className="text-lg font-semibold text-red-700 mb-2">
                                        {course.courseName}
                                    </h3>
                                    {course.description && (
                                        <p className="text-sm text-gray-600 truncate">
                                            {course.description}
                                        </p>
                                    )}
                                    <p className="text-xs text-gray-500 mt-3">
                                        {course.sections.length}{" "}
                                        {course.sections.length === 1
                                            ? "sección"
                                            : "secciones"}
                                    </p>
                                </Link>
                            ))}
                        </div>
                    )}
                </section>
            )}
            {/* --- FIN CAMBIO --- */}
            {!canViewMyCoursesSection && !pageLoading && ( // Si no puede ver "Mis Cursos" y no está cargando
                <p className="text-gray-600">No tienes cursos o secciones asignadas para mostrar.</p>
            )}
        </>
    );
}