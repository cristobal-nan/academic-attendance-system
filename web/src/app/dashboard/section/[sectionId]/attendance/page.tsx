"use client";

import { useEffect, useState, useCallback, Fragment, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import { CheckCircleIcon, MinusCircleIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/solid';
import { Menu, Transition } from '@headlessui/react';
import { AttendanceMatrixResponse } from '@/types';
import * as XLSX from 'xlsx';

interface StudentExportData {
  apellidos: string;
  nombres: string;
  correo: string;
  rut: string;
  porcentaje_general: number;
  porcentajes_por_tipo: { [key: string]: number };
}

// Definimos un tipo para las claves de las columnas que se pueden ordenar
type SortableKey = 'studentName' | 'overallAttendancePercentage';


const formatMeetingDateMultiLine = (isoDateString: string | null | undefined): string => {
	if (!isoDateString) return 'Fecha<br/>N/D';
	try {
		const date = new Date(isoDateString);
		if (isNaN(date.getTime())) return 'Fecha<br/>Inv.';
		const dayName = new Intl.DateTimeFormat('es-CL', { weekday: 'long' }).format(date);
		const dateString = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long' }).format(date);
		const timeString = new Intl.DateTimeFormat('es-CL', { hour: 'numeric', minute: '2-digit', hour12: false }).format(date);
		return `${dayName.charAt(0).toUpperCase() + dayName.slice(1)}<br/>${dateString}<br/>${timeString}`;
	} catch {
		return 'Error<br/>Fecha';
	}
};

export default function SectionAttendanceMatrixPage() {
	const params = useParams();
	const router = useRouter();
	const sectionId = params.sectionId as string;
	const { user: professor, authFetch, isLoading: authIsLoading } = useAuth();

	const [matrixData, setMatrixData] = useState<AttendanceMatrixResponse | null>(null);
	const [pageLoading, setPageLoading] = useState(true);
	const [pageError, setPageError] = useState<string | null>(null);
	const [updatingCell, setUpdatingCell] = useState<{ studentUid: string, meetingId: string } | null>(null);

	const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);

	const [isExporting, setIsExporting] = useState(false);

    // Estado para manejar la configuración del ordenamiento
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey; direction: 'asc' | 'desc' }>({
        key: 'studentName',
        direction: 'asc', // Por defecto, ascendente por apellido
    });

    const handleExport = useCallback(async () => {
        if (typeof XLSX === 'undefined') {
            alert("La librería de exportación aún no ha cargado. Por favor, inténtelo de nuevo en un momento.");
            return;
        }

        setIsExporting(true);
        try {
            const response = await authFetch(`/export/section/${sectionId}/attendance`);
            if (!response.ok) {
                throw new Error("No se pudieron obtener los datos para la exportación.");
            }

            const data = await response.json();
            const { students_data, meeting_types } = data;

            if (!students_data || students_data.length === 0) {
                alert("No hay datos de asistencia para exportar.");
                return;
            }

            const headers = ["Apellidos", "Nombres", "Correo", "RUT"];
            meeting_types.forEach((type: string) => headers.push(`Asistencia ${type} (%)`));
            headers.push("Asistencia General (%)");

            const worksheetData = students_data.map((student: StudentExportData) => {
                const row = [student.apellidos, student.nombres, student.correo, student.rut];
                meeting_types.forEach((type: string) => row.push(String(student.porcentajes_por_tipo[type] ?? 0)));
                row.push(String(student.porcentaje_general));
                return row;
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...worksheetData]);

            ws['!cols'] = [
                { wch: 25 }, { wch: 25 }, { wch: 30 }, { wch: 15 },
                ...meeting_types.map(() => ({ wch: 20 })), { wch: 20 }
            ];

            XLSX.utils.book_append_sheet(wb, ws, "Asistencia");
            const sectionDetails = matrixData?.sectionDetails;
            XLSX.writeFile(wb, `asistencia_${sectionDetails?.courseName}_${sectionDetails?.sectionIdentifier}.xlsx`);

        } catch (error) {
            console.error("Error al exportar:", error);
            alert((error as Error).message);
        } finally {
            setIsExporting(false);
        }
    }, [authFetch, sectionId, matrixData]);

	useEffect(() => {
		if (authIsLoading || !sectionId) return;

		const fetchMatrixData = async () => {
			setPageLoading(true);
			setPageError(null);

			const queryParams = new URLSearchParams();
			selectedTypes.forEach(type => queryParams.append("meeting_types", type));
			const queryString = queryParams.toString();

			try {
				const response = await authFetch(`/sections/${sectionId}/attendance-matrix?${queryString}`, {
					cache: 'no-store'
				});
				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					throw new Error(errorData.detail || "Error al cargar los datos.");
				}
				const data: AttendanceMatrixResponse = await response.json();
				setMatrixData(data);

                if (!initialLoadComplete && data.availableMeetingTypes?.includes('Cátedra')) {
                    setSelectedTypes(['Cátedra']);
                }
                setInitialLoadComplete(true);

			} catch (err) {
				if (err instanceof Error && err.message !== 'Sesión inválida o expirada.') {
					setPageError(err.message);
				}
				setMatrixData(null);
			} finally {
				setPageLoading(false);
			}
		};

		fetchMatrixData();
	}, [sectionId, selectedTypes, authIsLoading, authFetch, initialLoadComplete]);

    const handleToggleAttendance = useCallback(async (meetingIdToToggle: string, studentUidToToggle: string) => {
        setUpdatingCell({ studentUid: studentUidToToggle, meetingId: meetingIdToToggle });

        const originalMatrixData = JSON.parse(JSON.stringify(matrixData));
        
        setMatrixData(prevData => {
            if (!prevData) return null;

            const newStudentsAttendance = prevData.studentsAttendance.map(student => {
                if (student.studentUid === studentUidToToggle) {
                    const newAttendanceByMeeting = { ...student.attendanceByMeeting };
                    const currentStatus = newAttendanceByMeeting[meetingIdToToggle];
                    newAttendanceByMeeting[meetingIdToToggle] = !currentStatus;

                    const activeMeetings = prevData.meetings.filter(m => m.isActiveForAttendance);
                    const attendedCount = activeMeetings.filter(m => newAttendanceByMeeting[m.meetingId]).length;
                    const newPercentage = activeMeetings.length > 0 ? Math.round((attendedCount / activeMeetings.length) * 100) : 0;

                    return { ...student, attendanceByMeeting: newAttendanceByMeeting, overallAttendancePercentage: newPercentage };
                }
                return student;
            });

            return { ...prevData, studentsAttendance: newStudentsAttendance };
        });

        try {
            const response = await authFetch(
                `/meetings/${meetingIdToToggle}/students/${studentUidToToggle}/toggle-attendance`,
                { method: 'POST' }
            );

            if (!response.ok) {
                throw new Error("El servidor rechazó el cambio.");
            }
            
        } catch (err) {
            setPageError(`Error al guardar el cambio. Por favor, recarga la página. Mensaje: ${(err as Error).message}`);
            setMatrixData(originalMatrixData);
        } finally {
            setUpdatingCell(null);
        }
	}, [authFetch, matrixData]);

    const sortedStudents = useMemo(() => {
        if (!matrixData?.studentsAttendance) return [];
        
        const sortableItems = [...matrixData.studentsAttendance];

        sortableItems.sort((a, b) => {
            const aValue = a[sortConfig.key];
            const bValue = b[sortConfig.key];

            if (sortConfig.key === 'studentName' && typeof aValue === 'string' && typeof bValue === 'string') {
                const wordsA = aValue.split(' ');
                const wordsB = bValue.split(' ');

                const firstLastNameA = wordsA.length > 2 ? wordsA[wordsA.length - 2] : wordsA[0] || '';
                const firstLastNameB = wordsB.length > 2 ? wordsB[wordsB.length - 2] : wordsB[0] || '';

                if (firstLastNameA.localeCompare(firstLastNameB, 'es', { sensitivity: 'base' }) !== 0) {
                    return sortConfig.direction === 'asc' 
                        ? firstLastNameA.localeCompare(firstLastNameB, 'es', { sensitivity: 'base' }) 
                        : firstLastNameB.localeCompare(firstLastNameA, 'es', { sensitivity: 'base' });
                }
            }

            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            
            return 0;
        });

        return sortableItems;
    }, [matrixData?.studentsAttendance, sortConfig]);

    const requestSort = (key: SortableKey) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key: SortableKey) => {
        return (
            <div className="flex flex-col ml-1 -space-y-1">
                <ChevronUpIcon className={`h-4 w-4 ${sortConfig.key === key && sortConfig.direction === 'desc' ? 'text-gray-900' : 'text-gray-300'}`} />
                <ChevronDownIcon className={`h-4 w-4 ${sortConfig.key === key && sortConfig.direction === 'asc' ? 'text-gray-900' : 'text-gray-300'}`} />
            </div>
        );
    };


	if (pageLoading && !matrixData) {
		return <div className="p-4 text-center text-gray-500">Cargando datos de la matriz...</div>;
	}
	if (pageError) {
		return (
			<div className="p-4 text-center">
				<p className="text-red-600 font-semibold">Error al cargar la matriz:</p>
				<p className="text-red-500 mb-4">{pageError}</p>
				<Button onClick={() => window.location.reload()} variant="primary">Reintentar</Button>
			</div>
		);
	}
	if (!matrixData) {
		return <div className="p-4 text-center text-gray-500">No se encontraron datos.</div>;
	}

    const { sectionDetails, meetings, availableMeetingTypes } = matrixData;
    const stickyCol1Width = "300px", stickyCol2Width = "120px", stickyCol2LeftPosition = stickyCol1Width, borderColorForShadow = '#D1D5DB';

    return (
		<main className="container mx-auto p-4 sm:p-6">
            <Button onClick={() => router.push('/dashboard/course/' + sectionDetails.courseID + '/sections')} variant="secondary" className="mb-4">
                &larr; Volver a Secciones
            </Button>
			<div className="p-4 sm:p-6 bg-white rounded-lg shadow-md min-h-screen">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1">Matriz de Asistencia</h1>
                        <h2 className="text-lg sm:text-xl text-gray-700">{sectionDetails.courseName} - {sectionDetails.sectionIdentifier}</h2>
                        <p className="text-sm text-gray-500">Profesor: {professor?.displayName || 'N/A'}</p>
                    </div>
                    {availableMeetingTypes && availableMeetingTypes.length > 0 && (
                        <Menu as="div" className="relative inline-block text-left">
                            <div>
								<Menu.Button className="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
								{selectedTypes.length === 0
									? 'Filtrar por Tipo (Todos)'
									: `Filtrado: ${selectedTypes.join(', ')}`}
								<ChevronDownIcon className="-mr-1 h-5 w-5 text-gray-400" aria-hidden="true" />
								</Menu.Button>
                            </div>
                            <Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95">
                                <Menu.Items className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                                    <div className="py-1">
                                        {availableMeetingTypes.map((type) => (
                                            <Menu.Item key={type}>
                                                {({ active }) => (
                                                    <div onClick={(e) => e.stopPropagation()} className={`${active ? 'bg-gray-100' : ''} px-4 py-2`}>
                                                        <label className="flex items-center space-x-3 cursor-pointer">
                                                            <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-600" checked={selectedTypes.includes(type)} onChange={(e) => {
                                                                const checked = e.target.checked;
                                                                setSelectedTypes(prev => checked ? [...prev, type] : prev.filter(t => t !== type));
                                                            }} />
                                                            <span className="text-sm text-gray-700">{type}</span>
                                                        </label>
                                                    </div>
                                                )}
                                            </Menu.Item>
                                        ))}
                                    </div>
                                </Menu.Items>
                            </Transition>
                        </Menu>
                    )}
					<Button onClick={handleExport} disabled={isExporting} variant="secondary">
						{isExporting ? 'Exportando...' : 'Exportar a XLSX'}
					</Button>
                </div>
                {pageLoading && <div className="text-center py-4 text-sm text-gray-500">Actualizando...</div>}
				{!pageLoading && meetings.length === 0 ? (
					<p className="text-center text-gray-500 mt-4">No hay reuniones que coincidan con los filtros seleccionados.</p>
				) : !pageLoading && (
					<div className="overflow-x-auto mt-2">
						<table className="min-w-full divide-y divide-gray-200 border border-gray-200">
							<thead className="bg-gray-100">
								<tr>
									<th scope="col" className="sticky left-0 bg-gray-100 z-30 px-3 py-3.5 text-left text-sm font-semibold text-gray-900 cursor-pointer" style={{ minWidth: stickyCol1Width, width: stickyCol1Width, boxShadow: `1px 0 0 0 ${borderColorForShadow}` }} onClick={() => requestSort('studentName')}>
                                        <div className="flex items-center">Nombre Estudiante {getSortIcon('studentName')}</div>
                                    </th>
									<th scope="col" className="sticky bg-gray-100 z-30 px-3 py-3.5 text-center text-sm font-semibold text-gray-900 whitespace-nowrap cursor-pointer" style={{ left: stickyCol2LeftPosition, minWidth: stickyCol2Width, width: stickyCol2Width, boxShadow: `1px 0 0 0 ${borderColorForShadow}` }} onClick={() => requestSort('overallAttendancePercentage')}>
                                        <div className="flex items-center justify-center">Asistencia (%) {getSortIcon('overallAttendancePercentage')}</div>
                                    </th>
									{meetings.map(meeting => (
										<th key={meeting.meetingId} scope="col" className="px-2 py-3.5 text-center text-xs font-medium text-gray-600 whitespace-nowrap min-w-[110px] border-l border-gray-200">
											<div dangerouslySetInnerHTML={{ __html: formatMeetingDateMultiLine(meeting.meetingDateTime) }} />
                                            <span className="mt-1 inline-block px-2 py-0.5 text-xxs font-semibold text-gray-600 bg-gray-200 rounded-full">{meeting.meetingType}</span>
										</th>
									))}
								</tr>
							</thead>
							<tbody className="bg-white">
								{sortedStudents.map(student => (
									<tr key={student.studentUid} className="group border-t border-gray-200 hover:bg-gray-50">
										<td className="sticky left-0 bg-white group-hover:bg-gray-50 z-20 px-3 py-3 text-sm font-medium text-gray-800 whitespace-nowrap" style={{ minWidth: stickyCol1Width, width: stickyCol1Width, boxShadow: `1px 0 0 0 ${borderColorForShadow}` }}>{student.studentName}</td>
										<td className="sticky bg-white group-hover:bg-gray-50 z-20 px-3 py-3 text-center text-sm text-gray-600 whitespace-nowrap" style={{ left: stickyCol2LeftPosition, minWidth: stickyCol2Width, width: stickyCol2Width, boxShadow: `1px 0 0 0 ${borderColorForShadow}` }}>
											<span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${student.overallAttendancePercentage < 50 ? 'bg-red-100 text-red-800' : student.overallAttendancePercentage < 75 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
												{student.overallAttendancePercentage}%
											</span>
										</td>
										{meetings.map(meeting => {
											const isCurrentCellUpdating = updatingCell?.studentUid === student.studentUid && updatingCell?.meetingId === meeting.meetingId;
											const attended = student.attendanceByMeeting[meeting.meetingId];
											const isDisabled = isCurrentCellUpdating || !meeting.isActiveForAttendance;
											const buttonTitle = !meeting.isActiveForAttendance ? "Asistencia no está activa" : attended ? "Marcar No Asistió" : "Marcar Asistió";
											return (
												<td key={`${student.studentUid}-${meeting.meetingId}`} className="px-4 py-2 text-center text-sm whitespace-nowrap border-l border-gray-200 align-middle">
													<div className="flex justify-center items-center">
														<Button
															onClick={() => { if (meeting.isActiveForAttendance) { handleToggleAttendance(meeting.meetingId, student.studentUid); }}}
															className={`p-1.5 rounded-full text-xs w-8 h-8 flex items-center justify-center ${isCurrentCellUpdating ? 'opacity-50 cursor-wait' : ''} ${!meeting.isActiveForAttendance ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : attended ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
															disabled={isDisabled}
															title={buttonTitle}>
															{isCurrentCellUpdating ? (
																<svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
															) : !meeting.isActiveForAttendance ? (
																<span className="text-gray-400">-</span>
															) : attended ? (
																<CheckCircleIcon className="h-5 w-5" />
															) : (
																<MinusCircleIcon className="h-5 w-5" />
															)}
														</Button>
													</div>
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</main>
	);
}
