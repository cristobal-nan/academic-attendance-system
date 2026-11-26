// src/types/index.ts (Ejemplo Limpio)

export interface AuthContextType {
  user: UserData | null;
  token: string | null;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  isSessionExpiredModalOpen: boolean;
  closeSessionExpiredModalAndLogout?: () => Promise<void>;
  authFetch: (endpoint: string, options?: RequestInit) => Promise<Response>;
}

export interface SectionItem {
  sectionID: string;
  courseName: string;
  sectionIdentifier: string;
}

export interface SectionDetails {
	sectionId: string;
	courseName: string;
	sectionIdentifier: string;
	courseID: string; // <--- AÑADE ESTO
}

export interface MeetingColumn {
    meetingId: string;
    meetingDateTime: string | null;
    isActiveForAttendance: boolean;
    meetingType: string; // AÑADE ESTA LÍNEA
}

export interface StudentAttendanceData {
	studentUid: string;
	studentName: string;
	overallAttendancePercentage: number;
	attendanceByMeeting: {
		[meetingId: string]: boolean | null;
	};
}

export interface AttendanceMatrixResponse {
    sectionDetails: SectionDetails;
    meetings: MeetingColumn[];
    studentsAttendance: StudentAttendanceData[];
    availableMeetingTypes?: string[];
}

export interface WeeklyScheduleItemData {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  location?: string;
  meetingType: string;
}

export interface ComboboxState<T> {
    inputValue: string;
    filteredOptions: T[];
    showDropdown: boolean;
    selectedValue: T | null;
}

export interface MeetingBatchFormData {
  courseId: string;
  sectionId: string;
  startDate: string;
  endDate: string;
  location: string;
  organizerUid: string;
  meetingType: string; 
}

export interface SingleMeetingFormData {
  courseId: string;
  sectionId: string;
  meetingDate: string;   // <-- CAMBIO
  startTime: string;     // <-- CAMBIO
  endTime: string;       
  location: string;
  organizerUid: string;
  meetingType: string;
}

export interface MeetingForDeleteListing {
  id: string; 
  meetingDateTime: string; 
  meetingType: string;
  location?: string;
}

export interface StudentAttendance {
    uid: string;
    studentName: string | null;
    attended: boolean;
    validationTimestamp?: string | null;
    validatedBy?: string | null;
}

export interface MeetingDetails {
    courseName?: string;
    sectionIdentifier?: string;
    meetingDateTime?: string | Date;
    // --- INICIO DE LA MODIFICACIÓN ---
    professorName?: string; // <-- AÑADE ESTA LÍNEA
    // --- FIN DE LA MODIFICACIÓN ---
}

export interface AttendanceDetailsResponse {
    meetingDetails: MeetingDetails;
    students: StudentAttendance[];
}

export interface CourseFormData { // Para el formulario de creación de cursos
  courseCode: string;
  courseName: string;
  description: string; // o string | undefined
}

export interface CourseForListing {
  id: string;
  courseName: string;
}
export interface CourseWithSections {
  courseID: string; 
  courseName: string;
  description?: string;
  sections: SectionSummary[];
  createdAt?: string | Date;
  createdByName?: string;
}

export interface CourseDetails {
  courseID: string;
  courseName: string;
  description?: string; // si no siempre viene, lo haces opcional
}

export interface CourseSectionItem {
  sectionID: string;
  sectionIdentifier: string;
}

export interface SectionFormData {
  courseID: string;      
  courseName: string;
  professors: UserForListing[];
  assistants?: UserForListing[];
  sectionIdentifier: string;
  weeklySchedule: WeeklyScheduleItemData[];
}

export interface SectionSummary { 
  sectionID: string;
  sectionIdentifier: string;
  courseName: string;
}

export interface UserData {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  roles?: string[] | null;
  nombres?: string | null;
  apellidos?: string | null;
  rut?: string | null;
}

