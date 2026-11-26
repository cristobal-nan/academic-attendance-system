"use client";

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import { DailyReportData, DailyReportMeetingInfo } from '@/types';

// --- INICIO DE LA CORRECCIÓN ---
// Declaramos la variable XLSX para que TypeScript sepa que existe globalmente.
import * as XLSX from 'xlsx';
// --- FIN DE LA CORRECCIÓN ---

// --- Componente para la tarjeta de resumen ---
const SummaryCard = ({ summary, date }: { summary: DailyReportData['summary'], date: string }) => {
    if (!summary) {
        return (
            <div className="bg-white p-6 rounded-lg shadow-md border">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Resumen del Día</h2>
                <p className="text-gray-500">No hay datos de resumen disponibles para este día.</p>
            </div>
        );
    }

    const { totalMeetings, activatedMeetings, notActivatedMeetings } = summary;
    const activatedPercent = totalMeetings > 0 ? ((activatedMeetings / totalMeetings) * 100).toFixed(0) : 0;
    const notActivatedPercent = totalMeetings > 0 ? ((notActivatedMeetings / totalMeetings) * 100).toFixed(0) : 0;

    return (
        <div className="bg-white p-6 rounded-lg shadow-md border">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Resumen del Día</h2>
            <div className="space-y-4">
                <div className="flex justify-between items-center text-gray-700">
                    <span className="font-medium">Total de secciones con clases hoy:</span>
                    <span className="font-bold text-lg">{totalMeetings}</span>
                </div>
                <hr/>
                <div className="flex justify-between items-center">
                    <div>
                        <p className="font-medium text-green-700">Secciones activadas:</p>
                        <p className="text-sm text-gray-500">{activatedMeetings} de {totalMeetings} (<span className="font-semibold">{activatedPercent}%</span>)</p>
                    </div>
                    <Link href={`/dashboard/admin/reports/daily/${date}/activated`} passHref>
                         <Button variant="secondary" className="text-xs !py-1 !px-3">Ver Detalle</Button>
                    </Link>
                </div>
                <div className="flex justify-between items-center">
                     <div>
                        <p className="font-medium text-red-700">Secciones no activadas:</p>
                        <p className="text-sm text-gray-500">{notActivatedMeetings} de {totalMeetings} (<span className="font-semibold">{notActivatedPercent}%</span>)</p>
                    </div>
                    <Link href={`/dashboard/admin/reports/daily/${date}/not-activated`} passHref>
                         <Button variant="secondary" className="text-xs !py-1 !px-3">Ver Detalle</Button>
                    </Link>
                </div>
            </div>
        </div>
    );
};

// --- Componente para la tarjeta de Asistencia Manual ---
const ManualAttendanceCard = ({ meetings }: { meetings: DailyReportMeetingInfo[] }) => (
    <div className="bg-white p-6 rounded-lg shadow-md border">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Secciones con Asistencia 100% Manual ({meetings.length})</h2>
        {meetings.length === 0 ? (
            <p className="text-sm text-gray-500 mt-2">No se encontraron secciones que cumplan con este criterio.</p>
        ) : (
            <div className="max-h-80 overflow-y-auto pr-2 mt-3">
                <ul className="divide-y divide-gray-200">
                    {meetings.map((meeting) => (
                        <li key={meeting.meetingId} className="py-2.5">
                            <p className="font-semibold text-gray-800">
                                {meeting.courseName} - {meeting.sectionIdentifier}
                            </p>
                            <p className="text-xs text-gray-500">
                                Tipo: {meeting.meetingType} | Hora Programada: {meeting.meetingTime}
                            </p>
                        </li>
                    ))}
                </ul>
            </div>
        )}
    </div>
);

