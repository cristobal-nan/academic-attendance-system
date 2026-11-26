"use client";

import { useState, FormEvent, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Button from "@/components/Button";
import { MeetingBatchFormData, SingleMeetingFormData, SectionSummary, CourseWithSections, MeetingForDeleteListing } from '@/types';

const meetingTypes = ["Cátedra", "Ayudantía", "Laboratorio", "Extra", "Charla", "Reunion", "Otro"];
type ActiveTab = "batch" | "single";

export default function ManageMeetingsPage() {
	const router = useRouter();
	const { user, authFetch, isLoading: authIsLoading } = useAuth();
	
	const isAdmin = user?.roles?.some(role => ["admin", "profesor", "ayudante"].includes(role)) ?? false;

    const [activeTab, setActiveTab] = useState<ActiveTab>("batch");
	
    // El estado inicial de las fechas ahora está vacío, se llenará desde la API
	const [batchFormData, setBatchFormData] = useState<MeetingBatchFormData>({
		courseId: "", sectionId: "", startDate: "", endDate: "",
		location: "", organizerUid: "", meetingType: meetingTypes[0],
	});
	const [singleMeetingFormData, setSingleMeetingFormData] = useState<SingleMeetingFormData>({
		courseId: "", sectionId: "", 
        meetingDate: new Date().toISOString().split('T')[0], // Valor por defecto: hoy
        startTime: "09:00", 
        endTime: "10:30",
		location: "", organizerUid: "", meetingType: meetingTypes[0],
	});
    
	const [isCreatingSingle, setIsCreatingSingle] = useState(false);
	const [singleCreateError, setSingleCreateError] = useState<string | null>(null);
	const [singleCreateSuccessMessage, setSingleCreateSuccessMessage] = useState<string | null>(null);
	const [allCoursesWithSections, setAllCoursesWithSections] = useState<CourseWithSections[]>([]);
	const [sectionsForSelectedCourseBatch, setSectionsForSelectedCourseBatch] = useState<SectionSummary[]>([]);
	const [sectionsForSelectedCourseSingle, setSectionsForSelectedCourseSingle] = useState<SectionSummary[]>([]);

	const [isLoadingBatch, setIsLoadingBatch] = useState(false);
	const [isDataLoading, setIsDataLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [batchSuccessMessage, setBatchSuccessMessage] = useState<string | null>(null);
	const [deleteCourseId, setDeleteCourseId] = useState<string>("");
	const [deleteSectionId, setDeleteSectionId] = useState<string>("");
	const [meetingsForDeleteDropdown, setMeetingsForDeleteDropdown] = useState<MeetingForDeleteListing[]>([]);
	const [selectedMeetingIdsToDelete, setSelectedMeetingIdsToDelete] = useState<string[]>([]);
	const [isLoadingMeetingsForDelete, setIsLoadingMeetingsForDelete] = useState(false);
	const [isDeletingMeetings, setIsDeletingMeetings] = useState(false);
	const [deleteMeetingsError, setDeleteMeetingsError] = useState<string | null>(null);
	const [deleteMeetingsSuccessMessage, setDeleteMeetingsSuccessMessage] = useState<string | null>(null);
	const [showDeleteMeetingsConfirm, setShowDeleteMeetingsConfirm] = useState(false);
	const [sectionsForDeleteMeeting, setSectionsForDeleteMeeting] = useState<SectionSummary[]>([]);

    // --- NUEVO ESTADO PARA LAS FECHAS DEL SEMESTRE ---
    const [semesterDates, setSemesterDates] = useState<{ start: string; end: string } | null>(null);

	useEffect(() => {
        async function fetchDataForPage() {
            if (!isAdmin) {
                setError("No tienes permiso para acceder a esta página.");
                setIsDataLoading(false);
                return;
            }
            setIsDataLoading(true);
            setError(null);
            try {
				const [coursesRes, semesterDatesRes] = await Promise.all([
					authFetch("/users/me/courses-with-sections"),
					authFetch("/config/semester-dates")
				]);

                if (!coursesRes.ok) throw new Error(`Error cargando cursos: ${coursesRes.statusText}`);
                setAllCoursesWithSections(await coursesRes.json());
				
                if (!semesterDatesRes.ok) throw new Error(`Error cargando fechas del semestre: ${semesterDatesRes.statusText}`);
                const dates = await semesterDatesRes.json();
                setSemesterDates(dates);

			} catch (err) {
				if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
					setError("Error cargando datos necesarios: " + err.message);
				}
			} finally {
                setIsDataLoading(false);
            }
        }
		
		if (!authIsLoading) {
			fetchDataForPage();
		}
	}, [isAdmin, authFetch, authIsLoading]);

	// --- NUEVO USE EFFECT PARA ESTABLECER FECHAS POR DEFECTO EN EL FORMULARIO BATCH ---
	useEffect(() => {
		if (semesterDates) {
			setBatchFormData(prev => ({
				...prev,
				startDate: semesterDates.start,
				endDate: semesterDates.end,
			}));
		}
	}, [semesterDates]);

    useEffect(() => { 
		if (batchFormData.courseId && allCoursesWithSections.length > 0) {
			const selectedCourse = allCoursesWithSections.find(c => c.courseID === batchFormData.courseId);
			setSectionsForSelectedCourseBatch(selectedCourse?.sections || []);
			setBatchFormData(prev => ({ ...prev, sectionId: "" })); // Reset sectionId
		} else {
			setSectionsForSelectedCourseBatch([]);
		}
	}, [batchFormData.courseId, allCoursesWithSections]);

	useEffect(() => { 
		if (singleMeetingFormData.courseId && allCoursesWithSections.length > 0) {
			const selectedCourse = allCoursesWithSections.find(c => c.courseID === singleMeetingFormData.courseId);
			setSectionsForSelectedCourseSingle(selectedCourse?.sections || []);
			setSingleMeetingFormData(prev => ({ ...prev, sectionId: "" })); // Reset sectionId
		} else {
			setSectionsForSelectedCourseSingle([]);
		}
	}, [singleMeetingFormData.courseId, allCoursesWithSections]);

	useEffect(() => {
		if (deleteCourseId && allCoursesWithSections.length > 0) {
			const selectedCourse = allCoursesWithSections.find(c => c.courseID === deleteCourseId);
			setSectionsForDeleteMeeting(selectedCourse?.sections || []);
			setDeleteSectionId(""); 
			setMeetingsForDeleteDropdown([]); 
			setSelectedMeetingIdsToDelete([]); 
		} else {
			setSectionsForDeleteMeeting([]);
		}
	}, [deleteCourseId, allCoursesWithSections]);

	const fetchMeetingsForDeleteUI = useCallback(async () => {
		if (!deleteSectionId || !isAdmin) {
			setMeetingsForDeleteDropdown([]);
			setSelectedMeetingIdsToDelete([]);
			return;
		}
		setIsLoadingMeetingsForDelete(true);
		setDeleteMeetingsError(null);
		try {
			const response = await authFetch(`/sections/${deleteSectionId}/meetings`);
			if (!response.ok) throw new Error("No se pudieron cargar las reuniones de la sección.");

			const data: MeetingForDeleteListing[] = await response.json();
			const formattedMeetings = data.map(meeting => ({
				...meeting,
				meetingDateTime: new Date(meeting.meetingDateTime).toLocaleString('es-CL', {
					day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
				})
			}));
			setMeetingsForDeleteDropdown(formattedMeetings);
			setSelectedMeetingIdsToDelete([]);
		} catch (err) {
			if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
				setDeleteMeetingsError("Error cargando reuniones: " + err.message);
			}
			setMeetingsForDeleteDropdown([]);
		} finally {
			setIsLoadingMeetingsForDelete(false);
		}
	}, [deleteSectionId, isAdmin, authFetch]);

	useEffect(() => {
		fetchMeetingsForDeleteUI();
	}, [fetchMeetingsForDeleteUI]);

    const handleBatchFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		setBatchFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
	};
	const handleSingleMeetingFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		setSingleMeetingFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
	};

	const handleBatchSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setIsLoadingBatch(true);
		setError(null); 
		setBatchSuccessMessage(null);

		if (!batchFormData.courseId || !batchFormData.sectionId || !batchFormData.startDate || !batchFormData.endDate ) {
			setError("Formulario Batch: Curso, Sección y Fechas son obligatorios.");
			setIsLoadingBatch(false);
			return;
		}
        const payload = {
            sectionID: batchFormData.sectionId, startDate: batchFormData.startDate, endDate: batchFormData.endDate,
            location: batchFormData.location.trim() || undefined,
            organizerUID: batchFormData.organizerUid.trim() || undefined,
        };
		try {
			const response = await authFetch("/class-meetings/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ detail: `Error ${response.status}` }));
				throw new Error(errorData.detail || `Error ${response.status} creando reuniones batch.`);
			}
			const createdMeetings = await response.json();
			setBatchSuccessMessage(`¡Se crearon ${createdMeetings.length} reuniones en batch exitosamente!`);
			setBatchFormData(prev => ({ ...prev, location: "" }));
		} catch (err) {
			if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
				setError(err.message); 
			}
		} finally {
			setIsLoadingBatch(false);
		}
	};

	const handleSingleMeetingSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setIsCreatingSingle(true);
		setSingleCreateError(null);
		setSingleCreateSuccessMessage(null);

		const { courseId, sectionId, meetingDate, startTime, endTime, location, organizerUid, meetingType } = singleMeetingFormData;

		if (!courseId || !sectionId || !meetingDate || !startTime || !endTime || !meetingType) {
			setSingleCreateError("Todos los campos marcados con * son obligatorios.");
			setIsCreatingSingle(false);
			return;
		}
        
        // Unimos la fecha y las horas para crear los strings ISO que el backend espera
        const meetingDateTimeISO = new Date(`${meetingDate}T${startTime}`).toISOString();
        const endTimeISO = new Date(`${meetingDate}T${endTime}`).toISOString();

		const payload = {
            sectionID: sectionId,
            meetingDateTime: meetingDateTimeISO,
            endTime: endTimeISO,
            location: location.trim() || undefined,
            organizerUID: organizerUid.trim() || undefined,
            meetingType: meetingType,
        };

		try {
			const response = await authFetch("/class-meetings/single", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.detail || `Error creando la reunión.`);
			}
			const createdMeeting = await response.json();
			setSingleCreateSuccessMessage(`¡Reunión "${createdMeeting.meetingType}" creada exitosamente!`);
            // Limpiamos el formulario
			setSingleMeetingFormData({ courseId: "", sectionId: "", meetingDate: new Date().toISOString().split('T')[0], startTime: "09:00", endTime: "10:30", location: "", organizerUid: "", meetingType: meetingTypes[0] });
		} catch (err) {
			if (err instanceof Error) setSingleCreateError(err.message);
		} finally {
			setIsCreatingSingle(false);
		}
	};

	const handleMeetingSelectionToDelete = (meetingId: string) => {
		setSelectedMeetingIdsToDelete(prevSelected =>
			prevSelected.includes(meetingId)
				? prevSelected.filter(id => id !== meetingId)
				: [...prevSelected, meetingId]
		);
	};
	const handleDeleteMeetingsAttempt = () => {
		if (selectedMeetingIdsToDelete.length === 0) {
			setDeleteMeetingsError("Por favor, selecciona al menos una reunión para eliminar.");
			return;
		}
		setShowDeleteMeetingsConfirm(true);
		setDeleteMeetingsError(null);
		setDeleteMeetingsSuccessMessage(null);
	};

	const confirmDeleteMeetings = async () => {
		if (selectedMeetingIdsToDelete.length === 0) return;
		setIsDeletingMeetings(true);
		setDeleteMeetingsError(null);
		setDeleteMeetingsSuccessMessage(null);
		let errorsEncountered = false;
        let successfulDeletes = 0;
		try {
			for (const meetingId of selectedMeetingIdsToDelete) {
				const response = await authFetch(`/class-meetings/${meetingId}`, { method: 'DELETE' });
				if (response.status !== 204) {
					const errorData = await response.json().catch(() => null);
					console.error(`Error eliminando reunión ${meetingId}:`, errorData?.detail || response.statusText);
					errorsEncountered = true;
				} else {
                    successfulDeletes++;
                }
			}
			if (errorsEncountered) {
				setDeleteMeetingsError(`Algunas reuniones no pudieron ser eliminadas. ${successfulDeletes} eliminada(s).`);
			} else {
				setDeleteMeetingsSuccessMessage(`${successfulDeletes} reunión(es) eliminada(s) exitosamente.`);
			}
			setShowDeleteMeetingsConfirm(false);
			await fetchMeetingsForDeleteUI();
			setSelectedMeetingIdsToDelete([]);
		} catch (err) {
			if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
				setDeleteMeetingsError(err.message);
			}
		} finally {
			setIsDeletingMeetings(false);
		}
	};
	    if (isDataLoading && !user && !isAdmin) {
        return <p className="text-center p-8">Verificando sesión y permisos...</p>;
    }
	if (!isAdmin && user && !isDataLoading) {
         return (
            <div className="max-w-2xl mx-auto p-6 sm:p-8 text-center">
                 <p className="text-red-600 font-semibold">{error || "No tienes permiso para acceder a esta página."}</p>
                 <Button onClick={() => router.push('/dashboard')} variant="secondary" className="mt-4">Volver al Panel</Button>
            </div>
        );
    }
	if (isDataLoading && isAdmin) return <p className="text-center p-8">Cargando datos necesarios...</p>;

	return (
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-8">
		    <Button onClick={() => router.push('/dashboard')} variant="secondary" className="mb-4 inline-flex items-center"> &larr; Volver al Panel</Button>

			{/* SECCIÓN PARA CREAR REUNIONES */}
            <section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg w-full">
				<h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Gestionar Reuniones</h1>
                <div className="mt-6 border-b border-gray-200">
					<nav className="-mb-px flex space-x-8" aria-label="Tabs">
						<button onClick={() => setActiveTab("batch")} className={`${activeTab === "batch" ? "border-red-500 text-red-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"} whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm`}>
							Crear por Lote (Batch)
						</button>
						<button onClick={() => setActiveTab("single")} className={`${activeTab === "single" ? "border-red-500 text-red-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"} whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm`}>
							Crear Reunión Única
						</button>
					</nav>
				</div>
				<div className="mt-6">
					{activeTab === "batch" && (
                        <form onSubmit={handleBatchSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="batchCourseId" className="block text-sm font-medium text-gray-700 mb-1">Curso <span className="text-red-500">*</span></label>
                                <select name="courseId" id="batchCourseId" value={batchFormData.courseId} onChange={handleBatchFormChange} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black">
                                    <option value="">-- Selecciona un Curso --</option>
                                    {allCoursesWithSections.map(course => (<option key={course.courseID} value={course.courseID}>{course.courseName}</option>))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="batchSectionId" className="block text-sm font-medium text-gray-700 mb-1">Sección <span className="text-red-500">*</span></label>
                                <select name="sectionId" id="batchSectionId" value={batchFormData.sectionId} onChange={handleBatchFormChange} required disabled={!batchFormData.courseId || sectionsForSelectedCourseBatch.length === 0} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black disabled:bg-gray-100">
                                    <option value="">-- Selecciona una Sección --</option>
                                    {sectionsForSelectedCourseBatch.map(section => (<option key={section.sectionID} value={section.sectionID}>{section.sectionIdentifier}</option>))}
                                </select>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="batchStartDate" className="block text-sm font-medium text-gray-700 mb-1">Desde Fecha <span className="text-red-500">*</span></label>
                                    <input type="date" name="startDate" id="batchStartDate" value={batchFormData.startDate} onChange={handleBatchFormChange} required min={semesterDates?.start} max={semesterDates?.end} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black" />
                                </div>
                                <div>
                                    <label htmlFor="batchEndDate" className="block text-sm font-medium text-gray-700 mb-1">Hasta Fecha <span className="text-red-500">*</span></label>
                                    <input type="date" name="endDate" id="batchEndDate" value={batchFormData.endDate} onChange={handleBatchFormChange} required min={semesterDates?.start} max={semesterDates?.end} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="batchLocation" className="block text-sm font-medium text-gray-700 mb-1">Sala (Opcional)</label>
                                <input type="text" name="location" id="batchLocation" value={batchFormData.location} onChange={handleBatchFormChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black" placeholder="Ej: Sala Virtual Teams / Sala C-305" />
                            </div>
							{batchSuccessMessage && <p className="text-sm text-green-600 bg-green-100 p-3 rounded-md">{batchSuccessMessage}</p>}
                            {error && <p className="text-sm text-red-600 bg-red-100 p-3 rounded-md">{error}</p>}
                            <div className="flex justify-end pt-4">
                                <Button type="submit" disabled={isLoadingBatch || isDataLoading} variant="primary">{isLoadingBatch ? "Generando..." : "Generar Reuniones en Lote"}</Button>
                            </div>
                        </form>
                    )}
					{activeTab === "single" && ( 
                        <form onSubmit={handleSingleMeetingSubmit} className="space-y-4">
                             <div>
                                <label htmlFor="singleCourseId" className="block text-sm font-medium text-gray-700 mb-1">Curso <span className="text-red-500">*</span></label>
                                <select name="courseId" id="singleCourseId" value={singleMeetingFormData.courseId} onChange={handleSingleMeetingFormChange} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black">
                                    <option value="">-- Selecciona un Curso --</option>
                                    {allCoursesWithSections.map(course => (<option key={course.courseID} value={course.courseID}>{course.courseName}</option>))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="singleSectionId" className="block text-sm font-medium text-gray-700 mb-1">Sección <span className="text-red-500">*</span></label>
                                <select name="sectionId" id="singleSectionId" value={singleMeetingFormData.sectionId} onChange={handleSingleMeetingFormChange} required disabled={!singleMeetingFormData.courseId || sectionsForSelectedCourseSingle.length === 0} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black disabled:bg-gray-100">
                                    <option value="">-- Selecciona una Sección --</option>
                                    {sectionsForSelectedCourseSingle.map(section => (<option key={section.sectionID} value={section.sectionID}>{section.sectionIdentifier}</option>))}
                                </select>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div>
                                    <label htmlFor="singleMeetingDate" className="block text-sm font-medium text-gray-700 mb-1">Fecha <span className="text-red-500">*</span></label>
                                    <input type="date" name="meetingDate" id="singleMeetingDate" 
                                           value={singleMeetingFormData.meetingDate} onChange={handleSingleMeetingFormChange} required 
                                           min={semesterDates?.start} max={semesterDates?.end}
                                           className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 sm:text-sm text-black" />
                                </div>
                                <div>
                                    <label htmlFor="singleStartTime" className="block text-sm font-medium text-gray-700 mb-1">Hora Inicio <span className="text-red-500">*</span></label>
                                    <input type="time" name="startTime" id="singleStartTime" 
                                           value={singleMeetingFormData.startTime} onChange={handleSingleMeetingFormChange} required 
                                           className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 sm:text-sm text-black" />
                                </div>
                                <div>
                                    <label htmlFor="singleEndTime" className="block text-sm font-medium text-gray-700 mb-1">Hora Término <span className="text-red-500">*</span></label>
                                    <input type="time" name="endTime" id="singleEndTime" 
                                           value={singleMeetingFormData.endTime} onChange={handleSingleMeetingFormChange} required 
                                           className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 sm:text-sm text-black" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="singleLocation" className="block text-sm font-medium text-gray-700 mb-1">Sala (Opcional)</label>
                                <input type="text" name="location" id="singleLocation" value={singleMeetingFormData.location} onChange={handleSingleMeetingFormChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black" placeholder="Ej: Sala Virtual Teams / Sala C-305" />
                            </div>
                            <div>
                                <label htmlFor="singleMeetingType" className="block text-sm font-medium text-gray-700 mb-1">Tipo de Reunión <span className="text-red-500">*</span></label>
                                <select name="meetingType" id="singleMeetingType" value={singleMeetingFormData.meetingType} onChange={handleSingleMeetingFormChange} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black">
                                    {meetingTypes.map(type => (<option key={type} value={type}>{type}</option>))}
                                </select>
                            </div>

							{singleCreateSuccessMessage && <p className="text-sm text-green-600 bg-green-100 p-3 rounded-md">{singleCreateSuccessMessage}</p>}
                            {singleCreateError && <p className="text-sm text-red-600 bg-red-100 p-3 rounded-md">{singleCreateError}</p>}
							
                            <div className="flex justify-end pt-4">
                                <Button type="submit" disabled={isCreatingSingle || isDataLoading} variant="primary">
                                    {isCreatingSingle ? "Creando..." : "Crear Reunión Única"}
                                </Button>
                            </div>
                        </form>
                    )}
				</div>
			</section>

            {/* SECCIÓN RESTAURADA PARA ELIMINAR REUNIONES */}
            <hr />
            <section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg w-full">
                <h2 className="text-2xl font-semibold text-gray-800 mb-6">Eliminar Reuniones de Clase</h2>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="deleteMeetingCourseId" className="block text-sm font-medium text-gray-700 mb-1">1. Selecciona un Curso</label>
                        <select name="deleteCourseId" id="deleteMeetingCourseId" value={deleteCourseId}
                            onChange={(e) => { setDeleteCourseId(e.target.value); setDeleteSectionId(''); }}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black">
                            <option value="">-- Selecciona un Curso --</option>
                            {allCoursesWithSections.map(course => (<option key={course.courseID} value={course.courseID}>{course.courseName}</option>))}
                        </select>
                    </div>
                    {deleteCourseId && (
                        <div>
                            <label htmlFor="deleteMeetingSectionId" className="block text-sm font-medium text-gray-700 mb-1">2. Selecciona una Sección</label>
                            <select name="deleteSectionId" id="deleteMeetingSectionId" value={deleteSectionId}
                                onChange={(e) => setDeleteSectionId(e.target.value)}
                                disabled={sectionsForDeleteMeeting.length === 0}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black disabled:bg-gray-100">
                                <option value="">-- Selecciona una Sección --</option>
                                {sectionsForDeleteMeeting.map(section => (<option key={section.sectionID} value={section.sectionID}>{section.sectionIdentifier}</option>))}
                            </select>
                        </div>
                    )}
                    {deleteSectionId && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">3. Reuniones (Selecciona para eliminar)</label>
                            {isLoadingMeetingsForDelete && <p className="text-xs text-gray-500">Cargando reuniones...</p>}
                            {!isLoadingMeetingsForDelete && meetingsForDeleteDropdown.length === 0 && (<p className="text-xs text-gray-500">No hay reuniones para esta sección.</p>)}
                            {meetingsForDeleteDropdown.length > 0 && (
                                <div className="mt-2 space-y-2 max-h-72 overflow-y-auto border p-2 rounded-md bg-gray-50">
                                    {meetingsForDeleteDropdown.map(meeting => (
                                        <label key={meeting.id} htmlFor={`meeting-del-${meeting.id}`} className="flex items-center p-2 hover:bg-gray-100 rounded-md cursor-pointer">
                                            <input id={`meeting-del-${meeting.id}`} type="checkbox" checked={selectedMeetingIdsToDelete.includes(meeting.id)}
                                                onChange={() => handleMeetingSelectionToDelete(meeting.id)}
                                                className="h-4 w-4 text-red-600 border-gray-300 rounded focus:ring-red-500" />
                                            <span className="ml-3 text-sm text-gray-700">{meeting.meetingDateTime} - {meeting.meetingType}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {deleteMeetingsError && <p className="text-sm text-red-600 bg-red-100 p-3 rounded-md">{deleteMeetingsError}</p>}
                    {deleteMeetingsSuccessMessage && <p className="text-sm text-green-600 bg-green-100 p-3 rounded-md">{deleteMeetingsSuccessMessage}</p>}
                    <div className="flex justify-end pt-4">
                        <Button onClick={handleDeleteMeetingsAttempt} disabled={selectedMeetingIdsToDelete.length === 0 || isDeletingMeetings} variant="primary" className="bg-red-600 hover:bg-red-700 text-white">
                            {isDeletingMeetings ? "Eliminando..." : `Eliminar ${selectedMeetingIdsToDelete.length} Reunión(es)`}
                        </Button>
                    </div>
                </div>
            </section>

			{/* Modal de Confirmación para Eliminar Reuniones */}
            {showDeleteMeetingsConfirm && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-md mx-auto">
                        <h3 className="text-lg font-semibold text-gray-900">Confirmar Eliminación</h3>
                        <p className="mt-2 text-sm text-gray-600">¿Estás seguro de que quieres eliminar {selectedMeetingIdsToDelete.length} reunión(es) seleccionada(s)?</p>
                        <p className="mt-1 text-xs text-red-500">Esta acción también eliminará los registros de asistencia asociados. No se puede deshacer.</p>
                        <div className="mt-6 flex justify-end space-x-3">
                            <Button variant="secondary" onClick={() => setShowDeleteMeetingsConfirm(false)} disabled={isDeletingMeetings}>Cancelar</Button>
                            <Button onClick={confirmDeleteMeetings} variant="primary" className="bg-red-600 hover:bg-red-700 text-white" disabled={isDeletingMeetings}>
                                {isDeletingMeetings ? "Eliminando..." : "Sí, Eliminar"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
		</div>
	);
}