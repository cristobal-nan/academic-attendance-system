"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import ScheduleForm from '@/components/ScheduleForm'; // Se usará en el nuevo modal
import { CourseWithSections, SectionSummary, WeeklyScheduleItemData } from '@/types';

// Define el tipo para la información del curso que recibimos de Canvas
interface CanvasCourse {
    canvas_course_id: number;
    name: string;
    course_code: string;
}

// Define el tipo para la propuesta de reunión que viene del backend
interface MeetingProposal {
    meetingCount: number;
    startDate: string;
    endDate: string;
    weeklySchedule: { dayOfWeek: string }[];
}

// Función auxiliar para calcular el número de reuniones
const calculateMeetingCount = (
    startDateStr: string,
    endDateStr: string,
    schedule: { dayOfWeek: string }[]
): number => {
    if (!startDateStr || !endDateStr || !schedule || schedule.length === 0) return 0;
    try {
        const startDate = new Date(startDateStr + 'T00:00:00Z');
        const endDate = new Date(endDateStr + 'T00:00:00Z');
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) return 0;

        const scheduleDays = schedule.map(item => item.dayOfWeek.toUpperCase());
        const daysMap: { [key: string]: number } = { "LUNES": 1, "MARTES": 2, "MIÉRCOLES": 3, "JUEVES": 4, "VIERNES": 5, "SÁBADO": 6, "DOMINGO": 0 };
        const scheduleDayNumbers = scheduleDays.map(day => daysMap[day]).filter(n => n !== undefined);

        let count = 0;
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            if (scheduleDayNumbers.includes(currentDate.getUTCDay())) count++;
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
        return count;
    } catch (error) {
        console.error("Error calculating meeting count:", error);
        return 0;
    }
};