// --- Componente principal de la página ---
export default function DailyReportPage() {
    const router = useRouter();
    const { authFetch, isLoading: authIsLoading } = useAuth();
    
    const [selectedDate, setSelectedDate] = useState<string>("");
    const [reportData, setReportData] = useState<DailyReportData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);

    // URL para la librería de creación de Excel
    const XLSX_CDN_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

    // Carga el script de la librería XLSX al montar el componente
    useEffect(() => {
        const script = document.createElement('script');
        script.src = XLSX_CDN_URL;
        script.async = true;
        document.body.appendChild(script);

        return () => {
            document.body.removeChild(script);
        }
    }, []);

    const localDateString = useMemo(() => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }, []);

    useEffect(() => {
        setSelectedDate(localDateString);
    }, [localDateString]);

    useEffect(() => {
        if (authIsLoading || !selectedDate) return;

        const fetchReport = async () => {
            setIsLoading(true);
            setError(null);
            setReportData(null);
            try {
                const response = await authFetch(`/reports/daily/${selectedDate}`);
                if (response.status === 404) {
                    throw new Error(`No hay reporte disponible para la fecha ${selectedDate}.`);
                }
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.detail || "No se pudo cargar el reporte.");
                }
                const data: DailyReportData = await response.json();
                setReportData(data);
            } catch (err) {
                if (err instanceof Error) setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchReport();
    }, [selectedDate, authIsLoading, authFetch]);

    // --- Lógica de exportación a Excel ---
    const handleExport = async () => {
        if (!selectedDate) return;
        if (typeof XLSX === 'undefined') {
            alert("La librería de exportación aún no ha cargado. Por favor, inténtelo de nuevo en un momento.");
            return;
        }

        setIsExporting(true);
        try {
            // Se asume un nuevo endpoint que devuelve todos los datos necesarios en JSON
            const response = await authFetch(`/export/daily-report-excel/${selectedDate}`);
            if (!response.ok) {
                throw new Error("No se pudo generar el archivo de exportación detallado.");
            }
            
            const data: {
                summarySheet: { title: string; data: (string | number)[][] };
                detailSheets: { title: string; data: (string | number)[][] }[];
            } = await response.json();

            // 1. Crear un nuevo libro de trabajo (workbook)
            const wb = XLSX.utils.book_new();

            // 2. Crear la hoja de resumen
            const wsSummary = XLSX.utils.aoa_to_sheet(data.summarySheet.data);
            XLSX.utils.book_append_sheet(wb, wsSummary, data.summarySheet.title);

            // 3. Crear una hoja de detalle por cada sección activada
            data.detailSheets.forEach((sheet) => {
                const wsDetail = XLSX.utils.aoa_to_sheet(sheet.data);
                // Asegurarse de que el nombre de la hoja sea válido para Excel
                const safeSheetName = sheet.title.replace(/[\\/*?:\[\]]/g, '').substring(0, 31);
                XLSX.utils.book_append_sheet(wb, wsDetail, safeSheetName);
            });

            // 4. Disparar la descarga del archivo .xlsx
            XLSX.writeFile(wb, `reporte_diario_detallado_${selectedDate}.xlsx`);

        } catch (error) {
            console.error("Error al exportar:", error);
            alert((error as Error).message);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-8">
            <Button onClick={() => router.push('/dashboard/admin/reports')} variant="secondary" className="inline-flex items-center">
                &larr; Volver a Reportes
            </Button>
            
            <header className="text-center">
                <h1 className="text-3xl font-bold text-gray-800">Reporte Diario de Actividad</h1>
                <p className="text-gray-600 mt-1">
                    Selecciona una fecha para ver el resumen generado a las 18:00 hrs.
                </p>
            </header>

            <div className="flex justify-center items-center gap-4">
                <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="p-2 border border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 text-black"
                />
                <Button onClick={handleExport} disabled={!reportData || isExporting}>
                    {isExporting ? 'Exportando...' : 'Exportar a Excel'}
                </Button>
            </div>
            
            {isLoading ? (
                <p className="text-center text-gray-500 py-8">Cargando reporte para {selectedDate}...</p>
            ) : error ? (
                <p className="text-center text-red-600 bg-red-100 p-4 rounded-md">{error}</p>
            ) : reportData ? (
                <div className="space-y-8">
                    <SummaryCard summary={reportData.summary} date={selectedDate} />
                    <ManualAttendanceCard meetings={reportData.allManualAttendanceMeetings} />
                </div>
            ) : (
                 <p className="text-center text-gray-500 py-8">No hay datos de reporte para mostrar.</p>
            )}
        </div>
    );
}
