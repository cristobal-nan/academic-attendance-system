"use client";

import { useState, FormEvent, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext"; //
import Button from "@/components/Button"; //
import { CourseFormData, CourseForListing } from "@/types"; //

// Interfaz para los datos del formulario

export default function ManageCoursesPage() {
	const router = useRouter();
	// PASO 3: Obtén authFetch del contexto
	const { user, authFetch } = useAuth(); //

	const [createFormData, setCreateFormData] = useState<CourseFormData>({
		courseCode: "",
		courseName: "",
		description: "",
	});
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [createSuccessMessage, setCreateSuccessMessage] = useState<string | null>(null);

	const [coursesForDeletion, setCoursesForDeletion] = useState<CourseForListing[]>([]);
	const [isLoadingCourses, setIsLoadingCourses] = useState(false);
	const [selectedCourseToDelete, setSelectedCourseToDelete] = useState<CourseForListing | null>(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleteSuccessMessage, setDeleteSuccessMessage] = useState<string | null>(null);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [courseIdToDeleteDirect, setCourseIdToDeleteDirect] = useState("");

	const isAdmin = user?.roles?.includes("admin");

	const handleCreateChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
	) => {
		const { name, value } = e.target;
		setCreateFormData((prev) => ({ ...prev, [name]: value }));
	};

	const handleCreateSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setIsCreating(true);
		setCreateError(null);
		setCreateSuccessMessage(null);

		if (!createFormData.courseCode.trim() || !createFormData.courseName.trim()) {
			setCreateError("El código y el nombre del curso son obligatorios.");
			setIsCreating(false);
			return;
		}
		try {
			// PASO 4: Reemplaza authenticatedFetch con authFetch
			const response = await authFetch("/courses", { //
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					courseCode: createFormData.courseCode.trim(),
					courseName: createFormData.courseName.trim(),
					description: createFormData.description.trim() || null,
				}),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				if (response.status === 409 && errorData?.detail) {
					throw new Error(errorData.detail); // Lanzar para que el catch lo maneje
				} else if (errorData?.detail) {
					throw new Error(`${errorData.detail} (Status: ${response.status})`);
				}
				throw new Error(`Error al crear el curso. Código: ${response.status} - ${response.statusText}`);
			}

			const createdCourse = await response.json();
			setCreateSuccessMessage(
				`¡Curso "${createdCourse.courseName}" (ID: ${createdCourse.id}) creado exitosamente!`
			);
			setCreateFormData({ courseCode: "", courseName: "", description: "" });
			fetchAllCoursesForDeletionListInternal(); // Refrescar lista de cursos para eliminar
			// setTimeout(() => { // Redirección opcional
			// 	router.push("/dashboard");
			// }, 2000);
		} catch (err: unknown) { // o catch (err: Error) si estás seguro que es un Error
			console.error("Error creating course:", err);
			if (err instanceof Error) { // Verificación de tipo si usas unknown
				setCreateError(err.message || "Ocurrió un error inesperado al crear el curso.");
			} else {
				setCreateError("Ocurrió un error inesperado al crear el curso.");
			}
		}
	};

	// Renombrada para evitar conflicto de nombres si se define fuera del useEffect
	const fetchAllCoursesForDeletionListInternal = useCallback(async () => {
		if (!user || !isAdmin) {
			setCoursesForDeletion([]);
			setIsLoadingCourses(false);
			return;
		}
		setIsLoadingCourses(true);
		setDeleteError(null);
		try {
			// PASO 4: Reemplaza authenticatedFetch con authFetch
			const response = await authFetch("/courses/all"); //

			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				throw new Error(errorData?.detail || "No se pudieron cargar los cursos.");
			}
			const data: CourseForListing[] = await response.json();
			setCoursesForDeletion(data);
		} catch (err) {
			console.error("Error loading courses for admin:", err);
			// PASO 5: Ajusta el bloque catch
			if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
				setDeleteError("Error al cargar la lista de cursos: " + err.message);
			}
		} finally {
			setIsLoadingCourses(false);
		}
	}, [user, isAdmin, authFetch]); // <-- dependencias

	useEffect(() => {
		if (user && isAdmin) {
			fetchAllCoursesForDeletionListInternal();
		} else if (!isAdmin && user) {
			setDeleteError("No tienes permiso para ver la lista de todos los cursos.");
		} else {
			setCoursesForDeletion([]);
		}
		// PASO 6: Añade authFetch (o la función que lo usa, como fetchAllCoursesForDeletionListInternal)
		// a las dependencias si es necesario. Aquí fetchAllCoursesForDeletionListInternal no está en useCallback
		// pero depende de `authFetch` indirectamente.
		// Para ser estrictos, fetchAllCoursesForDeletionListInternal debería ser un useCallback o
		// authFetch debería ser una dependencia del useEffect.
	}, [user, isAdmin, authFetch, fetchAllCoursesForDeletionListInternal]); // <-- ahora sí está incluida

	const handleDeleteAttempt = (
		course: CourseForListing | null,
		directId?: string
	) => {
		const courseToDelete = directId
			? coursesForDeletion.find((c) => c.id === directId) || {
				id: directId, courseName: "ID: " + directId,
			}
			: course;
		if (courseToDelete) {
			setSelectedCourseToDelete(courseToDelete);
			setShowDeleteConfirm(true);
			setDeleteError(null);
			setDeleteSuccessMessage(null);
		} else if (directId) {
			setDeleteError(`No se encontró un curso con ID "${directId}" en la lista cargada.`);
		}
	};

	const confirmDeleteCourse = async () => {
		if (!selectedCourseToDelete) return;
		setIsDeleting(true);
		setDeleteError(null);
		setDeleteSuccessMessage(null);
		try {
			// PASO 4: Reemplaza authenticatedFetch con authFetch
			const response = await authFetch(`/courses/${selectedCourseToDelete.id}`, { //
				method: "DELETE",
			});
			// Para DELETE, una respuesta 204 No Content es éxito y no tiene cuerpo JSON.
			// Otros códigos de error (404, 403) podrían tener cuerpo.
			if (response.status === 204) {
				// Éxito
			} else if (!response.ok) { // Para cualquier otro error que no sea 204
				const errorData = await response.json().catch(() => null);
				throw new Error(errorData?.detail || `Error ${response.status} al eliminar.`);
			}

			setDeleteSuccessMessage(
				`Curso "${selectedCourseToDelete.courseName}" (ID: ${selectedCourseToDelete.id}) y sus datos asociados eliminados.`
			);
			setShowDeleteConfirm(false);
			setSelectedCourseToDelete(null);
			setSearchTerm("");
			setCourseIdToDeleteDirect("");
			// Refrescar la lista
		} catch (err) {
			console.error("Error deleting course:", err);
			// PASO 5: Ajusta el bloque catch
			if (err instanceof Error && err.message !== "Sesión inválida o expirada.") {
				setDeleteError(err.message);
			}
		} finally {
			setIsDeleting(false);
		}
	};

	const filteredCourses = coursesForDeletion.filter(
		(course) =>
			course.courseName.toLowerCase().includes(searchTerm.toLowerCase()) ||
			course.id.toLowerCase().includes(searchTerm.toLowerCase())
	);

	if (!isAdmin && user) { // Si el usuario está logueado pero no es admin
		return (
			<div className="max-w-2xl mx-auto p-6 sm:p-8 text-center">
				<p className="text-red-600 font-semibold">Acceso Denegado</p>
				<p className="text-gray-600 mb-4">No tienes permiso para gestionar cursos.</p>
				<Button onClick={() => router.push('/dashboard')} variant="secondary">
					Volver al Panel
				</Button>
			</div>
		);
	}

	// El layout del dashboard ya provee la navbar
	return (
		// ... (JSX del componente sin cambios en la estructura, solo las llamadas a funciones) ...
		<div className="max-w-8xl mx-auto bg-gray p-6 sm:p-8">
			<Button onClick={() => router.push('/dashboard')} variant="secondary" className="mb-4"> &larr; Volver al principio </Button>

			<div className="flex flex-col md:flex-row gap-8">
				{/* Tarjeta Crear Curso */}
				<section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg w-full md:w-1/2">
					<h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-6">
						Crear Nuevo Curso
					</h1>
					<form onSubmit={handleCreateSubmit} className="space-y-6">
						{/* ... (Inputs del formulario) ... */}
						<div>
							<label
								htmlFor="courseCode"
								className="block text-sm font-medium text-gray-700 mb-1">
								Código del Curso{" "}
								<span className="text-red-500">*</span>
							</label>
							<input
								type="text"
								name="courseCode"
								id="courseCode"
								value={createFormData.courseCode}
								onChange={handleCreateChange}
								required
								className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
								placeholder="Ej: CALC101, INF230"
							/>
						</div>

						<div>
							<label
								htmlFor="courseName"
								className="block text-sm font-medium text-gray-700 mb-1">
								Nombre del Curso{" "}
								<span className="text-red-500">*</span>
							</label>
							<input
								type="text"
								name="courseName"
								id="courseName"
								value={createFormData.courseName}
								onChange={handleCreateChange}
								required
								className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
								placeholder="Ej: Cálculo I, Programación Avanzada"
							/>
						</div>

						<div>
							<label
								htmlFor="description"
								className="block text-sm font-medium text-gray-700 mb-1">
								Descripción (Opcional)
							</label>
							<textarea
								name="description"
								id="description"
								rows={4}
								value={createFormData.description}
								onChange={handleCreateChange}
								className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
								placeholder="Una breve descripción del contenido del curso..."
							/>
						</div>
						{createError && (
							<p className="text-sm text-red-600 bg-red-100 p-3 rounded-md">
								{createError}
							</p>
						)}
						{createSuccessMessage && (
							<p className="text-sm text-green-600 bg-green-100 p-3 rounded-md">
								{createSuccessMessage}
							</p>
						)}
						<div className="flex justify-end pt-2">
							<Button type="submit" disabled={isCreating} variant="primary">
								{isCreating ? "Creando Curso..." : "Crear Curso"}
							</Button>
						</div>
					</form>
				</section>

				{/* Tarjeta Eliminar Curso */}
				<section className="bg-white p-6 sm:p-8 rounded-xl shadow-lg w-full md:w-1/2">
					<h2 className="text-2xl font-semibold text-gray-800 mb-6">
						Eliminar Curso
					</h2>
					{/* ... (Inputs y lista para eliminar) ... */}
					<div className="mb-6">
						<label
							htmlFor="courseIdToDelete"
							className="block text-sm font-medium text-gray-700 mb-1">
							Eliminar por ID de Curso (Código del Curso)
						</label>
						<div className="flex space-x-2">
							<input
								type="text"
								id="courseIdToDelete"
								value={courseIdToDeleteDirect}
								onChange={(e) => setCourseIdToDeleteDirect(e.target.value.toUpperCase())}
								className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
								placeholder="Ej: CALC101"
							/>
							<Button
								onClick={() => handleDeleteAttempt(null, courseIdToDeleteDirect.trim())}
								disabled={!courseIdToDeleteDirect.trim() || isDeleting}
								variant="primary"
								className="bg-red-600 hover:bg-red-700 text-white mt-1">
								Eliminar
							</Button>
						</div>
					</div>
					<p className="text-center my-4 text-sm text-gray-500">-- O --</p>
					<div>
						<label
							htmlFor="searchCourseToDelete"
							className="block text-sm font-medium text-gray-700 mb-1">
							Buscar y Seleccionar Curso para Eliminar
						</label>
						<input
							type="text"
							id="searchCourseToDelete"
							placeholder="Escribe para filtrar por nombre o código..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="mt-1 mb-2 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-black"
						/>
						{isLoadingCourses && (
							<p className="text-sm text-gray-500 mt-2">Cargando lista de cursos...</p>
						)}
						{!isLoadingCourses && searchTerm.trim() !== "" && (
							<div className="max-h-60 overflow-y-auto border rounded-md mt-1 shadow-lg bg-white">
								{filteredCourses.length > 0 ? (
									filteredCourses.map((course) => (
										<div
											key={course.id}
											className="p-3 hover:bg-gray-100 cursor-pointer border-b last:border-b-0 text-gray-800"
											onClick={() => { handleDeleteAttempt(course); }}>
											{course.courseName}{" "}
											<span className="text-xs text-gray-500">({course.id})</span>
										</div>
									))
								) : (
								<p className="p-3 text-sm text-gray-500">
									No se encontraron cursos con &quot;{searchTerm}&quot;. {/* <-- CORRECCIÓN */}
								</p>
								)}
							</div>
						)}
						{!isLoadingCourses && coursesForDeletion.length === 0 && searchTerm.trim() === "" && (
							<p className="text-sm text-gray-500 mt-2">
								No hay cursos cargados en el sistema para eliminar.
							</p>
						)}
					</div>
					{deleteError && (
						<p className="mt-4 text-sm text-red-600 bg-red-100 p-3 rounded-md">{deleteError}</p>
					)}
					{deleteSuccessMessage && (
						<p className="mt-4 text-sm text-green-600 bg-green-100 p-3 rounded-md">{deleteSuccessMessage}</p>
					)}
				</section>
			</div>

			{/* Modal de Confirmación para Eliminar */}
			{showDeleteConfirm && selectedCourseToDelete && (
				// ... (JSX del modal sin cambios) ...
				<div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
					<div className="bg-white p-6 rounded-lg shadow-xl max-w-md mx-auto">
						<h3 className="text-lg font-semibold text-gray-900">Confirmar Eliminación</h3>
						<p className="mt-2 text-sm text-gray-600">
							¿Estás seguro de que quieres eliminar el curso: <br />
							<strong>{selectedCourseToDelete.courseName}</strong> (ID: {selectedCourseToDelete.id})?
						</p>
						<p className="mt-1 text-xs text-red-500">
							Esta acción también eliminará todas sus secciones, reuniones de clase y registros de asistencia asociados. Esta acción no se puede deshacer.
						</p>
						<div className="mt-6 flex justify-end space-x-3">
							<Button
								variant="secondary"
								onClick={() => { setShowDeleteConfirm(false); setSelectedCourseToDelete(null); }}
								disabled={isDeleting}>
								Cancelar
							</Button>
							<Button
								onClick={confirmDeleteCourse}
								variant="primary"
								className="bg-red-600 hover:bg-red-700 text-white"
								disabled={isDeleting}>
								{isDeleting ? "Eliminando..." : "Sí, Eliminar Curso"}
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}