export interface UserForListing {
  uid: string;
  displayName: string;
  email?: string;
  roles?: string[] | null;
  nombres?: string | null;
  apellidos?: string | null;
  rut?: string | null;
}

export interface AdminOption {
  id: string;
  title: string;
  description: string;
  href: string;
  icon?: React.ReactNode;
}

// --- Para Componentes de UI (Combobox) ---
export interface ComboboxState<T> {
  inputValue: string;
  filteredOptions: T[];
  showDropdown: boolean;
  selectedValue: T | null;
}

export interface ListedSectionInfo {
  sectionID: string;
  sectionIdentifier: string;
  // podrías añadir courseName aquí si el endpoint lo devuelve para contexto
}

export interface CsvUser {
    apellidos: string;
    nombres: string;
    rut: string;
    correo: string;
}

export interface BatchImportResult {
    email: string;
    status: 'success' | 'error' | 'skipped';
    message: string;
    originalData?: CsvUser;
}

// Tipo para el usuario que se está editando
export type EditingUserData = Omit<UserData, 'photoURL' | 'emailVerified'>;
export type StudentToEnroll = UserForListing;

export interface EarlyWarningStudent {
    studentUid: string;
    studentName: string;
    courseName: string;
    sectionIdentifier: string;
    overallAttendancePercentage: number;
    sectionID: string;
    courseID: string;
    percentagesByType?: { [key: string]: number };
}

export interface SnapshotInfo {
  id: string;
  snapshotName: string;
  cutOffDate: string;
  createdAt: string;
}

export interface SemesterDates {
    primerSemestreStart?: string | null;
    primerSemestreEnd?: string | null;
    segundoSemestreStart?: string | null;
    segundoSemestreEnd?: string | null;
}

export interface EarlyWarningPageResponse {
    cutOffDates: {
        firstCutOff: string | null;
        secondCutOff: string | null;
        thirdCutOff: string | null;
    };
    existingSnapshots: SnapshotInfo[];
    latestSnapshot: SnapshotDetailResponse | null;
    semesterDates?: SemesterDates;
}

// Para un resultado de estudiante dentro de un snapshot detallado
export interface SnapshotStudentResult {
  studentUid: string;
  studentName: string;
  sectionId: string;
  courseName: string;
  sectionIdentifier: string;
  attendancePercentage: number;
  percentagesByType?: { [key: string]: number }; 
}

// Para la respuesta completa de un snapshot detallado
export interface SnapshotDetailResponse {
  id: string;
  snapshotName: string;
  cutOffDate: string;
  createdAt: string;
  results: SnapshotStudentResult[];
}

export interface DailyReportMeetingInfo {
  meetingId: string;
  sectionId: string;
  courseName: string;
  sectionIdentifier: string;
  meetingType: string;
  meetingTime: string;
}

export interface DailyReportData {
  reportDate: string;
  generatedAt: {
    _seconds: number;
    _nanoseconds: number;
  };
  notActivatedMeetings: DailyReportMeetingInfo[];
  allManualAttendanceMeetings: DailyReportMeetingInfo[];
}


export interface DailyReportData {
  reportDate: string;
  generatedAt: {
    _seconds: number;
    _nanoseconds: number;
  };
  notActivatedMeetings: DailyReportMeetingInfo[];
  allManualAttendanceMeetings: DailyReportMeetingInfo[];
  // --- INICIO DE LA MODIFICACIÓN ---
  summary?: { // Lo hacemos opcional para ser compatible con reportes antiguos que no lo tengan
    totalMeetings: number;
    activatedMeetings: number;
    notActivatedMeetings: number;
  };
  // --- FIN DE LA MODIFICACIÓN ---
}

export interface ActivatedMeetingSummary {
  meetingId: string;
  courseName: string;
  sectionIdentifier: string;
  professorName: string;
  attendeeCount: number;
  absenteeCount: number;
}