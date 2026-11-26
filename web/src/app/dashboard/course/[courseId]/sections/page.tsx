"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext'; //
import Button from '@/components/Button'; //
import { CourseWithSections, CourseDetails, CourseSectionItem } from '@/types';


export default function CourseSectionsPage() {
  const { user, isLoading: authIsLoading, authFetch } = useAuth(); //
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;

  const [courseDetails, setCourseDetails] = useState<CourseDetails | null>(null);
  const [sections, setSections] = useState<CourseSectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    // La función fetchCourseAndSections está dentro del useEffect
    async function fetchCourseAndSectionsInternal() {
      // setLoading(true); // Se maneja fuera de esta función interna, al inicio del useEffect
      // setError(null); // Se maneja fuera de esta función interna
      try {
        // PASO 4: Reemplaza authenticatedFetch con authFetch
        const response = await authFetch('/users/me/courses-with-sections'); //

        if (!response.ok) { // No es necesario comprobar el status 401 aquí, authFetch lo maneja
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || "Error al cargar datos del curso y secciones.");
        }

        const allCoursesWithSections: CourseWithSections[] = await response.json();
        const currentCourseData = allCoursesWithSections.find(c => c.courseID === courseId);

        if (currentCourseData) {
          setCourseDetails({
            courseID: currentCourseData.courseID,
            courseName: currentCourseData.courseName,
            description: currentCourseData.description,
          });
          setSections(currentCourseData.sections.map(s => ({
            sectionID: s.sectionID,
            sectionIdentifier: s.sectionIdentifier,
          })));
          setError(null); // Limpiar errores en éxito
        } else {
          setError("Curso no encontrado o no tienes acceso.");
          setCourseDetails(null); // Limpiar detalles si no se encuentra
          setSections([]); // Limpiar secciones
        }
      } catch (err) {
        console.error("Error fetching course and sections:", err);
        // PASO 5: Ajusta el bloque catch
        if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
          setError(err.message || "No se pudieron cargar las secciones del curso.");
        } else if (!(err instanceof Error)) {
          setError("No se pudieron cargar las secciones del curso.");
        }
        setCourseDetails(null); // Limpiar en caso de error
        setSections([]); // Limpiar en caso de error
      } finally {
        setLoading(false); // Mover setLoading aquí asegura que se llame
      }
    }

    if (authIsLoading) {
      setLoading(true);
      return;
    }
    if (!user && !authIsLoading) {
      setLoading(false);
      // AuthGuard debería manejar la redirección.
      // Podrías setear un error si quieres: setError("Autenticación requerida.");
      return;
    }
    if (user && courseId) { // Solo hacer fetch si hay usuario y courseId
      setLoading(true);
      setError(null);
      fetchCourseAndSectionsInternal();
    } else if (!courseId && !authIsLoading) { // Si no hay courseId (y auth no carga)
      setLoading(false);
      setError("ID del curso no especificado.");
    }


    // PASO 6: Añade authFetch al array de dependencias
  }, [user, authIsLoading, courseId, authFetch]);

  if (loading) { // loading combina authIsLoading y la carga de datos de la página
    return <div className="flex items-center justify-center min-h-[calc(100vh-100px)]">Cargando secciones del curso...</div>;
  }

  // El AuthGuard ya maneja la redirección si no hay usuario.
  // Este error es más para cuando el curso específico no se encuentra o hay otro problema.
  if (error && !courseDetails) { // Si hay un error Y no se cargaron los detalles del curso
    return (
      <div className="container mx-auto p-4 sm:p-6 text-center">
        <p className="text-red-500 bg-red-100 p-3 rounded-md mb-4">Error: {error}</p>
        <Button onClick={() => router.push('/dashboard')} variant="secondary">
          Volver al Panel
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button onClick={() => router.push('/dashboard')} variant="secondary" className="mb-4">
        &larr; Volver al Panel
      </Button>

      {/* Mostrar error incluso si hay algunos datos, si es relevante */}
      {error && courseDetails && <p className="text-red-500 bg-red-100 p-3 rounded-md mb-4">Error: {error}</p>}

      {courseDetails && ( // Solo mostrar el título si courseDetails se cargó
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4">
          Secciones de {courseDetails.courseName}
        </h2>
      )}

      {/* Este mensaje se muestra si NO hay error, NO está cargando Y NO hay secciones.
            Si hubo un error que impidió cargar secciones, el mensaje de error de arriba es más apropiado. */}
      {!loading && !error && sections.length === 0 && courseDetails && (
        <p className="text-gray-500">Este curso no tiene secciones asignadas a ti o no se encontraron secciones.</p>
      )}

      {sections.length > 0 && (
        <div className="bg-white shadow-md rounded-lg">
          <ul className="divide-y divide-gray-200">
            {sections.map((section) => (
              <li key={section.sectionID}>
                <Link
                  href={`/dashboard/section/${section.sectionID}/attendance`}
                  className="block hover:bg-red-50 focus:outline-none focus:bg-red-100 transition duration-150 ease-in-out"
                >
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <p className="text-md font-semibold text-red-700 truncate">
                        {/* Usa courseDetails.courseName que ya tienes */}
                        {courseDetails?.courseName || 'Curso'} - {section.sectionIdentifier}
                      </p>
                      <div className="ml-2 flex-shrink-0 flex">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                          Ver Asistencia
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}