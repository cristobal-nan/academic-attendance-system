"use client";

import { useEffect, useState, useMemo, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import { SnapshotDetailResponse, SnapshotStudentResult } from '@/types';
import { ChevronUpIcon, ChevronDownIcon, CalendarIcon } from '@heroicons/react/20/solid';
import { Menu, Transition } from '@headlessui/react';
import * as XLSX from 'xlsx'; // <--- AÑADE ESTA LÍNEA

// Tipo para manejar el dato que se muestra y ordena en la tabla
type DisplayStudent = SnapshotStudentResult & {
    displayPercentage: number;
};

type SortKey = 'studentName' | 'courseName' | 'sectionIdentifier' | 'displayPercentage';
type SortDirection = 'asc' | 'desc';

export default function SnapshotDetailPage() {
    const router = useRouter();
    const params = useParams();
    const { snapshotId } = params;

    const { authFetch, isLoading: authIsLoading } = useAuth();
    
    const [snapshotData, setSnapshotData] = useState<SnapshotDetailResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // --- INICIO: LÓGICA DE FILTRO Y ORDENAMIENTO MODIFICADA ---
    const [selectedType, setSelectedType] = useState<string>(''); // Inicia como string vacío
    const [sortKey, setSortKey] = useState<SortKey>('displayPercentage');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc'); // Mayor a menor por defecto

    const [isExporting, setIsExporting] = useState(false); // Nuevo estado

const handleExport = async () => {
    if (!snapshotId) return;
    if (typeof XLSX === 'undefined') {
        alert("La librería de exportación aún no ha cargado. Por favor, inténtelo de nuevo en un momento.");
        return;
    }

    setIsExporting(true);
    try {
        const response = await authFetch(`/export/snapshot/${snapshotId}`);
        if (!response.ok) throw new Error("No se pudo generar el archivo de exportación.");
        
        const data = await response.json();
        const { headers, rows } = data;

        if (!rows || rows.length === 0) {
            alert("No hay datos de estudiantes en riesgo para exportar en este snapshot.");
            return;
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

        // Ajustar anchos de columna para el nuevo formato
        ws['!cols'] = [
            { wch: 25 }, // Apellidos
            { wch: 25 }, // Nombres
            { wch: 30 }, // Correo
            { wch: 15 }, // RUT
            { wch: 30 }, // Curso
            { wch: 15 }, // Sección
            { wch: 25 }, // Asistencia Ayudantía (%)
            { wch: 25 }, // Asistencia Cátedra (%)
            { wch: 25 }  // Asistencia Laboratorio (%)
        ];
        
        XLSX.utils.book_append_sheet(wb, ws, "Alerta Temprana");

        const safeSnapshotName = snapshotData?.snapshotName.replace(/[\s/]/g, '_') || snapshotId;
        XLSX.writeFile(wb, `snapshot_${safeSnapshotName}.xlsx`);

    } catch (error) {
        console.error("Error al exportar:", error);
        alert((error as Error).message);
    } finally {
        setIsExporting(false);
    }
};

    // Efecto para cargar los datos del snapshot
    useEffect(() => {
        if (authIsLoading || !snapshotId) return;
        const fetchSnapshotDetails = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await authFetch(`/reports/snapshots/${snapshotId}`);
                if (!response.ok) throw new Error((await response.json()).detail || "No se pudo cargar.");
                setSnapshotData(await response.json());
            } catch (err) {
                if (err instanceof Error) setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSnapshotDetails();
    }, [snapshotId, authIsLoading, authFetch]);

    // Derivamos los tipos de reunión disponibles a partir de los datos cargados
    const availableTypes = useMemo(() => {
        if (!snapshotData?.results) return [];
        const types = new Set<string>();
        snapshotData.results.forEach(result => {
            if (result.percentagesByType) {
                Object.keys(result.percentagesByType).forEach(type => types.add(type));
            }
        });
        return Array.from(types).sort();
    }, [snapshotData]);

    // Efecto para establecer el filtro por defecto UNA VEZ que los datos y tipos están disponibles
    useEffect(() => {
        if (availableTypes.length > 0 && selectedType === '') {
            if (availableTypes.includes('Cátedra')) {
                setSelectedType('Cátedra');
            } else {
                setSelectedType(availableTypes[0]); // Fallback al primer tipo disponible
            }
        }
    }, [availableTypes, selectedType]);

    // Transforma y ordena los datos para la tabla basado en el filtro
    const sortedAndFilteredResults = useMemo(() => {
        if (!snapshotData?.results || !selectedType) return [];

        // PASO 1: FILTRAR PRIMERO
        // Mantenemos en la lista solo a los estudiantes que SÍ tienen una entrada 
        // para el tipo de reunión que se está filtrando (selectedType).
        // Esto asegura que solo aparezcan los alumnos en riesgo para esa categoría específica.
        const filteredStudents = snapshotData.results.filter(student =>
            student.percentagesByType && Object.prototype.hasOwnProperty.call(student.percentagesByType, selectedType)
        );

        // PASO 2: MAPEAR los datos de los estudiantes ya filtrados para la tabla.
        const displayData: DisplayStudent[] = filteredStudents.map(student => {
            // Ahora estamos seguros de que 'percentagesByType[selectedType]' existe.
            // Usamos un fallback a 0 por si acaso, aunque no debería ser necesario.
            const percentageToShow = student.percentagesByType?.[selectedType] ?? 0;
            return { ...student, displayPercentage: percentageToShow };
        });

        // PASO 3: ORDENAR la lista filtrada como antxes.
        displayData.sort((a, b) => {
            const valA = a[sortKey];
            const valB = b[sortKey];
            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return displayData;

    }, [snapshotData?.results, sortKey, sortDirection, selectedType]);
    // --- FIN: LÓGICA DE FILTRO Y ORDENAMIENTO MODIFICADA ---

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDirection('asc'); }
    };
    
    const getSortIcon = (key: SortKey) => ( <div className="flex flex-col ml-1 -space-y-1"><ChevronUpIcon className={`h-4 w-4 ${sortKey===key && sortDirection==='asc'?'text-gray-900':'text-gray-300'}`}/><ChevronDownIcon className={`h-4 w-4 ${sortKey===key && sortDirection==='desc'?'text-gray-900':'text-gray-300'}`}/></div> );

    if (isLoading) return <div className="text-center p-8">Cargando detalle del reporte...</div>;
    if (error) return <div className="text-center p-8 text-red-600">Error: {error}</div>;
    if (!snapshotData) return <div className="text-center p-8">No se encontraron datos para este reporte.</div>;

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-white rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between sm:items-start mb-6 gap-4">
                <div>
                    <Button onClick={() => router.push('/dashboard/admin/reports/early-warning')} variant="secondary" className="inline-flex items-center">&larr; Volver al Historial</Button>
                    <div className="mt-4">
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">{snapshotData.snapshotName}</h1>
                        <p className="mt-2 text-sm text-gray-500 flex items-center gap-4">
                            <span className="flex items-center"><CalendarIcon className="h-4 w-4 mr-1.5"/>Corte: {snapshotData.cutOffDate}</span>
                            <span className="flex items-center"><CalendarIcon className="h-4 w-4 mr-1.5"/>Generado: {new Date(snapshotData.createdAt).toLocaleString('es-CL')}</span>
                        </p>
                    </div>
                </div>
                
                {/* --- MENÚ DE FILTRO MODIFICADO (SIN OPCIÓN "GENERAL") --- */}
                {availableTypes.length > 0 && (
                 <Menu as="div" className="relative inline-block text-left flex-shrink-0">
                    <div>
                        <Menu.Button className="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
                            Mostrando: {selectedType || '...'}
                            <ChevronDownIcon className="-mr-1 h-5 w-5 text-gray-400" aria-hidden="true" />
                        </Menu.Button>
                    </div>
                    <Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95">
                        <Menu.Items className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                            <div className="py-1">
                                {availableTypes.map((type) => (
                                    <Menu.Item key={type}>
                                        {({ active }) => ( <button onClick={() => setSelectedType(type)} className={`${active ? 'bg-gray-100' : ''} ${selectedType === type ? 'font-bold': ''} text-gray-900 block w-full px-4 py-2 text-left text-sm`}>{type}</button> )}
                                    </Menu.Item>
                                ))}
                            </div>
                        </Menu.Items>
                    </Transition>
                </Menu>
                )}
                <Button onClick={handleExport} disabled={isExporting} variant='primary'>
                    {isExporting ? 'Exportando...' : 'Exportar Vista a XLSX'}
                </Button>
            </div>

            <div className="overflow-x-auto shadow-sm rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('studentName')}><div className="flex items-center">Nombre Completo {getSortIcon('studentName')}</div></th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('courseName')}><div className="flex items-center">Curso {getSortIcon('courseName')}</div></th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('sectionIdentifier')}><div className="flex items-center">Sección {getSortIcon('sectionIdentifier')}</div></th>
                            <th scope="col" className="pr-6 pl-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('displayPercentage')}><div className="flex items-center justify-end">Asistencia ({selectedType || 'General'}) % {getSortIcon('displayPercentage')}</div></th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {sortedAndFilteredResults.map((student) => (
                            <tr key={`${student.studentUid}-${student.sectionId}`} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{student.studentName}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{student.courseName}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{student.sectionIdentifier}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                                    <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                        student.displayPercentage < 50 ? 'bg-red-100 text-red-800' :
                                        student.displayPercentage < 70 ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-green-100 text-green-800'
                                    }`}>
                                        {student.displayPercentage}%
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}