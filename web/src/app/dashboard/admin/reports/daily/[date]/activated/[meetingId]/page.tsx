"use client";

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import { AttendanceDetailsResponse, StudentAttendance } from '@/types';
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/20/solid';

// Definimos un tipo para las claves de las columnas que se pueden ordenar
type SortableKey = keyof StudentAttendance;

export default function MeetingAttendanceDetailPage() {
    const router = useRouter();
    const params = useParams();
    const { authFetch } = useAuth();
    
    // Obtenemos ambos parámetros de la URL
    const meetingId = params.meetingId as string;

    const [details, setDetails] = useState<AttendanceDetailsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Estado para manejar la configuración del ordenamiento
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey; direction: 'asc' | 'desc' }>({
        key: 'studentName',
        direction: 'asc', // Por defecto, ascendente por nombre
    });

    useEffect(() => {
        if (!meetingId) return;
        const fetchDetails = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await authFetch(`/meetings/${meetingId}/attendance-details`);
                if (!response.ok) {
                     throw new Error("No se pudo cargar el detalle de asistencia.");
                }
                setDetails(await response.json());
            } catch (err) {
                if (err instanceof Error) setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        fetchDetails();
    }, [meetingId, authFetch]);

    // Hook useMemo para ordenar la lista de estudiantes de manera eficiente
    const sortedStudents = useMemo(() => {
        if (!details?.students) return [];
        
        const sortableItems = [...details.students];

        sortableItems.sort((a, b) => {
            const aValue = a[sortConfig.key];
            const bValue = b[sortConfig.key];

            // Lógica especial para ordenar por el primer apellido
            if (sortConfig.key === 'studentName' && typeof aValue === 'string' && typeof bValue === 'string') {
                const wordsA = aValue.split(' ');
                const wordsB = bValue.split(' ');

                const firstLastNameA = wordsA.length > 1 ? wordsA[wordsA.length - 2] : wordsA[0] || '';
                const firstLastNameB = wordsB.length > 1 ? wordsB[wordsB.length - 2] : wordsB[0] || '';

                if (firstLastNameA.localeCompare(firstLastNameB) !== 0) {
                    return sortConfig.direction === 'asc' 
                        ? firstLastNameA.localeCompare(firstLastNameB) 
                        : firstLastNameB.localeCompare(firstLastNameA);
                }
            }

            // Lógica de ordenamiento general para las otras columnas
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            
            return 0;
        });

        return sortableItems;
    }, [details?.students, sortConfig]);

    // Función para cambiar el estado del ordenamiento al hacer clic en una cabecera
    const requestSort = (key: SortableKey) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // Función para mostrar los íconos de ordenamiento
    const getSortIcon = (key: SortableKey) => {
        return (
            <div className="flex flex-col ml-1 -space-y-1">
                {/* La flecha hacia arriba ahora se resalta en orden descendente */}
                <ChevronUpIcon className={`h-4 w-4 ${sortConfig.key === key && sortConfig.direction === 'desc' ? 'text-gray-900' : 'text-gray-300'}`} />
                {/* La flecha hacia abajo ahora se resalta en orden ascendente */}
                <ChevronDownIcon className={`h-4 w-4 ${sortConfig.key === key && sortConfig.direction === 'asc' ? 'text-gray-900' : 'text-gray-300'}`} />
            </div>
        );
    };

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6">
            <Button onClick={() => router.back()} variant="secondary" className="mb-6">
                &larr; Volver a la Lista
            </Button>
            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg border">
                <header className="border-b border-gray-200 pb-4 mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Detalle de Asistencia de la Sección</h1>
                    {details?.meetingDetails && (
                        <div className="text-sm text-gray-600 mt-2 space-y-1">
                            <p><span className="font-semibold">Curso:</span> {details.meetingDetails.courseName}</p>
                            <p><span className="font-semibold">Sección:</span> {details.meetingDetails.sectionIdentifier}</p>
                            <p><span className="font-semibold">Profesor a Cargo:</span> {details.meetingDetails.professorName}</p>
                        </div>
                    )}
                </header>

                {isLoading ? (
                    <p className="text-center py-6">Cargando...</p>
                ) : error ? (
                    <p className="text-center text-red-600 bg-red-100 p-4 rounded-md">{error}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th onClick={() => requestSort('studentName')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">
                                        <div className="flex items-center">Nombre Completo{getSortIcon('studentName')}</div>
                                    </th>
                                    <th onClick={() => requestSort('attended')} className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer">
                                        <div className="flex items-center justify-center">Asistió{getSortIcon('attended')}</div>
                                    </th>
                                    <th onClick={() => requestSort('validatedBy')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer">
                                        <div className="flex items-center">Registrado Por{getSortIcon('validatedBy')}</div>
                                    </th>
                                    <th onClick={() => requestSort('validationTimestamp')} className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer">
                                        <div className="flex items-center justify-center">Hora de Registro{getSortIcon('validationTimestamp')}</div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {sortedStudents.map((student) => (
                                    <tr key={student.uid}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{student.studentName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                student.attended ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                            }`}>
                                                {student.attended ? 'Sí' : 'No'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-xs">{student.validatedBy || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{student.validationTimestamp || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}