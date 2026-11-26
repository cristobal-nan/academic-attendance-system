"use client";

import { useEffect, useState, useMemo, Fragment } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Users, BookOpen, BarChart2, AlertTriangle, ArrowLeft, Download, ChevronDownIcon } from 'lucide-react';
import Link from 'next/link';
import Button from '@/components/Button';
import { Menu, Transition } from '@headlessui/react';

import * as XLSX from 'xlsx';

// --- Interfaces de Tipos ---
interface CriticalRiskByType {
    type: string;
    at_risk_count: number;
    total_students_in_type: number;
}
interface AnalyticsChartDataItem { name: string; id?: string; [key: string]: number | string | undefined; }
interface CourseDetailData { course_name: string; attendance_chart_data: AnalyticsChartDataItem[]; meeting_types: string[]; }
interface AnalyticsData {
    total_students: number;
    total_sections: number;
    avg_attendance: number;
    critical_risk_by_type: CriticalRiskByType[];
    attendance_chart_data: AnalyticsChartDataItem[];
    meeting_types: string[];
    students_at_risk: { name: string; course: string; percentage: number }[];
    course_details: { [courseName: string]: CourseDetailData };
}
interface DailyReportMeetingInfo { meetingId: string; courseName: string; sectionIdentifier: string; meetingType: string; meetingTime: string; }
interface DailyReportData { reportDate: string; summary: { totalMeetings: number; activatedMeetings: number; notActivatedMeetings: number; }; notActivatedMeetings: DailyReportMeetingInfo[]; allManualAttendanceMeetings: DailyReportMeetingInfo[]; }
interface UnifiedData { analytics_summary: AnalyticsData; daily_report: DailyReportData | null; }

// --- Componentes Internos (con padding y tamaños ajustados) ---
const StatCard = ({ title, value, icon: Icon }: { title: string, value: string | number, icon: React.ElementType }) => (
    <div className="bg-white p-4 rounded-lg shadow-md border flex flex-col justify-between">
         <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
                <div className="bg-red-100 p-2 rounded-full"><Icon className="h-5 w-5 text-red-600" /></div>
                <p className="text-sm text-gray-500">{title}</p>
            </div>
        </div>
        <div className="mt-2 text-right">
             <p className="text-2xl font-bold text-gray-800">{value}</p>
        </div>
    </div>
);

const ClickableRiskCard = ({ title, data, icon: Icon, onClick }: { title: string, data: CriticalRiskByType | undefined, icon: React.ElementType, onClick: () => void }) => {
    return (
        <div className="bg-white p-4 rounded-lg shadow-md border flex flex-col justify-between cursor-pointer hover:bg-red-50 transition-colors" onClick={onClick}>
            <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                    <div className="bg-red-100 p-2 rounded-full"><Icon className="h-5 w-5 text-red-600" /></div>
                    <p className="text-sm text-gray-500">{title}</p>
                </div>
                <div className='text-right'>
                    <p className='font-semibold text-xs text-gray-700'>{data ? `${data.type} (<50%)` : '...'}</p>
                </div>
            </div>
            <div className="mt-2 text-right">
                <p className="text-2xl font-bold text-gray-800">
                    {data ? `${data.at_risk_count}` : '-'}
                    <span className="text-base text-gray-500 font-medium">/{data ? data.total_students_in_type : '-'}</span>
                </p>
            </div>
        </div>
    );
};

const SummaryCard = ({ summary, date }: { summary: DailyReportData['summary'], date: string }) => {
    if (!summary) return <div className="bg-white p-6 rounded-lg shadow-md border"><h2 className="text-xl font-semibold text-gray-800 mb-4">Resumen del Día</h2><p className="text-gray-500">No hay datos de resumen disponibles.</p></div>;
    const { totalMeetings, activatedMeetings, notActivatedMeetings } = summary;
    const activatedPercent = totalMeetings > 0 ? ((activatedMeetings / totalMeetings) * 100).toFixed(0) : 0;
    const notActivatedPercent = totalMeetings > 0 ? ((notActivatedMeetings / totalMeetings) * 100).toFixed(0) : 0;
    return (
        <div className="bg-white p-6 rounded-lg shadow-md border">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Resumen del Día</h2>
            <div className="space-y-4">
                <div className="flex justify-between items-center text-gray-700"><span className="font-medium">Total de clases hoy:</span><span className="font-bold text-lg">{totalMeetings}</span></div><hr/>
                <div className="flex justify-between items-center">
                    <div><p className="font-medium text-green-700">Secciones activadas:</p><p className="text-sm text-gray-500">{activatedMeetings} de {totalMeetings} (<span className="font-semibold">{activatedPercent}%</span>)</p></div>
                    <Link href={`/dashboard/admin/reports/daily/${date}/activated`} passHref><Button variant="secondary" className="text-xs !py-1 !px-3">Ver Detalle</Button></Link>
                </div>
                <div className="flex justify-between items-center">
                    <div><p className="font-medium text-red-700">Secciones no activadas:</p><p className="text-sm text-gray-500">{notActivatedMeetings} de {totalMeetings} (<span className="font-semibold">{notActivatedPercent}%</span>)</p></div>
                    <Link href={`/dashboard/admin/reports/daily/${date}/not-activated`} passHref><Button variant="secondary" className="text-xs !py-1 !px-3">Ver Detalle</Button></Link>
                </div>
            </div>
        </div>
    );
};

