// src/components/ScheduleForm.tsx

import { useState } from 'react';
import Button from '@/components/Button';
import { WeeklyScheduleItemData } from '@/types';

// Constantes que ya usabas
const daysOfWeek = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const meetingTypesForSectionSchedule = ["Cátedra", "Ayudantía", "Laboratorio", "Extra", "Charla", "Reunión", "Otro"];
const MAX_MEETINGS = 6;

interface ScheduleFormProps {
  onSave: (schedule: WeeklyScheduleItemData[]) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export default function ScheduleForm({ onSave, onCancel, isSaving }: ScheduleFormProps) {
  const [schedule, setSchedule] = useState<WeeklyScheduleItemData[]>([
    { dayOfWeek: daysOfWeek[0], startTime: "09:00", endTime: "10:30", location: "", meetingType: meetingTypesForSectionSchedule[0] }
  ]);
  const [error, setError] = useState<string | null>(null);

  const handleScheduleChange = (index: number, field: keyof WeeklyScheduleItemData, value: string) => {
    const updatedSchedule = schedule.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    );
    setSchedule(updatedSchedule);
  };

  const addWeeklyScheduleItem = () => {
    if (schedule.length < MAX_MEETINGS) {
      setSchedule(prev => [...prev, { dayOfWeek: daysOfWeek[0], startTime: "09:00", endTime: "10:30", location: "", meetingType: meetingTypesForSectionSchedule[0] }]);
    }
  };

  const removeWeeklyScheduleItem = (indexToRemove: number) => {
    if (schedule.length > 1) {
      setSchedule(prev => prev.filter((_, index) => index !== indexToRemove));
    }
  };

  const handleSaveClick = () => {
    setError(null);
    for (const item of schedule) {
        if (!item.dayOfWeek || !item.startTime || !item.endTime || !item.meetingType) {
            setError("Para cada reunión, el día, tipo, hora de inicio y término son obligatorios.");
            return;
        }
    }
    onSave(schedule);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-gray-700">Horarios Semanales</h3>
        <Button type="button" onClick={addWeeklyScheduleItem} disabled={schedule.length >= MAX_MEETINGS} variant="secondary" className="text-sm px-3 py-1">
          Añadir Reunión
        </Button>
      </div>
      
      {schedule.map((item, index) => (
        <div key={index} className="p-4 border border-gray-200 rounded-md space-y-3 bg-slate-50 relative">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-medium text-gray-600">Reunión Semanal {index + 1}</h4>
            {schedule.length > 1 && (
              <Button type="button" onClick={() => removeWeeklyScheduleItem(index)} variant="secondary" className="text-xs !p-1 bg-red-100 text-red-600 hover:bg-red-200 absolute top-2 right-2" title="Eliminar esta reunión">X</Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <label htmlFor={`dayOfWeek-${index}`} className="block text-xs font-medium text-gray-600">Día <span className="text-red-500">*</span></label>
                <select id={`dayOfWeek-${index}`} value={item.dayOfWeek} onChange={(e) => handleScheduleChange(index, "dayOfWeek", e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-black">
                    {daysOfWeek.map((day) => (<option key={day} value={day}>{day}</option>))}
                </select>
            </div>
            <div>
                <label htmlFor={`meetingType-${index}`} className="block text-xs font-medium text-gray-600">Tipo <span className="text-red-500">*</span></label>
                <select id={`meetingType-${index}`} value={item.meetingType} onChange={(e) => handleScheduleChange(index, "meetingType", e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-black">
                    {meetingTypesForSectionSchedule.map((type) => (<option key={type} value={type}>{type}</option>))}
                </select>
            </div>
          </div>
          
          {/* --- INICIO DEL CÓDIGO AÑADIDO --- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <label htmlFor={`startTime-${index}`} className="block text-xs font-medium text-gray-600">Hora Inicio <span className="text-red-500">*</span></label>
                <input type="time" id={`startTime-${index}`} value={item.startTime} onChange={(e) => handleScheduleChange(index, "startTime", e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-black" />
            </div>
            <div>
                <label htmlFor={`endTime-${index}`} className="block text-xs font-medium text-gray-600">Hora Término <span className="text-red-500">*</span></label>
                <input type="time" id={`endTime-${index}`} value={item.endTime} onChange={(e) => handleScheduleChange(index, "endTime", e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-black" />
            </div>
          </div>
          <div>
              <label htmlFor={`location-${index}`} className="block text-xs font-medium text-gray-600">Sala (Opcional)</label>
              <input type="text" id={`location-${index}`} value={item.location || ""} onChange={(e) => handleScheduleChange(index, "location", e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-black" placeholder="Ej: Sala A101" />
          </div>
          {/* --- FIN DEL CÓDIGO AÑADIDO --- */}

        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="pt-4 flex justify-end space-x-3">
        <Button variant="secondary" onClick={onCancel} disabled={isSaving}>Cancelar</Button>
        <Button variant="primary" onClick={handleSaveClick} disabled={isSaving}>
          {isSaving ? 'Guardando...' : 'Guardar Horario'}
        </Button>
      </div>
    </div>
  );
}