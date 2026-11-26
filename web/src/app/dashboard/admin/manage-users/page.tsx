"use client";

import { useState, FormEvent, useEffect, ChangeEvent, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import { useRouter } from 'next/navigation';
import { validateAndCleanRut } from '@/lib/utils';
// Asegúrate que los tipos necesarios estén importados
import { CsvUser, BatchImportResult, CourseForListing, UserForListing, SectionSummary, StudentToEnroll} from '@/types';

const AVAILABLE_ROLES = ["admin", "profesor", "ayudante", "estudiante"];
const DEFAULT_ROLE_FOR_CSV_IMPORT = ["estudiante"];

export default function ManageUsersPage() {
    const { user, authFetch, isLoading: authIsLoading } = useAuth();
    const router = useRouter();

    // Estados para el formulario manual
    const [manualEmail, setManualEmail] = useState("");
    const [manualNombres, setManualNombres] = useState("");
    const [manualApellidos, setManualApellidos] = useState("");
    const [manualRut, setManualRut] = useState("");
    const [manualRutError, setManualRutError] = useState<string | null>(null);
    const [manualSelectedRoles, setManualSelectedRoles] = useState<string[]>([]);
    const [isSubmittingManual, setIsSubmittingManual] = useState(false);
    const [manualMessage, setManualMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Estados para la importación CSV
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [isImportingCsv, setIsImportingCsv] = useState(false);
    const [csvImportMessage, setCsvImportMessage] = useState<string | null>(null);
    const [csvImportResults, setCsvImportResults] = useState<BatchImportResult[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- ESTADOS PARA INSCRIPCIÓN DE ESTUDIANTES A SECCIÓN ---
    const [allCoursesForEnroll, setAllCoursesForEnroll] = useState<CourseForListing[]>([]);
    const [selectedCourseIdEnroll, setSelectedCourseIdEnroll] = useState<string>("");
    const [sectionsForEnroll, setSectionsForEnroll] = useState<SectionSummary[]>([]);
    const [selectedSectionIdEnroll, setSelectedSectionIdEnroll] = useState<string>("");
    
    const [studentEmailsInput, setStudentEmailsInput] = useState<string>(""); // Para el textarea de correos
    const [isProcessingEmails, setIsProcessingEmails] = useState<boolean>(false);
    const [emailProcessingFeedback, setEmailProcessingFeedback] = useState<Array<{email: string; status: 'added' | 'error' | 'already_in_list' | 'not_student'; message: string}>>([]);
    const [studentsToEnrollList, setStudentsToEnrollList] = useState<StudentToEnroll[]>([]);
    
    const [isLoadingEnrollData, setIsLoadingEnrollData] = useState(false);
    const [isEnrollingStudents, setIsEnrollingStudents] = useState(false);
    const [enrollmentMessage, setEnrollmentMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    // --- FIN ESTADOS INSCRIPCIÓN ---

    const isAdmin = user?.roles?.includes("admin") ?? false;

    useEffect(() => {
        if (!authIsLoading) {
            if (!user) {
                router.replace("/login");
            } else if (!isAdmin) {
                router.replace("/dashboard");
            }
        }
    }, [user, isAdmin, authIsLoading, router]);

    // --- Funciones para Creación Manual e Importación CSV (sin cambios significativos, solo asegúrate que los nombres de estado coincidan) ---
    const handleManualRoleChange = (role: string) => {
        setManualSelectedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
    };
    const handleManualRutChange = (e: ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value;
        setManualRut(rawValue);
        if (rawValue.trim() === "") { setManualRutError(null); return; }
        const validation = validateAndCleanRut(rawValue); //
        if (!validation.isValid && validation.error !== 'RUT demasiado corto para validar.') {
            setManualRutError(validation.error || "RUT inválido");
        } else {
            setManualRutError(null);
        }
    };

    const handleManualSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setManualMessage(null); setManualRutError(null);
        if (!manualEmail.toLowerCase().endsWith("@mail.udp.cl")) { 
            setManualMessage({ type: 'error', text: 'El correo debe terminar en @mail.udp.cl.' });
            return;
        }
        if (!manualNombres.trim() || !manualApellidos.trim() || !manualRut.trim() || manualSelectedRoles.length === 0) { 
             setManualMessage({ type: 'error', text: 'Email, Nombres, Apellidos, RUT y Roles son obligatorios.' });
            return; 
        }
        const rutValidationResult = validateAndCleanRut(manualRut); //
        if (!rutValidationResult.isValid || !rutValidationResult.cleanedRut) { 
            setManualRutError(rutValidationResult.error || "RUT inválido."); 
            return; 
        }
        
        setIsSubmittingManual(true);
        try {
            const response = await authFetch("/admin/users", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    email: manualEmail, nombres: manualNombres, apellidos: manualApellidos,
                    rut: rutValidationResult.cleanedRut, roles: manualSelectedRoles 
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || `Error ${response.status}`);
            setManualMessage({ type: 'success', text: result.message || "Usuario procesado." });
            setManualEmail(""); setManualNombres(""); setManualApellidos(""); setManualRut(""); setManualRutError(null); setManualSelectedRoles([]);
        } catch (err) {
            if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
                setManualMessage({ type: 'error', text: err.message || "Error." });
            }
        } finally { setIsSubmittingManual(false); }
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            setCsvFile(event.target.files[0]);
            setCsvImportMessage(null);
            setCsvImportResults([]);
        }
    };

    const parseCSV = (file: File): Promise<CsvUser[]> => { //
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const csvText = event.target?.result as string;
                    const lines = csvText.split(/\r\n|\n/).filter(line => line.trim() !== ''); 
                    if (lines.length < 2) { 
                        reject(new Error("El archivo CSV está vacío o no tiene datos."));
                        return;
                    }
                    
                    const header = lines[0].split(';').map(h => h.trim().toUpperCase());
                    const expectedHeader = ["APELLIDOS", "NOMBRES", "RUT", "CORREO"];
                    if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) {
                        reject(new Error(`Encabezado CSV incorrecto. Se esperaba: ${expectedHeader.join(';')} pero se obtuvo: ${header.join(';')}`));
                        return;
                    }

                    const users: CsvUser[] = [];
                    for (let i = 1; i < lines.length; i++) {
                        const values = lines[i].split(';');
                        if (values.length === header.length) {
                            users.push({
                                apellidos: values[0].trim(),
                                nombres: values[1].trim(),
                                rut: values[2].trim(),
                                correo: values[3].trim().toLowerCase(),
                            });
                        } else {
                            console.warn(`Línea ${i + 1} ignorada por número incorrecto de columnas: ${lines[i]}`);
                        }
                    }
                    resolve(users);
                } catch {
                    reject(new Error("Error al parsear el archivo CSV."));
                }
            };
            reader.onerror = () => reject(new Error("Error al leer el archivo."));
            reader.readAsText(file, 'ISO-8859-1');
        });
    };

    const handleCsvImport = async () => { //
        if (!csvFile) {
            setCsvImportMessage("Por favor, selecciona un archivo CSV primero.");
            return;
        }
        setIsImportingCsv(true);
        setCsvImportMessage("Procesando archivo CSV...");
        setCsvImportResults([]);

        try {
            const parsedUsers = await parseCSV(csvFile);
            if (parsedUsers.length === 0) {
                setCsvImportMessage("No se encontraron usuarios válidos en el archivo CSV.");
                setIsImportingCsv(false);
                return;
            }

            const usersToImport = parsedUsers.map(user => {
                const rutValidation = validateAndCleanRut(user.rut); //
                return {
                    ...user,
                    rut: rutValidation.isValid ? rutValidation.cleanedRut : user.rut, 
                    roles: DEFAULT_ROLE_FOR_CSV_IMPORT,
                };
            });
            
            setCsvImportMessage(`Enviando ${usersToImport.length} usuarios al backend...`);

            const response = await authFetch("/admin/users/batch-import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(usersToImport),
            });

            const results: BatchImportResult[] = await response.json(); 

            if (!response.ok) {
                const errorMsg = results[0]?.message || `Error ${response.status} del servidor.`;
                throw new Error(errorMsg);
            }
            
            setCsvImportResults(results);
            const successes = results.filter(r => r.status === 'success').length;
            const errors = results.filter(r => r.status === 'error').length;
            const skipped = results.filter(r => r.status === 'skipped').length;
            setCsvImportMessage(`Importación completada. Éxitos: ${successes}, Errores: ${errors}, Omitidos: ${skipped}. Ver detalles abajo.`);

        } catch (err) {
            console.error("Error durante la importación CSV:", err);
            setCsvImportMessage(`Error: ${(err instanceof Error ? err.message : "Ocurrió un error desconocido.")}`);
            // Si err tiene response y response.json, intenta parsear el error
            if (typeof err === "object" && err !== null && "response" in err) {
                const errorObj = err as { response?: Response };
                if (errorObj.response && typeof errorObj.response.json === "function") {
                    try {
                        const errorData = await errorObj.response.json();
                        if (errorData && Array.isArray(errorData)) {
                            setCsvImportResults(errorData);
                        }
                    } catch (jsonError) {
                        console.error("Error parseando JSON de error de importación:", jsonError);
                    }
                }
            }
        } finally {
            setIsImportingCsv(false);
            if (fileInputRef.current) fileInputRef.current.value = ""; 
            setCsvFile(null);
        }
    };
    // --- FIN Funciones Creación Manual e Importación CSV ---


    // --- LÓGICA PARA INSCRIPCIÓN DE ESTUDIANTES (NUEVA IMPLEMENTACIÓN) ---
    useEffect(() => { 
        if (isAdmin) {
            const fetchCourses = async () => {
                setIsLoadingEnrollData(true);
                try {
                    const response = await authFetch("/courses/all");
                    if (!response.ok) throw new Error("No se pudieron cargar los cursos.");
                    const data: CourseForListing[] = await response.json();
                    setAllCoursesForEnroll(data);
                } catch (error) {
                    if (error instanceof Error) {
                        setEnrollmentMessage({ type: 'error', text: `Error cargando cursos: ${error.message}` });
                    } else {
                        setEnrollmentMessage({ type: 'error', text: 'Error cargando cursos.' });
                    }
                } finally {
                    setIsLoadingEnrollData(false);
                }
            };
            fetchCourses();
        }
    }, [isAdmin, authFetch]);


    useEffect(() => { 
        if (selectedCourseIdEnroll && isAdmin) {
            const fetchSections = async () => {
                setIsLoadingEnrollData(true);
                setSectionsForEnroll([]); 
                setSelectedSectionIdEnroll(""); 
                try {
                    const response = await authFetch(`/users/me/courses-with-sections`); 
                    if (!response.ok) {
                        console.error("Error fetching courses with sections:", response.status, await response.text());
                        throw new Error("No se pudieron cargar las secciones.");
                    }
                    
                    // Ajusta el tipo aquí para que coincida con la respuesta real del backend (CourseWithSections)
                    const allCoursesWithData: Array<{ 
                        courseID: string; 
                        courseName: string; 
                        sections: SectionSummary[]; 
                        // añade otras propiedades que esperas de CourseWithSections si las usas
                    }> = await response.json(); 
                    
                    console.log("Datos de cursos con secciones RECIBIDOS:", allCoursesWithData);

                    // CAMBIO AQUÍ: usa courseID para el find
                    const currentCourseData = allCoursesWithData.find(c => c.courseID === selectedCourseIdEnroll);
                    
                    console.log(`Buscando curso con ID: ${selectedCourseIdEnroll}`);
                    console.log("Curso específico ENCONTRADO (currentCourseData):", currentCourseData);

                    if (currentCourseData && currentCourseData.sections) {
                         console.log("Secciones del curso encontrado:", currentCourseData.sections);
                         // El mapeo parece correcto, asumiendo que SectionSummary tiene sectionID, sectionIdentifier
                         // y que currentCourseData.courseName existe.
                         setSectionsForEnroll(currentCourseData.sections.map((s) => ({
                            sectionID: s.sectionID,
                            sectionIdentifier: s.sectionIdentifier,
                            courseName: currentCourseData.courseName // Usar el courseName del objeto curso padre
                        } as SectionSummary)));
                    } else {
                        console.warn(`No se encontró el curso con ID ${selectedCourseIdEnroll} en los datos recibidos, o no tiene secciones.`);
                        setSectionsForEnroll([]);
                    }
                } catch (error) { // ... (tu manejo de errores)
                    if (error instanceof Error) {
                        console.error("Error en fetchSections:", error.message);
                        setEnrollmentMessage({ type: 'error', text: `Error cargando secciones: ${error.message}` });
                    } else {
                        console.error("Error desconocido en fetchSections:", error);
                        setEnrollmentMessage({ type: 'error', text: 'Error cargando secciones.' });
                    }
                } finally {
                    setIsLoadingEnrollData(false);
                }
            };
            fetchSections();
        } else {
            setSectionsForEnroll([]);
            setSelectedSectionIdEnroll("");
        }
    }, [selectedCourseIdEnroll, isAdmin, authFetch]); // authFetch también debería ser dependencia

    const handleProcessStudentEmails = async () => {
        if (!studentEmailsInput.trim()) {
            setEmailProcessingFeedback([{email: "", status: 'error', message: "El campo de correos está vacío."}]);
            return;
        }

        const emails = studentEmailsInput.split('\n')
            .map(email => email.trim().toLowerCase())
            .filter(email => email.length > 0 && email.includes('@')); 

        if (emails.length === 0) {
            setEmailProcessingFeedback([{email: "", status: 'error', message: "No se encontraron correos válidos para procesar."}]);
            return;
        }
        
        setIsProcessingEmails(true);
        setEmailProcessingFeedback([]);
        const currentFeedback: Array<{email: string; status: 'added' | 'error' | 'already_in_list' | 'not_student'; message: string}> = [];
        const newStudentsForList: StudentToEnroll[] = [];

        for (const email of emails) {
            if (!email.endsWith("@mail.udp.cl")) { 
                currentFeedback.push({ email, status: 'error', message: "Correo no pertenece a @mail.udp.cl." });
                continue;
            }

            if (studentsToEnrollList.find(s => s.email?.toLowerCase() === email) || newStudentsForList.find(s => s.email?.toLowerCase() === email)) {
                currentFeedback.push({ email, status: 'already_in_list', message: "Ya está en la lista o ha sido añadido en esta tanda." });
                continue;
            }

            try {
                const response = await authFetch(`/admin/users/by-email?email=${encodeURIComponent(email)}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ detail: "Usuario no encontrado." }));
                    throw new Error(errorData.detail || `Usuario no encontrado (Status: ${response.status})`);
                }
                const studentData: UserForListing = await response.json();

                if (!studentData.roles || !studentData.roles.includes("estudiante")) {
                    currentFeedback.push({ email, status: 'not_student', message: "Usuario encontrado pero no es estudiante." });
                    continue;
                }
                
                newStudentsForList.push(studentData);
                currentFeedback.push({ email, status: 'added', message: `Listo para añadir: ${studentData.displayName}` });
                
            } catch (error) {
                if (error instanceof Error) {
                    currentFeedback.push({ email, status: 'error', message: error.message });
                } else {
                    currentFeedback.push({ email, status: 'error', message: 'Error desconocido.' });
                }
            }
        }
        
        setStudentsToEnrollList(prev => {
            const combined = [...prev];
            newStudentsForList.forEach(newStudent => {
                if (!combined.find(existing => existing.uid === newStudent.uid)) {
                    combined.push(newStudent);
                }
            });
            return combined;
        });
        setEmailProcessingFeedback(currentFeedback);
        setIsProcessingEmails(false);
        setStudentEmailsInput(""); 
    };

    const handleRemoveStudentFromEnrollList = (uidToRemove: string) => {
        setStudentsToEnrollList(prev => prev.filter(s => s.uid !== uidToRemove));
    };

    const handleSubmitEnrollStudents = async () => {
        if (!selectedSectionIdEnroll || studentsToEnrollList.length === 0) {
            setEnrollmentMessage({ type: 'error', text: "Selecciona una sección y añade estudiantes validados a la lista." });
            return;
        }
        setIsEnrollingStudents(true);
        setEnrollmentMessage(null);
        setEmailProcessingFeedback([]); 
        try {
            const studentUids = studentsToEnrollList.map(s => s.uid);
            const response = await authFetch(`/sections/${selectedSectionIdEnroll}/enroll-students`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ student_uids: studentUids }),
            });
            const result = await response.json() as {
                results?: Array<{ status: string; message?: string }>;
                summary?: { enrolled?: number; already_enrolled?: number; user_not_found?: number; not_a_student?: number; failed?: number };
                detail?: string;
            };
            
            if (!response.ok) {
                const errorDetail = result.detail || (result.results && result.results[0]?.message) || "Error al inscribir.";
                throw new Error(errorDetail);
            }
            
            let successCount = 0;
            let alreadyEnrolledCount = 0;
            let errorCount = 0;

            if (result.results && Array.isArray(result.results)) {
                 result.results.forEach((item: { status: string }) => {
                    if (item.status === 'enrolled' || item.status === 'success') successCount++;
                    else if (item.status === 'already_enrolled') alreadyEnrolledCount++;
                    else errorCount++;
                });
            } else if (result.summary) { 
                successCount = result.summary.enrolled || 0;
                alreadyEnrolledCount = result.summary.already_enrolled || 0;
                errorCount = (result.summary.user_not_found || 0) + (result.summary.not_a_student || 0) + (result.summary.failed || 0);
            }

            setEnrollmentMessage({ type: 'success', text: `Inscripción finalizada. Éxitos: ${successCount}. Ya estaban: ${alreadyEnrolledCount}. Errores: ${errorCount}.` });
            setStudentsToEnrollList([]);
            
        } catch (error) {
            if (error instanceof Error) {
                setEnrollmentMessage({ type: 'error', text: `Error en inscripción final: ${error.message}` });
            } else {
                setEnrollmentMessage({ type: 'error', text: 'Error desconocido en inscripción final.' });
            }
        } finally {
            setIsEnrollingStudents(false);
        }
    };

    if (authIsLoading || (!isAdmin && user && !authIsLoading) || (!user && !authIsLoading) ) {
        return <div className="flex items-center justify-center min-h-[calc(100vh-150px)]">Verificando permisos y cargando...</div>;
    }
    if (!isAdmin && user) {
        return (
            <div className="max-w-2xl mx-auto p-6 sm:p-8 text-center">
                <p className="text-red-600 font-semibold text-xl mb-4">Acceso Denegado</p>
                <p className="text-gray-700 mb-6">No tienes los permisos necesarios para acceder a esta página.</p>
                <Button onClick={() => router.push('/dashboard')} variant="primary">
                   Volver al Panel
                </Button>
           </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-4 sm:p-6"> {/* Contenedor principal más estrecho */}
            <Button onClick={() => router.push('/dashboard')} variant="secondary" className="mb-6 inline-flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                </svg>
                Volver al Panel
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-8 text-center">Gestionar Usuarios</h1>

            {/* Las secciones ahora estarán una debajo de la otra */}
            <div className="space-y-10"> {/* Espacio entre secciones */}
                {/* Sección de Importación CSV */}
                <section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg">
                <h2 className="text-xl font-semibold text-gray-700 mb-4">Importar Usuarios desde CSV</h2>
                <p className="text-sm text-gray-600 mb-1">
                    El archivo CSV debe tener las siguientes columnas (delimitadas por punto y coma &#39;;&#39;):
                </p>
                <p className="text-xs text-gray-500 mb-4 font-mono">APELLIDOS;NOMBRES;RUT;CORREO</p>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="csvFile" className="block text-sm font-medium text-gray-700 mb-1">
                            Seleccionar Archivo CSV
                        </label>
                        <input
                            type="file"
                            id="csvFile"
                            ref={fileInputRef}
                            accept=".csv"
                            onChange={handleFileChange}
                            className="mt-1 block w-full text-sm text-gray-500
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-md file:border-0
                                file:text-sm file:font-semibold
                                file:bg-red-50 file:text-red-700
                                hover:file:bg-red-100"
                        />
                    </div>
                    <Button
                        onClick={handleCsvImport}
                        disabled={isImportingCsv || !csvFile}
                        variant="primary"
                        className="w-full sm:w-auto"
                    >
                        {isImportingCsv ? "Importando..." : "Importar Usuarios del CSV"}
                    </Button>
                    {csvImportMessage && (
                        <p className={`text-sm mt-3 p-3 rounded-md ${csvImportResults.some(r => r.status === 'error') ? 'bg-red-100 text-red-700' : (csvImportResults.length > 0 ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}`}>
                            {csvImportMessage}
                        </p>
                    )}
                    {csvImportResults.length > 0 && (
                        <div className="mt-4 max-h-60 overflow-y-auto border border-gray-200 rounded-md p-2">
                            <h3 className="text-md font-semibold mb-2">Detalles de la Importación:</h3>
                            {csvImportResults.map((result, index) => (
                                <div key={index} className={`p-2 mb-1 rounded text-xs ${result.status === 'success' ? 'bg-green-50 text-green-800' :
                                        result.status === 'error' ? 'bg-red-50 text-red-800' :
                                            'bg-yellow-50 text-yellow-800'
                                    }`}>
                                    <span className="font-bold">{result.email || result.originalData?.correo || "N/A"}:</span> {result.message}
                                    {result.status === 'error' && result.originalData && <span className="block text-xxs">Datos originales: {result.originalData.nombres} {result.originalData.apellidos}, RUT: {result.originalData.rut}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                </section>

                <hr className="my-8 border-gray-300"/>

                {/* Sección de Creación Manual */}
                <section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg">
                 <h2 className="text-xl font-semibold text-gray-700 mb-6">Crear/Actualizar Usuario Manualmente</h2>
                 <form onSubmit={handleManualSubmit} className="space-y-6">
                     {/* ... (Tu formulario manual existente para email, nombres, apellidos, rut, roles) ... */}
                     <div>
                         <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                             Correo Electrónico Institucional <span className="text-gray-500 text-xs">(@mail.udp.cl)</span>
                         </label>
                         <input
                             type="email" id="email" name="email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} required
                             className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                             placeholder="usuario@example.invalid"
                         />
                     </div>
                     {/* Nombres */}
                     <div>
                         <label htmlFor="nombres" className="block text-sm font-medium text-gray-700 mb-1">Nombres <span className="text-red-500">*</span></label>
                         <input type="text" id="nombres" name="nombres" value={manualNombres} onChange={(e) => setManualNombres(e.target.value)} required
                             className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                             placeholder="Nombres"
                         />
                     </div>
                     {/* Apellidos */}
                     <div>
                         <label htmlFor="apellidos" className="block text-sm font-medium text-gray-700 mb-1">Apellidos <span className="text-red-500">*</span></label>
                         <input type="text" id="apellidos" name="apellidos" value={manualApellidos} onChange={(e) => setManualApellidos(e.target.value)} required
                             className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                             placeholder="Apellidos"
                         />
                     </div>
                     {/* RUT */}
                     <div>
                         <label htmlFor="rut" className="block text-sm font-medium text-gray-700 mb-1">RUT <span className="text-red-500">*</span></label>
                         <input type="text" id="rut" name="rut" value={manualRut} onChange={handleManualRutChange}
                             className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none sm:text-sm text-black ${manualRutError ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-red-500 focus:border-red-500'}`}
                             placeholder="Formato: NNNNNNNN-D"
                         />
                         {manualRutError && <p className="mt-2 text-xs text-red-600">{manualRutError}</p>}
                     </div>
                     {/* Roles */}
                     <div>
                         <label className="block text-sm font-medium text-gray-700 mb-1">Roles <span className="text-red-500">*</span></label>
                         <div className="mt-2 space-y-2 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-2">
                             {AVAILABLE_ROLES.map(role => (
                                 <div key={role} className="flex items-center">
                                     <input id={`role-${role}`} name="roles" type="checkbox" value={role} checked={manualSelectedRoles.includes(role)} onChange={() => handleManualRoleChange(role)}
                                         className="h-4 w-4 text-red-600 border-gray-300 rounded focus:ring-red-500" />
                                     <label htmlFor={`role-${role}`} className="ml-2 block text-sm text-gray-900 capitalize">{role.charAt(0).toUpperCase() + role.slice(1)}</label>
                                 </div>
                             ))}
                         </div>
                     </div>
 
                     {manualMessage && (
                         <p className={`text-sm p-3 rounded-md ${manualMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                             {manualMessage.text}
                         </p>
                     )}
                     <div className="flex justify-end pt-2">
                         <Button type="submit" disabled={isSubmittingManual} variant="primary" className="px-6 py-2.5">
                             {isSubmittingManual ? "Procesando..." : "Guardar Usuario"}
                         </Button>
                     </div>
                 </form>
                </section>

                <hr className="my-8 border-gray-300"/>

                {/* SECCIÓN: Inscribir Estudiantes a Sección con Textarea */}
                <section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg">
                    <h2 className="text-xl font-semibold text-gray-700 mb-6">Inscribir Estudiantes a Sección (por Correo)</h2>
                    <div className="space-y-4">
                        {/* Selectores de Curso y Sección */}
                        <div>
                            <label htmlFor="enrollCourseSelect" className="block text-sm font-medium text-gray-700 mb-1">1. Selecciona un Curso</label>
                            <select
                                id="enrollCourseSelect"
                                value={selectedCourseIdEnroll}
                                onChange={(e) => { setSelectedCourseIdEnroll(e.target.value); setSelectedSectionIdEnroll(''); setStudentsToEnrollList([]); setEnrollmentMessage(null); setEmailProcessingFeedback([]); }}
                                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm rounded-md text-black"
                                disabled={isLoadingEnrollData || allCoursesForEnroll.length === 0}
                            >
                                <option value="">-- Selecciona un Curso --</option>
                                {allCoursesForEnroll.map(course => (
                                    <option key={course.id} value={course.id}>{course.courseName}</option>
                                ))}
                            </select>
                        </div>

                        {selectedCourseIdEnroll && (
                            <div>
                                <label htmlFor="enrollSectionSelect" className="block text-sm font-medium text-gray-700 mb-1">2. Selecciona una Sección</label>
                                <select
                                    id="enrollSectionSelect"
                                    value={selectedSectionIdEnroll}
                                    onChange={(e) => { setSelectedSectionIdEnroll(e.target.value); setStudentsToEnrollList([]); setEnrollmentMessage(null); setEmailProcessingFeedback([]); }}
                                    disabled={isLoadingEnrollData || sectionsForEnroll.length === 0}
                                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm rounded-md text-black"
                                >
                                    <option value="">-- Selecciona una Sección --</option>
                                    {sectionsForEnroll.map(section => (
                                        <option key={section.sectionID} value={section.sectionID}>{section.sectionIdentifier} ({section.courseName})</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Textarea para ingresar correos */}
                        {selectedSectionIdEnroll && (
                        <>
                            <div className="mt-4">
                                <label htmlFor="studentEmailsInput" className="block text-sm font-medium text-gray-700 mb-1">
                                    3. Ingresa Correos de Estudiantes (uno por línea)
                                </label>
                                <textarea
                                    id="studentEmailsInput"
                                    rows={6}
                                    value={studentEmailsInput}
                                    onChange={(e) => setStudentEmailsInput(e.target.value)}
                                    placeholder="usuario1@example.invalid&#10;usuario2@example.invalid"
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
                                    disabled={isProcessingEmails || !selectedSectionIdEnroll}
                                />
                            </div>
                            <Button
                                onClick={handleProcessStudentEmails}
                                disabled={isProcessingEmails || !studentEmailsInput.trim() || !selectedSectionIdEnroll}
                                variant="secondary"
                                className="w-full sm:w-auto"
                            >
                                {isProcessingEmails ? "Validando Correos..." : "Validar y Añadir Correos a Lista de Inscripción"}
                            </Button>

                            {/* Feedback del procesamiento de correos */}
                            {emailProcessingFeedback.length > 0 && (
                                <div className="mt-3 p-3 border rounded-md bg-gray-50 text-xs max-h-40 overflow-y-auto space-y-1">
                                    <h4 className="text-sm font-semibold mb-1">Resultado de Validación de Correos:</h4>
                                    {emailProcessingFeedback.map((fb, index) => (
                                        <p key={index} className={`
                                            ${fb.status === 'added' ? 'text-green-700' : ''}
                                            ${fb.status === 'error' ? 'text-red-700' : ''}
                                            ${fb.status === 'not_student' ? 'text-yellow-700 font-semibold' : ''}
                                            ${fb.status === 'already_in_list' ? 'text-blue-700' : ''}
                                        `}>
                                            <strong>{fb.email || "Entrada"}:</strong> {fb.message}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </>
                        )}

                        {/* Lista de estudiantes validados para inscribir */}
                        {studentsToEnrollList.length > 0 && (
                            <div className="mt-6 pt-4 border-t border-gray-200">
                                <h3 className="text-md font-semibold text-gray-700 mb-2">
                                    Estudiantes por Inscribir ({studentsToEnrollList.length}):
                                </h3>
                                <ul className="space-y-2 max-h-72 overflow-y-auto bg-gray-50 p-3 rounded-md border">
                                    {studentsToEnrollList.map(student => (
                                        <li key={student.uid} className="flex items-center justify-between p-2.5 bg-white border rounded-md shadow-sm text-sm hover:bg-gray-50">
                                            <div>
                                                <span className="font-medium text-gray-900">{student.displayName}</span>
                                                <span className="block text-xs text-gray-600">{student.email}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveStudentFromEnrollList(student.uid)}
                                                className="p-1.5 text-red-500 hover:text-red-700 rounded-full hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-opacity-50"
                                                aria-label={`Quitar a ${student.displayName}`}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        
                        {enrollmentMessage && (
                            <p className={`text-sm p-3 rounded-md mt-4 ${enrollmentMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {enrollmentMessage.text}
                            </p>
                        )}

                        <div className="flex justify-end pt-4 mt-4 border-t border-gray-200">
                            <Button 
                                onClick={handleSubmitEnrollStudents}
                                disabled={isEnrollingStudents || !selectedSectionIdEnroll || studentsToEnrollList.length === 0}
                                variant="primary"
                                className="min-w-[180px]" // Para que el texto no haga saltar el botón
                            >
                                {isEnrollingStudents ? "Inscribiendo..." : `Inscribir ${studentsToEnrollList.length} Estudiante(s)`}
                            </Button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}