"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import Button from '@/components/Button';
import { ActivatedMeetingSummary } from '@/types';

export default function ActivatedSectionsPage() {
    const router = useRouter();
    const params = useParams();
    const { authFetch } = useAuth();
    const date = params.date as string;

    const [summaries, setSummaries] = useState<ActivatedMeetingSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!date) return;
        const fetchSummaries = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await authFetch(`/reports/daily/${date}/activated-summary`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.detail || "No se pudo cargar el resumen de secciones activadas.");
                }
                setSummaries(await response.json());
            } catch (err) {
                if (err instanceof Error) setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSummaries();
    }, [date, authFetch]);

    const formattedDate = new Date(date.replace(/-/g, '/')).toLocaleDateString('es-CL', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6">
            <Button onClick={() => router.back()} variant="secondary" className="mb-6">
                &larr; Volver al Reporte Diario
            </Button>
            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg border">
                <header className="border-b border-gray-200 pb-4 mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Detalle: Secciones Activadas</h1>
                    <p className="text-md text-gray-600">Para la fecha: {formattedDate}</p>
                </header>

                {isLoading ? (
                    <p className="text-center py-6">Cargando...</p>
                ) : error ? (
                    <p className="text-center text-red-600 bg-red-100 p-4 rounded-md">{error}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Curso</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sección</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Profesor</th>
                                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Asistentes</th>
                                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ausentes</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {summaries.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center py-4 text-gray-500">No se activaron secciones este día.</td></tr>
                                ) : (
                                    summaries.map((s) => (
                                        <tr key={s.meetingId} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{s.courseName}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{s.sectionIdentifier}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{s.professorName}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-bold text-green-600">{s.attendeeCount}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-bold text-red-600">{s.absenteeCount}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <Link href={`/dashboard/admin/reports/daily/${date}/activated/${s.meetingId}`} passHref>
                                                    <Button variant="secondary" className="!text-xs !py-1 !px-2">Ver Detalle</Button>
                                                </Link>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}