"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import { DailyReportData, DailyReportMeetingInfo } from '@/types';

export default function NotActivatedDetailPage() {
    const router = useRouter();
    const params = useParams();
    const { authFetch } = useAuth();

    // Extraemos la fecha de la URL. params.date corresponderá a [date]
    const date = params.date as string;

    const [meetings, setMeetings] = useState<DailyReportMeetingInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!date) return;

        const fetchReportDetails = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // Usamos el endpoint existente para obtener el reporte completo del día
                const response = await authFetch(`/reports/daily/${date}`);
                if (response.status === 404) {
                    throw new Error(`No hay reporte disponible para la fecha ${date}.`);
                }
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.detail || "No se pudo cargar el detalle del reporte.");
                }
                
                const reportData: DailyReportData = await response.json();

                // Extraemos y guardamos solo la lista que nos interesa
                setMeetings(reportData.notActivatedMeetings || []);

            } catch (err) {
                if (err instanceof Error) setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchReportDetails();
    }, [date, authFetch]);

    // Formateamos la fecha para mostrarla en el título
    const formattedDate = new Date(date.replace(/-/g, '/')).toLocaleDateString('es-CL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return (
        <div className="max-w-4xl mx-auto">
            <Button onClick={() => router.back()} variant="secondary" className="mb-6 inline-flex items-center">
                &larr; Volver al Reporte Diario
            </Button>
            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg border">
                <header className="border-b border-gray-200 pb-4 mb-4">
                    <h1 className="text-2xl font-bold text-gray-800">Detalle: Secciones No Activadas</h1>
                    <p className="text-md text-gray-600">Para la fecha: {formattedDate}</p>
                </header>

                {isLoading ? (
                    <p className="text-center text-gray-500 py-6">Cargando detalles...</p>
                ) : error ? (
                    <p className="text-center text-red-600 bg-red-100 p-4 rounded-md">{error}</p>
                ) : meetings.length === 0 ? (
                    <p className="text-center text-gray-500 py-6">No se encontraron secciones no activadas para esta fecha.</p>
                ) : (
                    <div className="max-h-[60vh] overflow-y-auto">
                         <ul className="divide-y divide-gray-200">
                            {meetings.map((meeting) => (
                                <li key={meeting.meetingId} className="py-4 px-2">
                                    <p className="font-semibold text-gray-800 text-lg">
                                        {meeting.courseName}
                                    </p>
                                    <div className="flex justify-between items-center mt-1">
                                        <p className="text-sm text-gray-600">{meeting.sectionIdentifier}</p>
                                        <p className="text-sm text-gray-500">
                                            {meeting.meetingType} a las {meeting.meetingTime}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}