const ManualAttendanceCard = ({ meetings }: { meetings: DailyReportMeetingInfo[] }) => (
    <div className="bg-white p-6 rounded-lg shadow-md border">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Secciones con Asistencia 100% Manual ({meetings.length})</h2>
        {meetings.length === 0 ? <p className="text-sm text-gray-500 mt-2">No se encontraron secciones que cumplan con este criterio.</p> : (
            <div className="max-h-80 overflow-y-auto pr-2 mt-3">
                <ul className="divide-y divide-gray-200">
                    {meetings.map((meeting) => (
                        <li key={meeting.meetingId} className="py-2.5">
                            <p className="font-semibold text-gray-800">{meeting.courseName} - {meeting.sectionIdentifier}</p>
                            <p className="text-xs text-gray-500">Tipo: {meeting.meetingType} | Hora Programada: {meeting.meetingTime}</p>
                        </li>
                    ))}
                </ul>
            </div>
        )}
    </div>
);


// --- Componente Principal de la Página ---
export default function UnifiedReportsPage() {
    const { authFetch } = useAuth();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'analytics' | 'daily'>('analytics');
    const [unifiedData, setUnifiedData] = useState<UnifiedData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dailyReportData, setDailyReportData] = useState<DailyReportData | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [isDailyReportLoading, setIsDailyReportLoading] = useState(false);
    const [dailyReportError, setDailyReportError] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [riskTypeIndex, setRiskTypeIndex] = useState(0);
    const [chartView, setChartView] = useState<'courses' | 'sections'>('courses');
    const [detailData, setDetailData] = useState<CourseDetailData | null>(null);
    const [isDetailLoading] = useState(false);
    const [riskFilterType, setRiskFilterType] = useState<string>('Cátedra');
    const COLORS = ['#F44336', '#2196F3', '#FFC107', '#4CAF50', '#9C27B0', '#FF9800', '#00BCD4'];
    const todayString = useMemo(() => new Date().toISOString().split('T')[0], []);
    const XLSX_CDN_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

    const handleRiskCardClick = () => {
        if (!unifiedData?.analytics_summary.critical_risk_by_type) return;
        const totalTypes = unifiedData.analytics_summary.critical_risk_by_type.length;
        if (totalTypes > 0) {
            setRiskTypeIndex((prevIndex) => (prevIndex + 1) % totalTypes);
        }
    };

    useEffect(() => {
        const script = document.createElement('script');
        script.src = XLSX_CDN_URL; script.async = true;
        document.body.appendChild(script);
        return () => { document.body.removeChild(script); }
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await authFetch('/analytics/unified-dashboard');
                if (!response.ok) throw new Error('No se pudieron cargar los datos.');
                const result: UnifiedData = await response.json();
                setUnifiedData(result);
                setDailyReportData(result.daily_report);
                setSelectedDate(todayString);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [authFetch, todayString]);

    useEffect(() => {
        const fetchDailyReport = async () => {
            if (!selectedDate) return;
            setIsDailyReportLoading(true);
            setDailyReportError(null);
            try {
                const response = await authFetch(`/reports/daily/${selectedDate}`);
                if (response.status === 404) {
                    setDailyReportError(`No se encontró reporte para ${selectedDate}.`);
                    setDailyReportData(null);
                } else if (!response.ok) {
                    const errorData = await response.json().catch(()=>({}));
                    throw new Error(errorData.detail || 'No se pudo cargar el reporte diario.');
                } else {
                    setDailyReportData(await response.json());
                }
            } catch (err) {
                setDailyReportError((err as Error).message);
                setDailyReportData(null);
            } finally {
                setIsDailyReportLoading(false);
            }
        };
        if(activeTab === 'daily') fetchDailyReport();
    }, [selectedDate, activeTab, authFetch]);
    
    const top5RiskySections = useMemo(() => {
        if (!unifiedData?.analytics_summary.course_details) return [];
        const allSections = Object.values(unifiedData.analytics_summary.course_details).flatMap(course => 
            course.attendance_chart_data.map(section => ({
                courseName: course.course_name,
                sectionIdentifier: section.name,
                sectionId: section.id,
                percentage: typeof section[riskFilterType] === 'number' ? section[riskFilterType] as number : -1
            }))
        );
        return allSections.filter(section => section.percentage !== -1).sort((a, b) => a.percentage - b.percentage).slice(0, 5);
    }, [unifiedData, riskFilterType]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleBarClick = (data: any) => {
        if (!data) return;
        const payload = data.activePayload ? data.activePayload[0].payload : data;
        if (!payload || !payload.name) return;
        if (chartView === 'courses' && unifiedData) {
            const courseName = payload.name;
            const courseDetail = unifiedData.analytics_summary.course_details[courseName];
            if (courseDetail) {
                setDetailData(courseDetail);
                setChartView('sections');
            }
        } else if (chartView === 'sections') {
            const sectionId = payload.id;
            if (sectionId) router.push(`/dashboard/section/${sectionId}/attendance`);
        }
    };

    const handleBackToCourses = () => {
        setChartView('courses');
        setDetailData(null);
    };

    const handleExport = async () => {
        if (!selectedDate || typeof XLSX === 'undefined') return;
        setIsExporting(true);
        try {
            const response = await authFetch(`/export/daily-report-excel/${selectedDate}`);
            if (!response.ok) throw new Error("No se pudo generar el archivo de exportación.");
            const data = await response.json();
            const wb = XLSX.utils.book_new();
            const wsSummary = XLSX.utils.aoa_to_sheet(data.summarySheet.data);
            XLSX.utils.book_append_sheet(wb, wsSummary, data.summarySheet.title);
            data.detailSheets.forEach((sheet: { title: string, data: (string | number)[][] }) => {
                const wsDetail = XLSX.utils.aoa_to_sheet(sheet.data);
                const safeSheetName = sheet.title.replace(/[\\/*?:\[\]]/g, '').substring(0, 31);
                XLSX.utils.book_append_sheet(wb, wsDetail, safeSheetName);
            });
            XLSX.writeFile(wb, `reporte_diario_detallado_${selectedDate}.xlsx`);
        } catch (error) {
            alert((error as Error).message);
        } finally {
            setIsExporting(false);
        }
    };

    if (loading) return <div className="text-center py-10">Cargando Reportes y Analíticas...</div>;
    if (error && !unifiedData) return <div className="text-center py-10 text-red-500">Error: {error}</div>;
    if (!unifiedData) return <div className="text-center py-10">No hay datos disponibles.</div>;

    const { analytics_summary } = unifiedData;
    const currentChartData = chartView === 'courses' ? analytics_summary.attendance_chart_data : detailData?.attendance_chart_data;
    const currentMeetingTypes = chartView === 'courses' ? analytics_summary.meeting_types : detailData?.meeting_types;
    const chartTitle = chartView === 'courses' ? "Comparativa de Asistencia por Curso" : `Desglose para ${detailData?.course_name}`;
    const currentRiskData = analytics_summary.critical_risk_by_type[riskTypeIndex];

    return (
        <div className="space-y-8">
            <Button onClick={() => router.push('/dashboard')} variant="secondary" className="inline-flex items-center"><ArrowLeft className="h-4 w-4 mr-2" />Volver al Panel Principal</Button>
            <h1 className="text-3xl font-bold text-gray-800">Reportes y Analíticas</h1>
            <div className="border-b border-gray-200"><nav className="-mb-px flex space-x-8" aria-label="Tabs"><button onClick={() => setActiveTab('analytics')} className={`${activeTab === 'analytics' ? 'border-red-500 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>Dashboard de Analíticas</button><button onClick={() => setActiveTab('daily')} className={`${activeTab === 'daily' ? 'border-red-500 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>Reporte de Actividad Diario</button></nav></div>
            <div>
                {activeTab === 'analytics' && (
                    <div className="space-y-8">
                        {/* Main Content Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                            {/* Chart Card (Left) */}
                            <div className="lg:col-span-4 bg-white p-6 rounded-lg shadow-md border">
                                <div className="flex items-center mb-4">{chartView === 'sections' && (<button onClick={handleBackToCourses} className="mr-4 p-2 rounded-full hover:bg-gray-100"><ArrowLeft className="h-5 w-5 text-gray-600" /></button>)}<h2 className="text-xl font-semibold text-gray-700">{chartTitle}</h2></div>
                                {isDetailLoading ? (<div className="text-center py-20">Cargando detalle...</div>) : (<ResponsiveContainer width="100%" height={400}><BarChart data={currentChartData} onClick={handleBarClick} className={'cursor-pointer'}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={12} /><YAxis unit="%" domain={[0, 100]} /><Tooltip formatter={(value) => [`${value}%`, "Asistencia"]} /><Legend />{currentMeetingTypes?.map((type, index) => (<Bar key={type} dataKey={type} fill={COLORS[index % COLORS.length]} name={type} onClick={handleBarClick} className="cursor-pointer"/>))}</BarChart></ResponsiveContainer>)}
                            </div>
                            {/* KPI Cards Column (Right) */}
                            <div className="lg:col-span-1 space-y-6">
                                <StatCard title="Estudiantes Totales" value={analytics_summary.total_students} icon={Users} />
                                <StatCard title="Secciones Totales" value={analytics_summary.total_sections} icon={BookOpen} />
                                <StatCard title="Asistencia Promedio General" value={`${analytics_summary.avg_attendance}%`} icon={BarChart2} />
                                <ClickableRiskCard 
                                    title="Estudiantes Críticos" 
                                    data={currentRiskData}
                                    icon={AlertTriangle}
                                    onClick={handleRiskCardClick}
                                />
                            </div>
                        </div>
                         {/* Risky Sections Card (Bottom) */}
                        <div className="bg-white p-6 rounded-lg shadow-md border">
                             <div className="flex justify-between items-center mb-4"><h2 className="text-lg font-semibold text-gray-700">Top 5 Secciones en Riesgo</h2><Menu as="div" className="relative"><Menu.Button className="inline-flex justify-center text-xs items-center gap-x-1.5 rounded-md bg-white px-2 py-1 font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">{riskFilterType}<ChevronDownIcon className="-mr-1 h-4 w-4 text-gray-400" /></Menu.Button><Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95"><Menu.Items className="absolute right-0 z-10 mt-2 w-40 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"><div className="py-1">{analytics_summary.meeting_types.map(type => (<Menu.Item key={type}>{({ active }) => (<button onClick={() => setRiskFilterType(type)} className={`${active ? 'bg-gray-100' : ''} ${riskFilterType === type ? 'font-bold text-red-600' : 'text-gray-700'} block w-full px-4 py-2 text-left text-sm`}>{type}</button>)}</Menu.Item>))}</div></Menu.Items></Transition></Menu></div>
                             <div className="overflow-y-auto max-h-[500px]">{top5RiskySections.length > 0 ? (<ul className="divide-y divide-gray-200">{top5RiskySections.map((section, index) => (<li key={section.sectionId || index} className="py-3"><div className="flex items-center justify-between"><div><p className="text-sm font-medium text-gray-800">{section.courseName}</p><p className="text-xs text-gray-500">{section.sectionIdentifier}</p></div><span className="text-sm font-bold text-red-600">{section.percentage}%</span></div></li>))}</ul>) : (<p className="text-sm text-gray-500 text-center pt-10">¡Buenas noticias! No hay secciones en la lista de riesgo para &quot;{riskFilterType}&quot;.</p>)}</div>
                        </div>
                    </div>
                )}
                {activeTab === 'daily' && (
                    <div className="space-y-6">
                        <div className="flex justify-center items-center gap-4"><input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="p-2 border border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 text-black" /><Button onClick={handleExport} disabled={!dailyReportData || isExporting} className="inline-flex items-center justify-center">{isExporting ? 'Exportando...' : (<><Download className="mr-2 h-4 w-4" />Exportar a XLSX</>)}</Button></div>
                        {dailyReportError && <p className="text-center text-yellow-600 bg-yellow-100 p-3 rounded-md">{dailyReportError}</p>}
                        {isDailyReportLoading ? (<p className="text-center py-10">Cargando reporte para {selectedDate}...</p>) : dailyReportData ? (<div className="space-y-8"><SummaryCard summary={dailyReportData.summary} date={dailyReportData.reportDate} /><ManualAttendanceCard meetings={dailyReportData.allManualAttendanceMeetings} /></div>) : (<p className="text-center text-gray-500 py-10">No se encontró un reporte de actividad para la fecha seleccionada.</p>)}
                    </div>
                )}
            </div>
        </div>
    );
}
