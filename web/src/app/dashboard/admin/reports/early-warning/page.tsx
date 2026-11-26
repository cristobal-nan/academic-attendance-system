"use client";

import { useEffect, useState, useMemo, Fragment, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import { EarlyWarningPageResponse, SnapshotStudentResult } from '@/types';
import { ChevronUpIcon, ChevronDownIcon, CalendarDaysIcon, DocumentPlusIcon, EyeIcon, LockClosedIcon } from '@heroicons/react/20/solid';
import { Menu, Transition } from '@headlessui/react';

// Actualizamos el tipo para el ordenamiento de la tabla
type SortKey = 'studentName' | 'courseName' | 'sectionIdentifier' | 'displayPercentage';
type SortDirection = 'asc' | 'desc';

// Creamos un nuevo tipo para los datos que mostraremos en la tabla
type DisplayStudent = SnapshotStudentResult & { displayPercentage: number };

// Componente de Tarjeta (sin cambios)
function SnapshotCard({ title, cutOffDate, isActionable, isGenerated, onClick, isGenerating }: { title: string; cutOffDate: string | null; isActionable: boolean; isGenerated: boolean; onClick: () => void; isGenerating: boolean; }) {
    if (!cutOffDate) return (<div className="p-4 border rounded-lg flex flex-col justify-between bg-gray-50 text-gray-400"><h3 className="font-bold">{title}</h3><p className="flex items-center gap-2 mt-1 text-sm"><CalendarDaysIcon className="h-4 w-4" />Fecha no definida</p><div className="mt-4"><Button disabled={true} className="w-full !py-1.5"><LockClosedIcon className="h-5 w-5 mr-2" />No disponible</Button></div></div>);
    const buttonText = isGenerated ? "Ver Snapshot" : "Generar Snapshot";
    const Icon = isGenerated ? EyeIcon : isActionable ? DocumentPlusIcon : LockClosedIcon;
    return (<div className={`p-4 border rounded-lg flex flex-col justify-between ${isActionable ? 'bg-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}><div><h3 className={`font-bold ${isActionable ? 'text-gray-800' : 'text-gray-400'}`}>{title}</h3><p className={`flex items-center gap-2 mt-1 text-sm ${isActionable ? 'text-gray-600' : 'text-gray-500'}`}><CalendarDaysIcon className="h-4 w-4" />Fecha de Corte: {cutOffDate}</p></div><div className="mt-4"><Button onClick={onClick} disabled={!isActionable || isGenerating} variant={isGenerated ? "secondary" : "primary"} className="w-full !py-1.5"><Icon className="h-5 w-5 mr-2" />{isGenerating ? "Generando..." : buttonText}</Button></div></div>);
}

export default function EarlyWarningPage() {
    const router = useRouter();
    const { authFetch, isLoading: authIsLoading } = useAuth();

    const [pageData, setPageData] = useState<EarlyWarningPageResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // --- ESTADOS PARA FILTRO Y ORDENAMIENTO DE LA TABLA DEL SNAPSHOT ---
    const [selectedType, setSelectedType] = useState<string>('');
    const [sortKey, setSortKey] = useState<SortKey>('displayPercentage');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    const fetchPageData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await authFetch('/reports/early-warning');
            if (!response.ok) throw new Error((await response.json()).detail || "Error al cargar los datos.");
            setPageData(await response.json());
        } catch (err) {
            if (err instanceof Error) setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [authFetch]);

    useEffect(() => {
        if (!authIsLoading) fetchPageData();
    }, [authIsLoading, fetchPageData]);

const handleCardClick = async (cardTitle: string, cutOffKey: string, cutOffDate: string, isGenerated: boolean, snapshotId?: string) => {
    if (isGenerated && snapshotId) {
        router.push(`/dashboard/admin/reports/snapshots/${snapshotId}`);
        return;
    }

    // --- INICIO: LÓGICA DE NOMENCLATURA MEJORADA ---
    const dateOfCut = new Date(`${cutOffDate}T00:00:00`);
    const year = dateOfCut.getFullYear();
    let semester = "Semestre Indefinido";

    // Determina el semestre comparando con las fechas de la base de datos
    if (pageData?.semesterDates?.primerSemestreStart && pageData?.semesterDates?.primerSemestreEnd) {
        const p1_start = new Date(`${pageData.semesterDates.primerSemestreStart}T00:00:00`);
        const p1_end = new Date(`${pageData.semesterDates.primerSemestreEnd}T00:00:00`);
        if (dateOfCut >= p1_start && dateOfCut <= p1_end) {
            semester = "Primer Semestre";
        }
    }
    if (pageData?.semesterDates?.segundoSemestreStart && pageData?.semesterDates?.segundoSemestreEnd) {
        const p2_start = new Date(`${pageData.semesterDates.segundoSemestreStart}T00:00:00`);
        const p2_end = new Date(`${pageData.semesterDates.segundoSemestreEnd}T00:00:00`);
        if (dateOfCut >= p2_start && dateOfCut <= p2_end) {
            semester = "Segundo Semestre";
        }
    }
    
    const snapshotName = `${cardTitle} ${semester} ${year}`;

    // Y lo usamos en la confirmación para que sea claro para el usuario
    if (!window.confirm(`¿Estás seguro de que quieres generar el snapshot "${snapshotName}"? Esta acción no se puede deshacer.`)) {
        return;
    }

    setIsGenerating(true);
    setError(null);
    try {
        const response = await authFetch('/admin/reports/snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cut_off_name: cutOffKey,
                snapshot_display_name: snapshotName,
            }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Error al generar.");
        alert("¡Snapshot generado exitosamente!");
        fetchPageData(); // Recargar datos
    } catch (err) {
        if (err instanceof Error) alert(`Error: ${err.message}`);
    } finally {
        setIsGenerating(false);
    }
};

    // Derivamos los tipos de reunión disponibles a partir de los datos del snapshot cargado
    const availableTypes = useMemo(() => {
        if (!pageData?.latestSnapshot?.results) return [];
        const types = new Set<string>();
        pageData.latestSnapshot.results.forEach(result => {
            if (result.percentagesByType) {
                Object.keys(result.percentagesByType).forEach(type => types.add(type));
            }
        });
        return Array.from(types).sort();
    }, [pageData?.latestSnapshot]);

    // Establecemos el filtro por defecto a "Cátedra" o el primero disponible
    useEffect(() => {
        if (availableTypes.length > 0 && selectedType === '') {
            if (availableTypes.includes('Cátedra')) {
                setSelectedType('Cátedra');
            } else {
                setSelectedType(availableTypes[0]);
            }
        }
    }, [availableTypes, selectedType]);

    // Lógica para transformar y ordenar los datos del snapshot para la tabla
    const sortedStudents = useMemo(() => {
        if (!pageData?.latestSnapshot?.results || !selectedType) return [];

        // PASO 1: FILTRAR PRIMERO
        // Nos quedamos solo con los estudiantes que SÍ tienen una entrada 
        // para el tipo de reunión que se está filtrando (selectedType).
        const filteredStudents = pageData.latestSnapshot.results.filter(student =>
            student.percentagesByType && Object.prototype.hasOwnProperty.call(student.percentagesByType, selectedType)
        );

        // PASO 2: MAPEAR los datos de los estudiantes ya filtrados.
        const displayData: DisplayStudent[] = filteredStudents.map(student => ({
            ...student,
            // Ahora estamos seguros de que 'percentagesByType[selectedType]' existe.
            displayPercentage: student.percentagesByType?.[selectedType] ?? 0,
        }));

        // PASO 3: ORDENAR la lista ya filtrada.
        return displayData.sort((a, b) => {
            const valA = a[sortKey];
            const valB = b[sortKey];
            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [pageData?.latestSnapshot?.results, sortKey, sortDirection, selectedType]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDirection('asc'); }
    };

    const getSortIcon = (key: SortKey) => (<div className="flex flex-col ml-1 -space-y-1"><ChevronUpIcon className={`h-4 w-4 ${sortKey === key && sortDirection === 'asc' ? 'text-gray-900' : 'text-gray-300'}`} /><ChevronDownIcon className={`h-4 w-4 ${sortKey === key && sortDirection === 'desc' ? 'text-gray-900' : 'text-gray-300'}`} /></div>);

    if (isLoading) return <div className="text-center p-8">Cargando página de Alerta Temprana...</div>;
    if (error) return <div className="text-center p-8 text-red-600">Error: {error}</div>;
    if (!pageData) return <div className="text-center p-8">No hay datos disponibles.</div>;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cutOffs = [{ key: 'earlyWarningFirstCutOff', title: 'Primer Corte', date: pageData.cutOffDates.firstCutOff }, { key: 'earlyWarningSecondCutOff', title: 'Segundo Corte', date: pageData.cutOffDates.secondCutOff }, { key: 'earlyWarningThirdCutOff', title: 'Tercer Corte', date: pageData.cutOffDates.thirdCutOff },];

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-8">
            <Button onClick={() => router.push('/dashboard/admin/reports')} variant="secondary" className="inline-flex items-center">&larr; Volver a Reportes</Button>

            <section className="bg-white p-6 rounded-lg shadow-md border">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Gestión de Reportes Históricos (Snapshots)</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {cutOffs.map(cut => { const isActionable = cut.date ? new Date(cut.date) < today : false; const generatedSnapshot = pageData.existingSnapshots.find(s => s.cutOffDate === cut.date); return (<SnapshotCard key={cut.key} title={cut.title} cutOffDate={cut.date || null} isActionable={isActionable} isGenerated={!!generatedSnapshot} isGenerating={isGenerating} onClick={() => handleCardClick(cut.title, cut.key, cut.date!, !!generatedSnapshot, generatedSnapshot?.id)} />) })}
                </div>
                <div className="mt-6 text-center">
                    <Link href="/dashboard/admin/reports/snapshots" className="text-sm font-semibold text-red-600 hover:text-red-800">Ver todos los reportes históricos &rarr;</Link>
                </div>
            </section>

            <section className="bg-white p-6 rounded-lg shadow-md border">
                <div className="flex flex-col sm:flex-row justify-between sm:items-start mb-4 gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Último Reporte Generado</h2>
                        {pageData.latestSnapshot && <p className="mt-1 text-sm text-gray-500">Datos del corte del {pageData.latestSnapshot.cutOffDate}</p>}
                    </div>
                    {/* --- MENÚ DE FILTRO REINTRODUCIDO --- */}
                    {availableTypes.length > 0 && (
                        <Menu as="div" className="relative inline-block text-left flex-shrink-0">
                            <div><Menu.Button className="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">Mostrando: {selectedType || '...'}<ChevronDownIcon className="-mr-1 h-5 w-5 text-gray-400" aria-hidden="true" /></Menu.Button></div>
                            <Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95">
                                <Menu.Items className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                                    <div className="py-1">
                                        {availableTypes.map((type) => (<Menu.Item key={type}>{({ active }) => (<button onClick={() => setSelectedType(type)} className={`${active ? 'bg-gray-100' : ''} ${selectedType === type ? 'font-bold' : ''} text-gray-900 block w-full px-4 py-2 text-left text-sm`}>{type}</button>)}</Menu.Item>))}
                                    </div>
                                </Menu.Items>
                            </Transition>
                        </Menu>
                    )}
                </div>

                {!pageData.latestSnapshot ? (
                    <p className="text-center text-gray-500 py-6">Aún no se ha generado ningún snapshot. ¡Genera el primero usando las tarjetas de arriba!</p>
                ) : sortedStudents.length === 0 ? (
                    <p className="text-center text-gray-500 py-6">No hay estudiantes en riesgo para el tipo de reunión seleccionado en este snapshot.</p>
                ) : (
                    <div className="overflow-x-auto shadow-sm rounded-lg border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('studentName')}><div className="flex items-center">Nombre Completo {getSortIcon('studentName')}</div></th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('courseName')}><div className="flex items-center">Curso {getSortIcon('courseName')}</div></th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('sectionIdentifier')}><div className="flex items-center">Sección {getSortIcon('sectionIdentifier')}</div></th>
                                    <th scope="col" className="pr-6 pl-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('displayPercentage')}><div className="flex items-center justify-end">Asistencia ({selectedType || '...'}) % {getSortIcon('displayPercentage')}</div></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {sortedStudents.map((student) => (
                                    <tr key={`${student.studentUid}-${student.sectionId}`} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{student.studentName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{student.courseName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{student.sectionIdentifier}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                                            <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${student.displayPercentage < 50 ? 'bg-red-100 text-red-800' : student.displayPercentage < 70 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                                {student.displayPercentage}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}