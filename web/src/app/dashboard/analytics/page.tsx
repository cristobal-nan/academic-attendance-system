"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Users, BookOpen, BarChart2, CheckCircle, ArrowLeft } from 'lucide-react';

// --- TIPOS DE DATOS ---
interface AnalyticsChartDataItem {
    name: string;
    [key: string]: number | string;
}

interface CourseDetailData {
    course_name: string;
    attendance_chart_data: AnalyticsChartDataItem[];
    meeting_types: string[];
}

interface AnalyticsData {
    total_students: number;
    total_sections: number;
    avg_attendance: number;
    sections_activated_today: number;
    attendance_chart_data: AnalyticsChartDataItem[];
    meeting_types: string[];
    students_at_risk: { name: string; course: string; percentage: number }[];
}

// Componente para las tarjetas de KPIs
const StatCard = ({ title, value, icon: Icon }: { title: string, value: string | number, icon: React.ElementType }) => (
    <div className="bg-white p-6 rounded-lg shadow-md border flex items-center space-x-4">
        <div className="bg-red-100 p-3 rounded-full">
            <Icon className="h-6 w-6 text-red-600" />
        </div>
        <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className="text-2xl font-bold text-gray-800">{value}</p>
        </div>
    </div>
);

export default function AnalyticsDashboardPage() {
    const { authFetch } = useAuth();
    
    // Estados para los datos y la carga
    const [mainData, setMainData] = useState<AnalyticsData | null>(null);
    const [detailData, setDetailData] = useState<CourseDetailData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Estado para controlar la vista del gráfico
    const [chartView, setChartView] = useState<'courses' | 'sections'>('courses');
    const [isDetailLoading, setIsDetailLoading] = useState(false);

    const COLORS = ['#F44336', '#2196F3', '#FFC107', '#4CAF50', '#9C27B0', '#FF9800', '#00BCD4'];

    // Carga inicial de los datos principales
    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await authFetch('/analytics/dashboard-summary');
                if (!response.ok) throw new Error('No se pudieron cargar los datos del dashboard.');
                const result = await response.json();
                setMainData(result);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [authFetch]);

    // --- INICIO: NUEVAS FUNCIONES PARA DRILL-DOWN ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleBarClick = async (data: any) => {
        if (!data || !data.activePayload || !data.activePayload[0]) return;
        const courseName = data.activePayload[0].payload.name;
        
        setIsDetailLoading(true);
        setError(null);
        try {
            const response = await authFetch(`/analytics/course-detail/${courseName}`);
            if (!response.ok) throw new Error(`No se pudieron cargar los detalles para ${courseName}.`);
            const result = await response.json();
            setDetailData(result);
            setChartView('sections');
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsDetailLoading(false);
        }
    };

    const handleBackToCourses = () => {
        setChartView('courses');
        setDetailData(null);
        setError(null);
    };
    // --- FIN: NUEVAS FUNCIONES PARA DRILL-DOWN ---

    if (loading) {
        return <div className="text-center py-10">Cargando datos de analíticas...</div>;
    }

    if (error && !isDetailLoading) {
        return <div className="text-center py-10 text-red-500">Error: {error}</div>;
    }

    if (!mainData) {
        return <div className="text-center py-10">No hay datos disponibles para mostrar.</div>;
    }

    // Determina qué datos y título usar para el gráfico actual
    const currentChartData = chartView === 'courses' ? mainData.attendance_chart_data : detailData?.attendance_chart_data;
    const currentMeetingTypes = chartView === 'courses' ? mainData.meeting_types : detailData?.meeting_types;
    const chartTitle = chartView === 'courses' 
        ? "Comparativa de Asistencia por Curso" 
        : `Desglose de Asistencia para ${detailData?.course_name}`;

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold text-gray-800">Dashboard de Analíticas</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title="Estudiantes Totales" value={mainData.total_students} icon={Users} />
                <StatCard title="Secciones Totales" value={mainData.total_sections} icon={BookOpen} />
                <StatCard title="Asistencia Promedio" value={`${mainData.avg_attendance}%`} icon={BarChart2} />
                <StatCard title="Secciones Activadas Hoy" value={mainData.sections_activated_today} icon={CheckCircle} />
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md border">
                <div className="flex items-center mb-4">
                    {chartView === 'sections' && (
                        <button onClick={handleBackToCourses} className="mr-4 p-2 rounded-full hover:bg-gray-100">
                            <ArrowLeft className="h-5 w-5 text-gray-600" />
                        </button>
                    )}
                    <h2 className="text-xl font-semibold text-gray-700">{chartTitle}</h2>
                </div>

                {isDetailLoading ? (
                    <div className="text-center py-20">Cargando detalle del curso...</div>
                ) : (
                    currentChartData && currentMeetingTypes && currentChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={400}>
                            <BarChart
                                data={currentChartData}
                                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                                onClick={chartView === 'courses' ? handleBarClick : undefined}
                                className={chartView === 'courses' ? 'cursor-pointer' : ''}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" fontSize={12} />
                                <YAxis unit="%" domain={[0, 100]} />
                                <Tooltip formatter={(value) => [`${value}%`, "Asistencia"]} />
                                <Legend />
                                {currentMeetingTypes.map((meetingType, index) => (
                                    <Bar 
                                        key={meetingType} 
                                        dataKey={meetingType} 
                                        fill={COLORS[index % COLORS.length]} 
                                        name={meetingType} 
                                    />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="text-center text-gray-500 py-6">No hay datos de asistencia para mostrar en esta vista.</p>
                    )
                )}
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md border">
                <h2 className="text-lg font-semibold text-gray-700 mb-4">Top 5 Estudiantes en Riesgo (Último Reporte)</h2>
                <div className="overflow-y-auto h-[300px]">
                    {mainData.students_at_risk.length > 0 ? (
                        <ul className="divide-y divide-gray-200">
                            {mainData.students_at_risk.map((student, index) => (
                                <li key={index} className="py-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-gray-800">{student.name}</p>
                                            <p className="text-xs text-gray-500">{student.course}</p>
                                        </div>
                                        <span className="text-sm font-bold text-red-600">{student.percentage}%</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-gray-500 text-center pt-10">¡Buenas noticias! No hay estudiantes en la lista de riesgo.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
