"use client";

import { useState, FormEvent, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext"; //
import Button from "@/components/Button"; //
import {
    ListedSectionInfo,
    CourseWithSections,
    SectionFormData,
    CourseForListing,
    UserForListing,
    ComboboxState,
    WeeklyScheduleItemData,
} from "@/types"; //

const daysOfWeek = [
    "LUNES",
    "MARTES",
    "MIÉRCOLES",
    "JUEVES",
    "VIERNES",
    "SÁBADO",
];
const MAX_MEETINGS = 6;
const meetingTypesForSectionSchedule = [
    "Cátedra",
    "Ayudantía",
    "Laboratorio",
    "Extra",
    "Charla",
    "Reunión",
    "Otro",
];

export default function ManageSectionsPage() {
    const router = useRouter();
    // PASO 3: Obtén authFetch del contexto
    const { user, authFetch } = useAuth(); //
    const isAdmin = user?.roles?.includes("admin") ?? false;

    // ... (estados: formData, allCourses, allProfessors, allAssistants, comboboxes, etc. SIN CAMBIOS) ...
    const [formData, setFormData] = useState<SectionFormData>({
        courseID: "",
        courseName: "",
        professors: [],
        assistants: [],
        sectionIdentifier: "",
        weeklySchedule: [
            {
                dayOfWeek: daysOfWeek[0],
                startTime: "09:00",
                endTime: "10:30",
                location: "",
                meetingType: meetingTypesForSectionSchedule[0],
            },
        ],
    });
    const [allCourses, setAllCourses] = useState<CourseForListing[]>([]);
    const [allProfessors, setAllProfessors] = useState<UserForListing[]>([]);
    const [allAssistants, setAllAssistants] = useState<UserForListing[]>([]);
    const [courseCombobox, setCourseCombobox] = useState<
        ComboboxState<CourseForListing>
    >({
        inputValue: "",
        filteredOptions: [],
        showDropdown: false,
        selectedValue: null,
    });
    const [professorCombobox, setProfessorCombobox] = useState<
        ComboboxState<UserForListing>
    >({
        inputValue: "",
        filteredOptions: [],
        showDropdown: false,
        selectedValue: null,
    });
    const [assistantCombobox, setAssistantCombobox] = useState<
        ComboboxState<UserForListing>
    >({
        inputValue: "",
        filteredOptions: [],
        showDropdown: false,
        selectedValue: null,
    });
    const [coursesForDeleteDropdown, setCoursesForDeleteDropdown] = useState<
        CourseForListing[]
    >([]);
    const [selectedCourseIdForDelete, setSelectedCourseIdForDelete] =
        useState<string>("");
    const [sectionsOfSelectedCourse, setSectionsOfSelectedCourse] = useState<
        ListedSectionInfo[]
    >([]);
    const [selectedSectionIdForDelete, setSelectedSectionIdForDelete] =
        useState<string>("");
    const [isLoadingDeleteData, setIsLoadingDeleteData] = useState(false);
    const [isDeletingSection, setIsDeletingSection] = useState(false);
    const [deleteSectionError, setDeleteSectionError] = useState<string | null>(
        null
    );
    const [deleteSectionSuccessMessage, setDeleteSectionSuccessMessage] =
        useState<string | null>(null);
    const [showDeleteSectionConfirm, setShowDeleteSectionConfirm] =
        useState(false);
    const [isDataLoading, setIsDataLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [isLoadingSectionsForDelete, setIsLoadingSectionsForDelete] =
        useState(false);

    const courseDropdownRef = useRef<HTMLDivElement>(null);
    const professorDropdownRef = useRef<HTMLDivElement>(null);
    const assistantDropdownRef = useRef<HTMLDivElement>(null);

    // --- fetchDataForPage (para cargar datos iniciales) ---
    useEffect(() => {
        async function fetchDataForPageInternal() {
            setIsDataLoading(true);
            setIsLoadingDeleteData(true);
            setError(null);
            try {
                // PASO 4: Reemplaza authenticatedFetch con authFetch en las llamadas Promise.all
                const [courseRes, professorRes, assistantRes] =
                    await Promise.all([
                        authFetch("/courses/all"), //
                        authFetch("/users/by-role?roles=admin,profesor"), //
                        authFetch("/users/by-role?roles=ayudante"), //
                    ]);

                if (!courseRes.ok)
                    throw new Error(
                        `Cargando cursos: ${courseRes.statusText} (${courseRes.status})`
                    );
                const coursesData = await courseRes.json();
                setAllCourses(coursesData);
                setCoursesForDeleteDropdown(coursesData);

                if (!professorRes.ok)
                    throw new Error(
                        `Cargando profesores: ${professorRes.statusText} (${professorRes.status})`
                    );
                setAllProfessors(await professorRes.json());

                if (!assistantRes.ok)
                    throw new Error(
                        `Cargando ayudantes: ${assistantRes.statusText} (${assistantRes.status})`
                    );
                setAllAssistants(await assistantRes.json());
            } catch (err) {
                console.error("FetchData Error in ManageSectionsPage:", err);
                // PASO 5: Ajusta el bloque catch
                if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
                    setError("Error cargando datos necesarios: " + err.message);
                }
            } finally {
                setIsDataLoading(false);
                setIsLoadingDeleteData(false);
            }
        }

        if (!user) {
            router.replace("/login"); // AuthGuard también debería manejar esto
            return;
        }
        if (!isAdmin && user) {
            setError("No tienes permiso para acceder a esta página.");
            setIsDataLoading(false);
            setIsLoadingDeleteData(false);
            return;
        }
        if (isAdmin) {
            fetchDataForPageInternal();
        }
        // PASO 6: Añade authFetch al array de dependencias
    }, [user, isAdmin, router, authFetch]); //

    // --- fetchSectionsForDeleteUI (para cargar secciones de un curso para eliminar) ---
    const fetchSectionsForDeleteUI = useCallback(
        async (courseId: string | null) => {
            if (!courseId || !isAdmin) {
                setSectionsOfSelectedCourse([]);
                setSelectedSectionIdForDelete("");
                return;
            }
            setIsLoadingSectionsForDelete(true); // Usar el loader específico
            setDeleteSectionError(null);
            try {
                // PASO 4: Reemplaza authenticatedFetch con authFetch
                // Asume que este endpoint devuelve todas y filtras, o es un endpoint específico para admin.
                // Si /users/me/courses-with-sections es solo para el usuario actual, un admin podría necesitar otro endpoint.
                // Por ahora, mantendremos el endpoint que tenías.
                const response = await authFetch(
                    "/users/me/courses-with-sections"
                ); //
                if (!response.ok)
                    throw new Error(
                        "No se pudieron cargar las secciones del curso."
                    );

                const allCoursesWithData: CourseWithSections[] =
                    await response.json();
                const foundCourse = allCoursesWithData.find(
                    (c) => c.courseID === courseId
                );

                if (foundCourse && foundCourse.sections) {
                    setSectionsOfSelectedCourse(
                        foundCourse.sections.map((s) => ({
                            sectionID: s.sectionID,
                            sectionIdentifier: s.sectionIdentifier,
                        }))
                    );
                } else {
                    setSectionsOfSelectedCourse([]);
                }
            } catch (err) {
                console.error("FetchSectionsForDelete Error:", err);
                // PASO 5: Ajusta el bloque catch
                if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
                    setDeleteSectionError(
                        "Error cargando secciones del curso: " + err.message
                    );
                }
                setSectionsOfSelectedCourse([]);
            } finally {
                setIsLoadingSectionsForDelete(false);
            }
            // PASO 6: Añade authFetch como dependencia de useCallback
        },
        [
            isAdmin,
            authFetch,
            setSectionsOfSelectedCourse,
            setSelectedSectionIdForDelete,
            setIsLoadingSectionsForDelete,
            setDeleteSectionError,
        ]
    ); //

    useEffect(() => {
        if (selectedCourseIdForDelete) {
            fetchSectionsForDeleteUI(selectedCourseIdForDelete);
        } else {
            setSectionsOfSelectedCourse([]);
        }
    }, [selectedCourseIdForDelete, fetchSectionsForDeleteUI]);

    // ... (lógica de handleClickOutside, handleComboboxChange, handleComboboxSelect, handleGenericInputChange SIN CAMBIOS) ...
    const handleClickOutside = useCallback((event: MouseEvent) => {
        if (
            courseDropdownRef.current &&
            !courseDropdownRef.current.contains(event.target as Node)
        ) {
            setCourseCombobox((prev) => ({ ...prev, showDropdown: false }));
        }
        if (
            professorDropdownRef.current &&
            !professorDropdownRef.current.contains(event.target as Node)
        ) {
            setProfessorCombobox((prev) => ({ ...prev, showDropdown: false }));
        }
        if (
            assistantDropdownRef.current &&
            !assistantDropdownRef.current.contains(event.target as Node)
        ) {
            setAssistantCombobox((prev) => ({ ...prev, showDropdown: false }));
        }
    }, []);

    useEffect(() => {
        document.addEventListener("mousedown", handleClickOutside);
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [handleClickOutside]);

    const handleComboboxChange = <
        T extends {
            courseName?: string;
            displayName?: string;
            id?: string;
            uid?: string;
        }
    >(
        value: string,
        type: "course" | "professor" | "assistant",
        allOptions: T[]
    ) => {
        const nameProperty = type === "course" ? "courseName" : "displayName";
        const commonStateUpdate = {
            inputValue: value,
            showDropdown: true,
            selectedValue: null,
        };

        if (type === "course")
            setCourseCombobox((prev: ComboboxState<CourseForListing>) => ({
                ...prev,
                ...commonStateUpdate,
            }));
        else if (type === "professor")
            setProfessorCombobox((prev: ComboboxState<UserForListing>) => ({
                ...prev,
                ...commonStateUpdate,
            }));
        else
            setAssistantCombobox((prev: ComboboxState<UserForListing>) => ({
                ...prev,
                ...commonStateUpdate,
            }));

        if (value.trim() === "") {
            const emptyFilterState = {
                filteredOptions: [],
                showDropdown: false,
            };
            if (type === "course") {
                setCourseCombobox((prev: ComboboxState<CourseForListing>) => ({
                    ...prev,
                    ...emptyFilterState,
                }));
                setFormData((prevForm) => ({
                    ...prevForm,
                    courseID: "",
                    courseName: "",
                }));
            } else if (type === "professor") {
                setProfessorCombobox((prev: ComboboxState<UserForListing>) => ({
                    ...prev,
                    ...emptyFilterState,
                }));
                setFormData((prevForm) => ({
                    ...prevForm,
                    organizerUID: "",
                    organizerName: "",
                }));
            } else {
                setAssistantCombobox((prev: ComboboxState<UserForListing>) => ({
                    ...prev,
                    ...emptyFilterState,
                }));
                setFormData((prevForm) => ({
                    ...prevForm,
                    assistantUID: "",
                    assistantName: "",
                }));
            }
            return;
        }
        const filtered = allOptions.filter((option) =>
            (option[nameProperty as keyof T] as string)
                ?.toLowerCase()
                .includes(value.toLowerCase())
        );
        if (type === "course")
            setCourseCombobox((prev: ComboboxState<CourseForListing>) => ({
                ...prev,
                filteredOptions: filtered as CourseForListing[],
            }));
        else if (type === "professor")
            setProfessorCombobox((prev: ComboboxState<UserForListing>) => ({
                ...prev,
                filteredOptions: filtered as UserForListing[],
            }));
        else
            setAssistantCombobox((prev: ComboboxState<UserForListing>) => ({
                ...prev,
                filteredOptions: filtered as UserForListing[],
            }));
    };

    const handleGenericInputChange = (
        // Puedes usar React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> si también la usas para textareas
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleComboboxSelect = <
        T extends {
            courseName?: string;
            displayName?: string;
            id?: string;
            uid?: string;
        }
    >(
        option: T,
        type: "course" | "professor" | "assistant"
    ) => {
        const idProperty = type === "course" ? "id" : "uid";
        const nameProperty = type === "course" ? "courseName" : "displayName";

        const selectedId = option[idProperty as keyof T] as string;
        const selectedName = option[nameProperty as keyof T] as string;

        if (type === "course") {
            setCourseCombobox({
                // Actualizar estado del combobox de curso
                inputValue: selectedName,
                filteredOptions: [],
                showDropdown: false,
                selectedValue: option as CourseForListing,
            });
            setFormData((prev) => ({
                // Actualizar formData para curso (singular)
                ...prev,
                courseID: selectedId,
                courseName: selectedName,
            }));
        } else if (type === "professor") {
            const professorToAdd = option as UserForListing;
            // Añadir profesor a la lista en formData si no está ya presente
            setFormData((prev) => ({
                ...prev,
                professors: prev.professors.find(
                    (p) => p.uid === professorToAdd.uid
                )
                    ? prev.professors // Ya existe, no duplicar
                    : [...prev.professors, professorToAdd], // Añadir nuevo
            }));
            // Limpiar el combobox de profesor para permitir nueva selección
            setProfessorCombobox({
                inputValue: "", // Limpiar input
                filteredOptions: [], // Limpiar opciones filtradas
                showDropdown: false, // Ocultar dropdown
                selectedValue: null, // Limpiar valor seleccionado del combobox
            });
        } else if (type === "assistant") {
            const assistantToAdd = option as UserForListing;
            // Añadir ayudante a la lista en formData si no está ya presente
            setFormData((prev) => ({
                ...prev,
                assistants: (prev.assistants || []).find(
                    (a) => a.uid === assistantToAdd.uid
                )
                    ? prev.assistants || []
                    : [...(prev.assistants || []), assistantToAdd],
            }));
            // Limpiar el combobox de ayudante
            setAssistantCombobox({
                inputValue: "",
                filteredOptions: [],
                showDropdown: false,
                selectedValue: null,
            });
        }
    };

    const handleRemoveProfessor = (uidToRemove: string) => {
        setFormData((prev) => ({
            ...prev,
            professors: prev.professors.filter((p) => p.uid !== uidToRemove),
        }));
    };

    const handleRemoveAssistant = (uidToRemove: string) => {
        setFormData((prev) => ({
            ...prev,
            assistants: (prev.assistants || []).filter(
                (a) => a.uid !== uidToRemove
            ),
        }));
    };

    // --- handleSubmit (para crear sección) ---
    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsDataLoading(true); // Podrías usar un estado como `isSubmitting` para el botón
        setError(null);
        setSuccessMessage(null);

        if (
            !formData.courseID ||
            formData.professors.length === 0 ||
            !formData.sectionIdentifier.trim() ||
            formData.weeklySchedule.length === 0
        ) {
            setError(
                "Curso, al menos un Profesor a Cargo, Identificador de Sección y al menos una reunión son obligatorios."
            );
            setIsDataLoading(false); // o tu estado de submitting
            return;
        }
        for (const item of formData.weeklySchedule) {
            if (
                !item.dayOfWeek ||
                !item.startTime ||
                !item.endTime ||
                !item.meetingType
            ) {
                // Añadido !item.meetingType
                setError(
                    "Para cada reunión, el día, tipo, hora de inicio y hora de término son obligatorios."
                );
                setIsDataLoading(false);
                return;
            }
        }
        const dataToSubmit = {
            courseID: formData.courseID,
            courseName: formData.courseName,
            // Mapear al formato que espera el backend: [{uid, displayName}, ...]
            professors: formData.professors.map((p) => ({
                uid: p.uid,
                displayName: p.displayName,
            })),
            assistants: (formData.assistants || []).map((a) => ({
                uid: a.uid,
                displayName: a.displayName,
            })), // Enviar array vacío si no hay ayudantes
            sectionIdentifier: formData.sectionIdentifier.trim(),
            weeklySchedule: formData.weeklySchedule,
        };

        try {
            // PASO 4: Reemplaza authenticatedFetch con authFetch
            const response = await authFetch("/sections", {
                //
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dataToSubmit),
            });
            if (!response.ok) {
                const errorData = await response
                    .json()
                    .catch(() => ({ detail: `Error ${response.status}` }));
                throw new Error(
                    errorData?.detail ||
                        `Error ${response.status} creando sección.`
                );
            }
            const createdSection = await response.json();
            setSuccessMessage(
                `¡Sección "${createdSection.sectionIdentifier}" para ${createdSection.courseName} (ID: ${createdSection.id}) creada exitosamente!`
            );
            // Resetear formulario
            setFormData({
                courseID: "",
                courseName: "",
                professors: [],
                assistants: [],
                sectionIdentifier: "",
                weeklySchedule: [
                    {
                        dayOfWeek: daysOfWeek[0],
                        startTime: "09:00",
                        endTime: "10:30",
                        location: "",
                        meetingType: meetingTypesForSectionSchedule[0],
                    },
                ],
            });
            setCourseCombobox({
                inputValue: "",
                filteredOptions: [],
                showDropdown: false,
                selectedValue: null,
            });
            setProfessorCombobox({
                inputValue: "",
                filteredOptions: [],
                showDropdown: false,
                selectedValue: null,
            });
            setAssistantCombobox({
                inputValue: "",
                filteredOptions: [],
                showDropdown: false,
                selectedValue: null,
            });
            // Considerar recargar la lista de secciones para eliminar si es relevante
            if (selectedCourseIdForDelete)
                fetchSectionsForDeleteUI(selectedCourseIdForDelete);
        } catch (err) {
            console.error("Error submitting section:", err);
            // PASO 5: Ajusta el bloque catch
            if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
                setError(err.message);
            }
        } finally {
            setIsDataLoading(false); // O setIsSubmitting(false)
        }
    };

    // --- confirmDeleteSection (para eliminar sección) ---
    const confirmDeleteSection = async () => {
        if (!selectedCourseIdForDelete || !selectedSectionIdForDelete) return;

        const courseIdBeforeDelete = selectedCourseIdForDelete;
        const sectionNameToDelete =
            sectionsOfSelectedCourse.find(
                (s) => s.sectionID === selectedSectionIdForDelete
            )?.sectionIdentifier || selectedSectionIdForDelete;

        setIsDeletingSection(true);
        setDeleteSectionError(null);
        setDeleteSectionSuccessMessage(null);
        try {
            // PASO 4: Reemplaza authenticatedFetch con authFetch
            const response = await authFetch(
                `/sections/${selectedSectionIdForDelete}`,
                {
                    //
                    method: "DELETE",
                }
            );

            // Para DELETE, una respuesta 204 No Content es éxito y no tiene cuerpo JSON.
            if (response.status === 204) {
                setDeleteSectionSuccessMessage(
                    `Sección "${sectionNameToDelete}" (ID: ${selectedSectionIdForDelete}) eliminada.`
                );
                setSelectedSectionIdForDelete("");
                if (courseIdBeforeDelete) {
                    // Recargar secciones para el curso actual
                    await fetchSectionsForDeleteUI(courseIdBeforeDelete);
                }
            } else if (!response.ok) {
                // Cualquier otro error que no sea 204
                const errorData = await response
                    .json()
                    .catch(() => ({ detail: `Error ${response.status}` }));
                throw new Error(
                    errorData?.detail ||
                        `Error ${response.status} al eliminar la sección.`
                );
            }
        } catch (err) {
            console.error("DeleteSection Error:", err);
            // PASO 5: Ajusta el bloque catch
            if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
                setDeleteSectionError(err.message);
            }
        } finally {
            setIsDeletingSection(false);
            setShowDeleteSectionConfirm(false);
        }
    };

    // ... (resto de las funciones como handleDeleteSectionAttempt, addWeeklyScheduleItem, removeWeeklyScheduleItem, handleScheduleChange SIN CAMBIOS en su lógica interna, solo las llamadas fetch) ...
    const handleDeleteSectionAttempt = () => {
        if (!selectedSectionIdForDelete) {
            setDeleteSectionError(
                "Por favor, selecciona una sección para eliminar."
            );
            return;
        }
        setShowDeleteSectionConfirm(true);
        setDeleteSectionError(null);
        setDeleteSectionSuccessMessage(null);
    };
    const addWeeklyScheduleItem = () => {
        if (formData.weeklySchedule.length < MAX_MEETINGS) {
            setFormData((prev) => ({
                ...prev,
                weeklySchedule: [
                    ...prev.weeklySchedule,
                    {
                        dayOfWeek: daysOfWeek[0],
                        startTime: "09:00",
                        endTime: "10:30",
                        location: "",
                        meetingType: meetingTypesForSectionSchedule[0],
                    },
                ],
            }));
        }
    };
    const removeWeeklyScheduleItem = (indexToRemove: number) => {
        if (formData.weeklySchedule.length > 1) {
            setFormData((prev) => ({
                ...prev,
                weeklySchedule: prev.weeklySchedule.filter(
                    (_, index) => index !== indexToRemove
                ),
            }));
        }
    };
    const handleScheduleChange = (
        index: number,
        field: keyof WeeklyScheduleItemData,
        value: string
    ) => {
        const updatedSchedule = formData.weeklySchedule.map((item, i) =>
            i === index ? { ...item, [field]: value } : item
        );
        setFormData((prev) => ({ ...prev, weeklySchedule: updatedSchedule }));
    };

    // --- Lógica de Renderizado ---
    if (isDataLoading && !user && !isAdmin) {
        // Ajustado para isAdmin
        return (
            <p className="text-center p-8">Verificando sesión y permisos...</p>
        );
    }
    if (!isAdmin && user) {
        // No es admin pero está logueado
        return (
            <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-lg text-center">
                <p className="text-red-600 font-semibold">
                    {error ||
                        "No tienes permiso para acceder a esta funcionalidad."}
                </p>
                <Button
                    onClick={() => router.push("/dashboard")}
                    className="mt-4">
                    Volver al Dashboard
                </Button>
            </div>
        );
    }
    if (isDataLoading && isAdmin) {
        // Es admin y está cargando datos iniciales
        return (
            <p className="text-center p-8">
                Cargando datos necesarios para el formulario...
            </p>
        );
    }
    // AuthGuard maneja !user

    return (
        // ... (JSX del componente sin cambios en su estructura) ...
        <div className="max-w-8xl mx-auto bg-gray p-6 sm:p-8">
            <Button
                onClick={() => router.push("/dashboard")}
                variant="secondary"
                className="mb-4">
                {" "}
                &larr; Volver al principio{" "}
            </Button>
            <div className="flex flex-col md:flex-row gap-8">
                {/* Tarjeta Crear Sección */}
                <section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg w-full md:w-1/2">
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-6">
                        Crear Nueva Sección
                    </h1>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Combobox Curso */}
                        <div className="relative" ref={courseDropdownRef}>
                            <label
                                htmlFor="courseInput"
                                className="block text-sm font-medium text-gray-700 mb-1">
                                Curso <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                id="courseInput"
                                autoComplete="off"
                                value={courseCombobox.inputValue}
                                onChange={(e) =>
                                    handleComboboxChange(
                                        e.target.value,
                                        "course",
                                        allCourses
                                    )
                                }
                                onFocus={() =>
                                    setCourseCombobox((prev) => ({
                                        ...prev,
                                        showDropdown: true,
                                        filteredOptions: allCourses.filter(
                                            (c) =>
                                                c.courseName
                                                    .toLowerCase()
                                                    .includes(
                                                        prev.inputValue.toLowerCase()
                                                    )
                                        ),
                                    }))
                                }
                                placeholder="Escribe para buscar un curso..."
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                            />
                            {courseCombobox.showDropdown &&
                                courseCombobox.filteredOptions.length > 0 && (
                                    <div className="absolute z-30 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                        {courseCombobox.filteredOptions.map(
                                            (option) => (
                                                <div
                                                    key={option.id}
                                                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm text-gray-700"
                                                    onClick={() =>
                                                        handleComboboxSelect(
                                                            option,
                                                            "course"
                                                        )
                                                    }>
                                                    {option.courseName} (
                                                    {option.id})
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}
                        </div>
                        {/* Combobox Profesor */}
                        <div className="relative" ref={professorDropdownRef}>
                            <label
                                htmlFor="professorInput"
                                className="block text-sm font-medium text-gray-700 mb-1">
                                Profesor a Cargo{" "}
                                <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                id="professorInput"
                                autoComplete="off"
                                value={professorCombobox.inputValue}
                                onChange={(e) =>
                                    handleComboboxChange(
                                        e.target.value,
                                        "professor",
                                        allProfessors
                                    )
                                }
                                onFocus={() =>
                                    setProfessorCombobox((prev) => ({
                                        ...prev,
                                        showDropdown: true,
                                        // Filtra opciones al enfocar, o muestra todas si el input está vacío
                                        filteredOptions:
                                            prev.inputValue.trim() === ""
                                                ? allProfessors
                                                : allProfessors.filter((p) =>
                                                      p.displayName
                                                          .toLowerCase()
                                                          .includes(
                                                              prev.inputValue.toLowerCase()
                                                          )
                                                  ),
                                    }))
                                }
                                placeholder="Buscar profesor o admin para añadir..."
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                            />
                            {/* Dropdown de Profesores */}
                            {professorCombobox.showDropdown &&
                                professorCombobox.filteredOptions.length >
                                    0 && (
                                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                        {professorCombobox.filteredOptions.map(
                                            (option) => (
                                                <div
                                                    key={option.uid}
                                                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm text-gray-700"
                                                    onClick={() =>
                                                        handleComboboxSelect(
                                                            // Esta función ahora añade a la lista y limpia el input
                                                            option,
                                                            "professor"
                                                        )
                                                    }>
                                                    {option.displayName} (
                                                    {option.email ||
                                                        "Sin email"}
                                                    )
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}
                            {/* Lista de Profesores Seleccionados */}
                            {formData.professors.length > 0 && (
                                <div className="mt-3">
                                    <p className="text-xs font-medium text-gray-500 mb-1">
                                        Profesores asignados:
                                    </p>
                                    <ul className="flex flex-wrap gap-2 p-2 border border-gray-200 rounded-md bg-gray-50">
                                        {formData.professors.map((prof) => (
                                            <li
                                                key={prof.uid}
                                                className="flex items-center bg-red-100 text-red-800 text-xs font-semibold px-2.5 py-1.5 rounded-full">
                                                <span>{prof.displayName}</span>
                                                <button
                                                    type="button" // Importante para que no envíe el formulario
                                                    onClick={() =>
                                                        handleRemoveProfessor(
                                                            prof.uid
                                                        )
                                                    }
                                                    className="ml-2 text-red-600 hover:text-red-800 focus:outline-none"
                                                    aria-label={`Quitar a ${prof.displayName}`}>
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="h-4 w-4"
                                                        fill="none"
                                                        viewBox="0 0 24 24"
                                                        stroke="currentColor"
                                                        strokeWidth="2">
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            d="M6 18L18 6M6 6l12 12"
                                                        />
                                                    </svg>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        {/* Combobox Ayudante */}
                        <div className="relative" ref={assistantDropdownRef}>
                            <label
                                htmlFor="assistantInput"
                                className="block text-sm font-medium text-gray-700 mb-1">
                                Ayudante a Cargo (Opcional)
                            </label>
                            <input
                                type="text"
                                id="assistantInput"
                                autoComplete="off"
                                value={assistantCombobox.inputValue}
                                onChange={(e) =>
                                    handleComboboxChange(
                                        e.target.value,
                                        "assistant",
                                        allAssistants
                                    )
                                }
                                onFocus={() =>
                                    setAssistantCombobox((prev) => ({
                                        ...prev,
                                        showDropdown: true,
                                        filteredOptions:
                                            prev.inputValue.trim() === ""
                                                ? allAssistants
                                                : allAssistants.filter((a) =>
                                                      a.displayName
                                                          .toLowerCase()
                                                          .includes(
                                                              prev.inputValue.toLowerCase()
                                                          )
                                                  ),
                                    }))
                                }
                                placeholder="Buscar ayudante para añadir..."
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                            />
                            {/* Dropdown de Ayudantes */}
                            {assistantCombobox.showDropdown &&
                                assistantCombobox.filteredOptions.length >
                                    0 && (
                                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                        {assistantCombobox.filteredOptions.map(
                                            (option) => (
                                                <div
                                                    key={option.uid}
                                                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm text-gray-700"
                                                    onClick={() =>
                                                        handleComboboxSelect(
                                                            // Esta función ahora añade a la lista y limpia el input
                                                            option,
                                                            "assistant"
                                                        )
                                                    }>
                                                    {option.displayName} (
                                                    {option.email ||
                                                        "Sin email"}
                                                    )
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}
                            {/* Lista de Ayudantes Seleccionados */}
                            {formData.assistants &&
                                formData.assistants.length > 0 && (
                                    <div className="mt-3">
                                        <p className="text-xs font-medium text-gray-500 mb-1">
                                            Ayudantes asignados:
                                        </p>
                                        <ul className="flex flex-wrap gap-2 p-2 border border-gray-200 rounded-md bg-gray-50">
                                            {formData.assistants.map((asst) => (
                                                <li
                                                    key={asst.uid}
                                                    className="flex items-center bg-sky-100 text-sky-800 text-xs font-semibold px-2.5 py-1.5 rounded-full">
                                                    <span>
                                                        {asst.displayName}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            handleRemoveAssistant(
                                                                asst.uid
                                                            )
                                                        }
                                                        className="ml-2 text-sky-600 hover:text-sky-800 focus:outline-none"
                                                        aria-label={`Quitar a ${asst.displayName}`}>
                                                        <svg
                                                            xmlns="http://www.w3.org/2000/svg"
                                                            className="h-4 w-4"
                                                            fill="none"
                                                            viewBox="0 0 24 24"
                                                            stroke="currentColor"
                                                            strokeWidth="2">
                                                            <path
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                d="M6 18L18 6M6 6l12 12"
                                                            />
                                                        </svg>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                        </div>

                        {/* Identificador de Sección */}
                        <div>
                            <label
                                htmlFor="sectionIdentifier"
                                className="block text-sm font-medium text-gray-700 mb-1">
                                Identificador de Sección{" "}
                                <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                name="sectionIdentifier"
                                id="sectionIdentifier"
                                value={formData.sectionIdentifier}
                                onChange={handleGenericInputChange} // Asegúrate que esta función esté definida
                                required
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                                placeholder="Ej: Sección 1, Paralelo A"
                            />
                        </div>
                        {/* Horarios Semanales */}
                        <div>
                            <div className="flex justify-between items-center mb-2 pt-2">
                                <h3 className="text-lg font-medium text-gray-700">
                                    Horarios Semanales
                                </h3>
                                <Button
                                    type="button"
                                    onClick={addWeeklyScheduleItem}
                                    disabled={
                                        formData.weeklySchedule.length >=
                                            MAX_MEETINGS || isDataLoading
                                    }
                                    variant="secondary"
                                    className="text-sm px-3 py-1">
                                    Añadir Reunión
                                </Button>
                            </div>
                            {formData.weeklySchedule.length === 0 && (
                                <p className="text-xs text-gray-500">
                                    Añade al menos una reunión semanal.
                                </p>
                            )}
                            <div className="space-y-4">
                                {formData.weeklySchedule.map((item, index) => (
                                    <div
                                        key={index}
                                        className="p-4 border border-gray-200 rounded-md space-y-3 bg-slate-50 relative">
                                        <div className="flex justify-between items-center">
                                            <h4 className="text-sm font-medium text-gray-600">
                                                Reunión Semanal {index + 1}
                                            </h4>
                                            {formData.weeklySchedule.length >
                                                1 && (
                                                <Button
                                                    type="button"
                                                    onClick={() =>
                                                        removeWeeklyScheduleItem(
                                                            index
                                                        )
                                                    }
                                                    variant="secondary"
                                                    className="text-xs !p-1 bg-red-100 text-red-600 hover:bg-red-200 absolute top-2 right-2"
                                                    title="Eliminar esta reunión">
                                                    X
                                                </Button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label
                                                    htmlFor={`dayOfWeek-${index}`}
                                                    className="block text-xs font-medium text-gray-600">
                                                    Día{" "}
                                                    <span className="text-red-500">
                                                        *
                                                    </span>
                                                </label>
                                                <select
                                                    id={`dayOfWeek-${index}`}
                                                    value={item.dayOfWeek}
                                                    onChange={(e) =>
                                                        handleScheduleChange(
                                                            index,
                                                            "dayOfWeek",
                                                            e.target.value
                                                        )
                                                    }
                                                    required
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black">
                                                    {daysOfWeek.map((day) => (
                                                        <option
                                                            key={day}
                                                            value={day}>
                                                            {day}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label
                                                    htmlFor={`meetingType-${index}`}
                                                    className="block text-xs font-medium text-gray-600">
                                                    Tipo de Reunión{" "}
                                                    <span className="text-red-500">
                                                        *
                                                    </span>
                                                </label>
                                                <select
                                                    id={`meetingType-${index}`}
                                                    value={item.meetingType}
                                                    onChange={(e) =>
                                                        handleScheduleChange(
                                                            index,
                                                            "meetingType",
                                                            e.target.value
                                                        )
                                                    }
                                                    required
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black">
                                                    {meetingTypesForSectionSchedule.map(
                                                        (type) => (
                                                            <option
                                                                key={type}
                                                                value={type}>
                                                                {type}
                                                            </option>
                                                        )
                                                    )}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label
                                                    htmlFor={`startTime-${index}`}
                                                    className="block text-xs font-medium text-gray-600">
                                                    Hora Inicio{" "}
                                                    <span className="text-red-500">
                                                        *
                                                    </span>
                                                </label>
                                                <input
                                                    type="time"
                                                    id={`startTime-${index}`}
                                                    value={item.startTime}
                                                    onChange={(e) =>
                                                        handleScheduleChange(
                                                            index,
                                                            "startTime",
                                                            e.target.value
                                                        )
                                                    }
                                                    required
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                                                />
                                            </div>
                                            <div>
                                                <label
                                                    htmlFor={`endTime-${index}`}
                                                    className="block text-xs font-medium text-gray-600">
                                                    Hora Término{" "}
                                                    <span className="text-red-500">
                                                        *
                                                    </span>
                                                </label>
                                                <input
                                                    type="time"
                                                    id={`endTime-${index}`}
                                                    value={item.endTime}
                                                    onChange={(e) =>
                                                        handleScheduleChange(
                                                            index,
                                                            "endTime",
                                                            e.target.value
                                                        )
                                                    }
                                                    required
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label
                                                htmlFor={`location-${index}`}
                                                className="block text-xs font-medium text-gray-600">
                                                Sala (Opcional)
                                            </label>
                                            <input
                                                type="text"
                                                id={`location-${index}`}
                                                value={item.location || ""}
                                                onChange={(e) =>
                                                    handleScheduleChange(
                                                        index,
                                                        "location",
                                                        e.target.value
                                                    )
                                                }
                                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                                                placeholder="Ej: Sala A101"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {error && (
                            <p className="text-sm text-red-600 bg-red-100 p-3 rounded-md">
                                {error}
                            </p>
                        )}
                        {successMessage && (
                            <p className="text-sm text-green-600 bg-green-100 p-3 rounded-md">
                                {successMessage}
                            </p>
                        )}
                        <div className="flex justify-end pt-4">
                            <Button
                                type="submit"
                                disabled={isDataLoading}
                                variant="primary">
                                {isDataLoading
                                    ? "Creando Sección..."
                                    : "Crear Sección"}
                            </Button>
                        </div>
                    </form>
                </section>
                {/* Tarjeta Eliminar Seccion */}
                <section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg w-full md:w-1/2">
                    <h2 className="text-2xl font-semibold text-gray-800 mb-6">
                        Eliminar Sección
                    </h2>
                    <div className="mb-4">
                        <label
                            htmlFor="deleteCourseSelect"
                            className="block text-sm font-medium text-gray-700 mb-1">
                            1. Selecciona un Curso
                        </label>
                        <select
                            id="deleteCourseSelect"
                            value={selectedCourseIdForDelete}
                            onChange={(e) => {
                                setSelectedCourseIdForDelete(e.target.value);
                                setSelectedSectionIdForDelete("");
                            }}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                            disabled={
                                isLoadingDeleteData ||
                                coursesForDeleteDropdown.length === 0
                            }>
                            <option value="">-- Selecciona un Curso --</option>
                            {coursesForDeleteDropdown.map((course) => (
                                <option key={course.id} value={course.id}>
                                    {course.courseName} ({course.id})
                                </option>
                            ))}
                        </select>
                    </div>
                    {selectedCourseIdForDelete && (
                        <div className="mb-6">
                            <label
                                htmlFor="deleteSectionSelect"
                                className="block text-sm font-medium text-gray-700 mb-1">
                                2. Selecciona una Sección a Eliminar{" "}
                                <span className="text-red-500">*</span>
                            </label>
                            {isLoadingSectionsForDelete && (
                                <p className="text-xs text-gray-500">
                                    Cargando secciones...
                                </p>
                            )}
                            {!isLoadingSectionsForDelete &&
                                selectedCourseIdForDelete &&
                                sectionsOfSelectedCourse.length === 0 && (
                                    <p className="text-xs text-gray-500">
                                        Este curso no tiene secciones o no se
                                        pudieron cargar.
                                    </p>
                                )}
                            {sectionsOfSelectedCourse.length > 0 &&
                                !isLoadingSectionsForDelete && (
                                    <select
                                        id="deleteSectionSelect"
                                        value={selectedSectionIdForDelete}
                                        onChange={(e) =>
                                            setSelectedSectionIdForDelete(
                                                e.target.value
                                            )
                                        }
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                                        disabled={
                                            sectionsOfSelectedCourse.length ===
                                            0
                                        }>
                                        <option value="">
                                            -- Selecciona una Sección --
                                        </option>
                                        {sectionsOfSelectedCourse.map(
                                            (section) => (
                                                <option
                                                    key={section.sectionID}
                                                    value={section.sectionID}>
                                                    {section.sectionIdentifier}
                                                </option>
                                            )
                                        )}
                                    </select>
                                )}
                        </div>
                    )}
                    <div className="flex justify-end">
                        <Button
                            onClick={handleDeleteSectionAttempt}
                            disabled={
                                !selectedSectionIdForDelete || isDeletingSection
                            }
                            variant="primary"
                            className="bg-red-600 hover:bg-red-700 text-white">
                            {isDeletingSection
                                ? "Eliminando..."
                                : "Eliminar Sección Seleccionada"}
                        </Button>
                    </div>
                    {deleteSectionError && (
                        <p className="mt-4 text-sm text-red-600 bg-red-100 p-3 rounded-md">
                            {deleteSectionError}
                        </p>
                    )}
                    {deleteSectionSuccessMessage && (
                        <p className="mt-4 text-sm text-green-600 bg-green-100 p-3 rounded-md">
                            {deleteSectionSuccessMessage}
                        </p>
                    )}
                </section>

                {/* Modal de Confirmación para Eliminar Sección */}
                {showDeleteSectionConfirm && selectedSectionIdForDelete && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
                        <div className="bg-white p-6 rounded-lg shadow-xl max-w-md mx-auto">
                            <h3 className="text-lg font-semibold text-gray-900">
                                Confirmar Eliminación de Sección
                            </h3>
                            <p className="mt-2 text-sm text-gray-600">
                                ¿Estás seguro de que quieres eliminar la sección
                                con ID:{" "}
                                <strong>{selectedSectionIdForDelete}</strong>?
                            </p>
                            <p className="mt-1 text-xs text-red-500">
                                Esta acción también eliminará todas sus
                                reuniones de clase y registros de asistencia
                                asociados. No se puede deshacer.
                            </p>
                            <div className="mt-6 flex justify-end space-x-3">
                                <Button
                                    variant="secondary"
                                    onClick={() =>
                                        setShowDeleteSectionConfirm(false)
                                    }
                                    disabled={isDeletingSection}>
                                    Cancelar
                                </Button>
                                <Button
                                    onClick={confirmDeleteSection}
                                    variant="primary"
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                    disabled={isDeletingSection}>
                                    {isDeletingSection
                                        ? "Eliminando..."
                                        : "Sí, Eliminar Sección"}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
