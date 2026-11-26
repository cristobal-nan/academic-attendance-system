"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation"; // Agregado useRouter aquí, podrías necesitarlo para volver
import { useAuth } from "@/context/AuthContext"; //
import Button from "@/components/Button"; //
import { AttendanceDetailsResponse } from '@/types';

export default function MeetingAttendancePage() {
    const params = useParams();
    const router = useRouter(); // Inicializa useRouter
    const meetingId = params.meetingId as string;
    // PASO 3: Obtén authFetch del contexto
    const { user: professor, authFetch, isLoading: authIsLoading } = useAuth();

    const [attendanceDetails, setAttendanceDetails] = useState<AttendanceDetailsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingStudentId, setUpdatingStudentId] = useState<string | null>(null);

    const fetchAttendanceDetails = useCallback(async () => {
        if (!meetingId) {
            setError("ID de la reunión no encontrado en la URL.");
            setLoading(false);
            return;
        }
        // setLoading(true); // Se maneja en el useEffect que llama
        // setError(null);   // Se maneja en el useEffect que llama
        try {
            // PASO 4: Reemplaza authenticatedFetch con authFetch
            const response = await authFetch( //
                `/meetings/${meetingId}/attendance-details`,
                { method: "GET" }
            );
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.detail || `Error ${response.status} obteniendo detalles.`);
            }
            const data: AttendanceDetailsResponse = await response.json();
            setAttendanceDetails(data);
             // Limpiar error en éxito
                } catch (err) {
                    console.error("Error fetching attendance details:", err);
                    // PASO 5: Ajusta el bloque catch
                    if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
                    setError(err.message);
                    } else if (!(err instanceof Error)) {
                    setError("No se pudieron cargar los detalles de asistencia.");
                    }
                    setAttendanceDetails(null); // Limpiar datos en error
                } finally {
            // setLoading(false); // Se maneja en el useEffect que llama
        }
    }, [meetingId, authFetch]); // PASO 6: Añade authFetch como dependencia

    useEffect(() => {
        if (authIsLoading) {
            setLoading(true);
            return;
        }
        if (!professor && !authIsLoading) { // Si no hay usuario (profesor) y auth terminó de cargar
            setError("Autenticación requerida.");
            setLoading(false);
            // AuthGuard debería redirigir
            return;
        }
        if (meetingId && professor) { // Si hay meetingId y profesor
            setLoading(true);
            setError(null);
            fetchAttendanceDetails().finally(() => {
                setLoading(false);
            });
        } else if (!meetingId && !authIsLoading) { // No hay meetingId y auth terminó
            setError("ID de la reunión no disponible.");
            setLoading(false);
        }
    }, [meetingId, professor, authIsLoading, fetchAttendanceDetails]);


    const handleToggleAttendance = async (
        studentUid: string,
    ) => {
        if (!meetingId) {
            setError("ID de la reunión no disponible para cambiar asistencia.");
            return;
        }
        setUpdatingStudentId(studentUid);
        // setError(null); // Limpiar errores específicos de toggle
        try {
            // PASO 4: Reemplaza authenticatedFetch con authFetch
            const response = await authFetch( //
                `/meetings/${meetingId}/students/${studentUid}/toggle-attendance`,
                { method: "POST" }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.detail || `Error ${response.status} al cambiar asistencia.`);
            }

            const result = await response.json();

            setAttendanceDetails((prevDetails) => {
                if (!prevDetails) return null;
                return {
                    ...prevDetails,
                    students: prevDetails.students.map((student) =>
                        student.uid === studentUid
                            ? { ...student, attended: result.newAttendanceStatus }
                            : student
                    ),
                };
            });
            // Limpiar error en éxito
                } catch (err) {
                    console.error(`Error toggling attendance for ${studentUid}:`, err);
                    // PASO 5: Ajusta el bloque catch
                    if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
                    setError(`Error actualizando asistencia: ${err.message}`);
                    } else if (!(err instanceof Error)) {
                    setError("Error actualizando asistencia.");
                    }
                    // No es necesario revertir la UI aquí si la actualización de estado se basa en la respuesta exitosa.
                    // Si fuera una actualización optimista, aquí la revertirías.
                } finally {
            setUpdatingStudentId(null);
        }
    };
    // No es necesario envolver handleToggleAttendance en useCallback si no se pasa como prop a componentes memorizados
    // y si sus dependencias (meetingId, authFetch, setAttendanceDetails, setError, setUpdatingStudentId) son estables
    // o se incluyen correctamente. `authFetch` es useCallback. Los setters son estables. `meetingId` viene de params.

    if (loading && !attendanceDetails) { // Muestra cargando si está cargando y aún no hay datos
        return <div className="p-4 text-center">Cargando detalles de asistencia...</div>;
    }
    
    // Mostrar error principal si no hay datos y hubo un error
    if (error && !attendanceDetails && !loading) { // Añadido !loading
        return (
            <div className="max-w-lg mx-auto mt-10 p-6 bg-white rounded-lg shadow-md text-center">
                <h2 className="text-xl font-semibold text-red-700 mb-3">Error al Cargar</h2>
                <p className="text-red-500 mb-6">{error}</p>
                <Button onClick={() => router.back()} variant="secondary">Volver</Button>
            </div>
        );
    }
    
    if (!attendanceDetails && !loading) { // Si no hay datos y no está cargando (y no hubo error manejado arriba)
        return (
             <div className="max-w-lg mx-auto mt-10 p-6 bg-white rounded-lg shadow-md text-center">
                <h2 className="text-xl font-semibold text-gray-700 mb-3">No Disponible</h2>
                <p className="text-gray-600 mb-6">No se encontraron detalles para esta reunión o la reunión no existe.</p>
                <Button onClick={() => router.back()} variant="secondary">Volver</Button>
            </div>
        );
    }
    
    // Si attendanceDetails tiene datos, podemos asumir que loading es false o los datos se muestran de todas formas.
    if (!attendanceDetails) { // Si por alguna razón llegamos aquí sin datos, muestra cargando como fallback
        return <div className="p-4 text-center">Cargando...</div>;
    }


    const { meetingDetails, students } = attendanceDetails;

    return (
        // Tu JSX existente, asegurándote de que los botones "Volver" sean funcionales
        // y que el layout general sea consistente con DashboardLayout.
        // El DashboardLayout ya proporciona el <main> y padding general.
        <> 
            <Button onClick={() => router.back()} variant="secondary" className="mb-4">
                &larr; Volver
            </Button>
            <div className="p-4 sm:p-6 bg-white rounded-lg shadow-md">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2">
                    Detalle de Asistencia
                </h1>
                <h2 className="text-lg sm:text-xl text-gray-700 mb-1">
                    {meetingDetails.courseName || "Curso Desconocido"}
                    {meetingDetails.sectionIdentifier && (
                        <span className="text-gray-600"> - {meetingDetails.sectionIdentifier}</span>
                    )}
                </h2>
                <p className="text-sm text-gray-500 mb-4 sm:mb-6">
                    {/* Formatear meetingDateTime si es un timestamp/ISO string */}
                    Fecha: {meetingDetails.meetingDateTime ? new Date(meetingDetails.meetingDateTime).toLocaleString('es-CL') : 'N/A'}
                    <br/>
                    Profesor: {professor?.displayName || "N/A"}
                </p>

                {error && ( // Error específico de la acción de toggle, no el de carga de página
                    <p className="text-red-500 p-2 my-2 bg-red-100 rounded text-sm text-center">
                        Error al actualizar: {error}
                    </p>
                )}

                <h2 className="text-xl sm:text-2xl font-semibold text-gray-700 mb-3 sm:mb-4">
                    Lista de Estudiantes ({students.length})
                </h2>
                {students.length === 0 ? (
                    <p className="text-gray-500">No hay estudiantes inscritos en esta sección.</p>
                ) : (
                    <ul className="divide-y divide-gray-200 border rounded-md">
                        {students.map((student) => (
                            <li
                                key={student.uid}
                                className="py-3 px-2 sm:px-4 flex justify-between items-center hover:bg-gray-50 transition-colors"
                            >
                                <span className="text-gray-800">
                                    {student.studentName || student.uid}
                                </span>
                                <Button
                                    onClick={() => handleToggleAttendance(student.uid)}
                                    variant={student.attended ? "primary" : "secondary"}
                                    className={`px-3 py-1 text-xs w-32 text-center ${updatingStudentId === student.uid ? "opacity-50 cursor-not-allowed" : ""}`}
                                    disabled={updatingStudentId === student.uid}
                                >
                                    {updatingStudentId === student.uid
                                        ? "Cambiando..."
                                        : student.attended
                                            ? "Asistió (Quitar)"
                                            : "No Asistió (Marcar)"}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </>
    );
}