export default function LmsIntegrationPage() {
    const { authFetch } = useAuth();

    // Estados para la Sincronización Principal
    const [coursesToProcess, setCoursesToProcess] = useState<CanvasCourse[]>([]);
    const [currentCourseIndex, setCurrentCourseIndex] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    
    // --- ESTADOS PARA EL MODAL DE HORARIO MANUAL MEJORADO ---
    const [isManualScheduleModalOpen, setIsManualScheduleModalOpen] = useState(false);
    const [manualScheduleData, setManualScheduleData] = useState<{ sectionId: string; message: string; proposal: MeetingProposal } | null>(null);
    const [isSavingAndCreating, setIsSavingAndCreating] = useState(false);
    const [currentManualSchedule, setCurrentManualSchedule] = useState<WeeklyScheduleItemData[]>([]);
    const [manualMeetingCount, setManualMeetingCount] = useState(0);

    // Estados para el Modal de Propuesta (cuando el horario SÍ viene de Canvas)
    const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
    const [proposalData, setProposalData] = useState<{ sectionId: string; proposal: MeetingProposal } | null>(null);
    const [isCreatingMeetings, setIsCreatingMeetings] = useState(false);
    const [recalculatedMeetingCount, setRecalculatedMeetingCount] = useState(0);

    // Estados para la Sincronización de Notas
    const [allCourses, setAllCourses] = useState<CourseWithSections[]>([]);
    const [selectedCourseIdForGrading, setSelectedCourseIdForGrading] = useState('');
    const [sectionsForGrading, setSectionsForGrading] = useState<SectionSummary[]>([]);
    const [selectedSectionIdForGrading, setSelectedSectionIdForGrading] = useState('');
    const [isPushingGrades, setIsPushingGrades] = useState(false);
    const [pushGradesMessage, setPushGradesMessage] = useState<{type: 'info' | 'success' | 'error', text: string} | null>(null);

    // Carga inicial de datos para los selectores
    useEffect(() => {
        const fetchCourses = async () => {
            try {
                const response = await authFetch('/users/me/courses-with-sections');
                if(response.ok) setAllCourses(await response.json());
            } catch (error) {
                console.error("Failed to fetch courses for grading selectors", error);
            }
        };
        fetchCourses();
    }, [authFetch]);

    // Actualiza el selector de secciones
    useEffect(() => {
        if (selectedCourseIdForGrading) {
            const course = allCourses.find(c => c.courseID === selectedCourseIdForGrading);
            setSectionsForGrading(course ? course.sections : []);
            setSelectedSectionIdForGrading('');
        } else {
            setSectionsForGrading([]);
        }
    }, [selectedCourseIdForGrading, allCourses]);

    // Procesa un curso
    const processCourse = useCallback(async (course: CanvasCourse) => {
        setLogs(prev => [...prev, `Procesando: ${course.name} (${course.course_code})...`]);
        try {
            const response = await authFetch('/lms/sync/process-course', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(course),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || `Error procesando el curso ${course.name}`);

            if (data.status === 'proposal_ready' && data.proposal) {
                setLogs(prev => [...prev, `✅ ${data.message}`]);
                setProposalData({ sectionId: data.sectionId, proposal: data.proposal });
                setRecalculatedMeetingCount(data.proposal.meetingCount);
                setIsProposalModalOpen(true);
            } else if (data.status === 'requires_manual_schedule' && data.proposal) {
                setLogs(prev => [...prev, `⚠️ ${data.message}`]);
                setManualScheduleData({ sectionId: data.sectionId, message: data.message, proposal: data.proposal });
                setIsManualScheduleModalOpen(true);
            } else {
                 setLogs(prev => [...prev, `✅ ${data.message || 'Procesado con respuesta desconocida.'}`]);
                 setCurrentCourseIndex(prev => prev + 1);
            }
        } catch (err) {
            setLogs(prev => [...prev, `❌ Error procesando ${course.name}: ${(err as Error).message}`]);
            setCurrentCourseIndex(prev => prev + 1);
        }
    }, [authFetch]);

    // Motor del bucle de procesamiento
    useEffect(() => {
        const isAnyModalOpen = isManualScheduleModalOpen || isProposalModalOpen;
        if (!isSyncing || isAnyModalOpen || currentCourseIndex >= coursesToProcess.length) {
            if (isSyncing && !isAnyModalOpen && currentCourseIndex >= coursesToProcess.length && coursesToProcess.length > 0) {
                setLogs(prev => [...prev, "🎉 Sincronización completada."]);
                setIsSyncing(false);
            }
            return;
        }
        const currentCourse = coursesToProcess[currentCourseIndex];
        if(currentCourse) processCourse(currentCourse);
    }, [currentCourseIndex, coursesToProcess, isSyncing, isManualScheduleModalOpen, isProposalModalOpen, processCourse]);

    // useEffect para recalcular el conteo de reuniones en el modal de propuesta
    useEffect(() => {
        if (isProposalModalOpen && proposalData) {
            const count = calculateMeetingCount(
                proposalData.proposal.startDate,
                proposalData.proposal.endDate,
                proposalData.proposal.weeklySchedule
            );
            setRecalculatedMeetingCount(count);
        }
    }, [proposalData, isProposalModalOpen]);

    // useEffect para recalcular el conteo en el modal manual
    useEffect(() => {
        if (isManualScheduleModalOpen && manualScheduleData) {
            const count = calculateMeetingCount(
                manualScheduleData.proposal.startDate,
                manualScheduleData.proposal.endDate,
                currentManualSchedule
            );
            setManualMeetingCount(count);
        }
    }, [manualScheduleData, currentManualSchedule, isManualScheduleModalOpen]);

    // Inicia la sincronización
    const handleStartSync = async () => {
        setIsSyncing(true);
        setLogs(["Iniciando, obteniendo lista de cursos desde Canvas..."]);
        setCurrentCourseIndex(0);
        setCoursesToProcess([]);
        try {
            const response = await authFetch('/lms/sync/initiate');
            if (!response.ok) throw new Error((await response.json()).detail || 'No se pudo obtener la lista de cursos.');
            const courses: CanvasCourse[] = await response.json();
            if (courses.length === 0) {
                setLogs(prev => [...prev, "No se encontraron cursos en Canvas para sincronizar."]);
                setIsSyncing(false); return;
            }
            setLogs(prev => [...prev, `Se encontraron ${courses.length} cursos para sincronizar.`]);
            setCoursesToProcess(courses);
        } catch (err) {
            setLogs(prev => [...prev, `❌ Error inicial: ${(err as Error).message}`]);
            setIsSyncing(false);
        }
    };
    
    // Handlers para el modal de propuesta
    const handleProposalDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!proposalData) return;
        setProposalData({ ...proposalData, proposal: { ...proposalData.proposal, [e.target.name]: e.target.value } });
    };

    const handleConfirmMeetingCreation = async () => {
        if (!proposalData) return;
        setIsCreatingMeetings(true);
        setLogs(prev => [...prev, `Creando reuniones para la sección ${proposalData.sectionId} entre ${proposalData.proposal.startDate} y ${proposalData.proposal.endDate}...`]);
        try {
            const { sectionId, proposal } = proposalData;
            const payload = { startDate: proposal.startDate, endDate: proposal.endDate };
            const response = await authFetch(`/sections/${sectionId}/create-meetings-from-schedule`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Error al crear las reuniones.");
            setLogs(prev => [...prev, `✅ ${data.message}`]);
        } catch (err) {
            setLogs(prev => [...prev, `❌ Error al crear reuniones: ${(err as Error).message}`]);
        } finally {
            setIsCreatingMeetings(false);
            setIsProposalModalOpen(false);
            setProposalData(null);
            setCurrentCourseIndex(prev => prev + 1);
        }
    };

    const handleSkipMeetingCreation = () => {
        setLogs(prev => [...prev, "Omitida la creación de reuniones. Continuando..."]);
        setIsProposalModalOpen(false);
        setProposalData(null);
        setCurrentCourseIndex(prev => prev + 1);
    };

    // Handlers para el modal de horario manual
    const handleSaveAndCreateMeetings = async () => {
        if (!manualScheduleData || currentManualSchedule.length === 0) {
            alert("Por favor, define al menos una reunión en el horario.");
            return;
        }
        setIsSavingAndCreating(true);
        setLogs(prev => [...prev, `1. Guardando horario manual para la sección ${manualScheduleData.sectionId}...`]);
        
        try {
            const scheduleResponse = await authFetch(`/sections/${manualScheduleData.sectionId}/schedule`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ weeklySchedule: currentManualSchedule }),
            });
            if (!scheduleResponse.ok) throw new Error((await scheduleResponse.json()).detail || 'No se pudo guardar el horario.');
            setLogs(prev => [...prev, "✅ Horario guardado exitosamente."]);

            setLogs(prev => [...prev, `2. Creando reuniones entre ${manualScheduleData.proposal.startDate} y ${manualScheduleData.proposal.endDate}...`]);
            const meetingsPayload = {
                startDate: manualScheduleData.proposal.startDate,
                endDate: manualScheduleData.proposal.endDate
            };
            const meetingsResponse = await authFetch(`/sections/${manualScheduleData.sectionId}/create-meetings-from-schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(meetingsPayload)
            });
            const meetingsData = await meetingsResponse.json();
            if (!meetingsResponse.ok) throw new Error(meetingsData.detail || "Error al crear las reuniones.");
            setLogs(prev => [...prev, `✅ ${meetingsData.message}`]);

        } catch (err) {
            setLogs(prev => [...prev, `❌ Error en el proceso: ${(err as Error).message}`]);
        } finally {
            setIsSavingAndCreating(false);
            setIsManualScheduleModalOpen(false);
            setManualScheduleData(null);
            setCurrentManualSchedule([]);
            setCurrentCourseIndex(prev => prev + 1);
        }
    };

    const handleManualScheduleCancel = () => {
        setIsManualScheduleModalOpen(false);
        setManualScheduleData(null);
        setCurrentManualSchedule([]);
        setLogs(prev => [...prev, "Cancelada la configuración manual. Continuando..."]);
        setCurrentCourseIndex(prev => prev + 1);
    };

    const handleManualDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!manualScheduleData) return;
        setManualScheduleData({
            ...manualScheduleData,
            proposal: {
                ...manualScheduleData.proposal,
                [e.target.name]: e.target.value,
            }
        });
    };

    // Handler para la sincronización de notas
    const handlePushGrades = async () => {
        if (!selectedSectionIdForGrading) {
            setPushGradesMessage({type: 'error', text: 'Por favor, selecciona un curso y una sección.'});
            return;
        }
        setIsPushingGrades(true);
        setPushGradesMessage({type: 'info', text: 'Iniciando...'});
        try {
            const response = await authFetch(`/lms/canvas/sections/${selectedSectionIdForGrading}/sync-attendance-grades`, {
                method: 'POST',
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Error desconocido.");
            setPushGradesMessage({type: 'success', text: data.message});
        } catch (err) {
            setPushGradesMessage({type: 'error', text: `Error: ${(err as Error).message}`});
        } finally {
            setIsPushingGrades(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
                Integración con Canvas LMS
            </h1>

            {/* Tarjeta de Sincronización Principal */}
            <div className="bg-white p-6 rounded-lg shadow-md border">
                <h2 className="text-xl font-semibold text-gray-700">Sincronización de Cursos y Horarios</h2>
                <p className="mt-2 text-sm text-gray-600">
                    Sincroniza cursos, secciones y personal desde Canvas. El sistema detectará horarios y te pedirá confirmación para crear las reuniones.
                </p>
                <div className="mt-6">
                    <Button onClick={handleStartSync} disabled={isSyncing} variant="primary">
                        {isSyncing ? 'Sincronizando...' : 'Iniciar Sincronización desde Canvas'}
                    </Button>
                </div>
                {logs.length > 0 && (
                    <div className="mt-6 p-4 bg-gray-900 text-white font-mono rounded-md h-72 overflow-y-auto">
                        <h3 className="font-semibold mb-2 text-gray-300">Registro de Sincronización:</h3>
                        <pre className="text-xs whitespace-pre-wrap">{logs.map((log, index) => (<div key={index}>{log}</div>))}</pre>
                    </div>
                )}
            </div>
            
            {/* Tarjeta para Sincronizar Notas */}
            <div className="bg-white p-6 rounded-lg shadow-md border">
                <h2 className="text-xl font-semibold text-gray-700">Sincronizar Calificaciones a Canvas</h2>
                <p className="mt-2 text-sm text-gray-600">
                    Selecciona una sección para enviar los porcentajes de asistencia a una columna de notas en Canvas.
                </p>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="course-select-grading" className="block text-sm font-medium text-gray-700">Curso</label>
                        <select id="course-select-grading" value={selectedCourseIdForGrading} onChange={(e) => setSelectedCourseIdForGrading(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm rounded-md text-black">
                            <option value="">-- Selecciona un curso --</option>
                            {allCourses.map(course => (<option key={course.courseID} value={course.courseID}>{course.courseName}</option>))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="section-select-grading" className="block text-sm font-medium text-gray-700">Sección</label>
                        <select id="section-select-grading" value={selectedSectionIdForGrading} onChange={(e) => setSelectedSectionIdForGrading(e.target.value)} disabled={!selectedCourseIdForGrading} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm rounded-md text-black disabled:bg-gray-50">
                            <option value="">-- Selecciona una sección --</option>
                            {sectionsForGrading.map(section => (<option key={section.sectionID} value={section.sectionID}>{section.sectionIdentifier}</option>))}
                        </select>
                    </div>
                </div>
                <div className="mt-6">
                    <Button onClick={handlePushGrades} disabled={isPushingGrades || !selectedSectionIdForGrading} variant="primary">
                        {isPushingGrades ? 'Sincronizando Notas...' : 'Actualizar Notas en Canvas'}
                    </Button>
                </div>
                {pushGradesMessage && (<p className={`mt-4 text-sm p-3 rounded-md ${pushGradesMessage.type === 'success' ? 'bg-green-100 text-green-800' : pushGradesMessage.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-700'}`}>{pushGradesMessage.text}</p>)}
            </div>

            {/* Modal de Propuesta de Reuniones (cuando el horario viene de Canvas) */}
            {isProposalModalOpen && proposalData && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex justify-center items-center z-50 p-4">
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg">
                        <h3 className="text-lg font-semibold text-gray-900">Confirmar Creación de Reuniones</h3>
                        <p className="mt-2 text-sm text-gray-600">Se propone crear aproximadamente <strong>{recalculatedMeetingCount} reuniones</strong>. Puedes ajustar el rango de fechas si es necesario.</p>
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="startDate" className="block text-xs font-medium text-gray-700">Desde Fecha</label>
                                <input type="date" id="startDate" name="startDate" value={proposalData.proposal.startDate} onChange={handleProposalDateChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm text-black" />
                            </div>
                            <div>
                                <label htmlFor="endDate" className="block text-xs font-medium text-gray-700">Hasta Fecha</label>
                                <input type="date" id="endDate" name="endDate" value={proposalData.proposal.endDate} onChange={handleProposalDateChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm text-black" />
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end space-x-3">
                            <Button variant="secondary" onClick={handleSkipMeetingCreation} disabled={isCreatingMeetings}>Omitir</Button>
                            <Button variant="primary" onClick={handleConfirmMeetingCreation} disabled={isCreatingMeetings}>{isCreatingMeetings ? 'Creando...' : 'Confirmar y Crear'}</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal para configurar horario manual */}
            {isManualScheduleModalOpen && manualScheduleData && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex justify-center items-center z-50 p-4 overflow-y-auto">
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-3xl my-8">
                        <h3 className="text-lg font-semibold text-gray-900">Configurar Horario Manualmente</h3>
                        <p className="mt-2 text-sm text-yellow-800 bg-yellow-100 p-3 rounded-md">{manualScheduleData.message}</p>
                        
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Columna del formulario de horario */}
                            <div>
                                <h4 className="text-md font-semibold text-gray-800 mb-2">1. Define el Horario Semanal</h4>
                                <ScheduleForm
                                    onSave={(schedule) => setCurrentManualSchedule(schedule)}
                                    onCancel={handleManualScheduleCancel}
                                    isSaving={isSavingAndCreating}
                                />
                            </div>
                            {/* Columna del intervalo de fechas y resumen */}
                            <div>
                                <h4 className="text-md font-semibold text-gray-800 mb-2">2. Confirma el Intervalo</h4>
                                <div className="space-y-4 p-4 border rounded-md bg-gray-50">
                                    <div>
                                        <label htmlFor="manualStartDate" className="block text-xs font-medium text-gray-700">Desde Fecha</label>
                                        <input type="date" id="manualStartDate" name="startDate" value={manualScheduleData.proposal.startDate} onChange={handleManualDateChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm text-black" />
                                    </div>
                                    <div>
                                        <label htmlFor="manualEndDate" className="block text-xs font-medium text-gray-700">Hasta Fecha</label>
                                        <input type="date" id="manualEndDate" name="endDate" value={manualScheduleData.proposal.endDate} onChange={handleManualDateChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm text-black" />
                                    </div>
                                </div>
                                <div className="mt-4 p-4 border-t">
                                    <p className="text-sm text-center text-gray-700">
                                        Se crearán aproximadamente <strong className="text-xl text-red-600">{manualMeetingCount}</strong> reuniones.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end space-x-3 border-t pt-4">
                            <Button variant="secondary" onClick={handleManualScheduleCancel} disabled={isSavingAndCreating}>
                                Cancelar
                            </Button>
                            <Button variant="primary" onClick={handleSaveAndCreateMeetings} disabled={isSavingAndCreating || currentManualSchedule.length === 0}>
                                {isSavingAndCreating ? 'Guardando y Creando...' : 'Guardar y Crear Reuniones'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
