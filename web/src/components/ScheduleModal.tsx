// src/components/ScheduleModal.tsx

import Modal from './Modal';
import ScheduleForm from './ScheduleForm';
import { useAuth } from '@/context/AuthContext';
import { WeeklyScheduleItemData } from '@/types';
import { useState } from 'react';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess: () => void; // Función para notificar al padre que se guardó
  sectionId: string;
  message: string;
}

export default function ScheduleModal({ isOpen, onClose, onSaveSuccess, sectionId, message }: ScheduleModalProps) {
  const { authFetch } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveSchedule = async (schedule: WeeklyScheduleItemData[]) => {
    setIsSaving(true);
    setError(null);
    try {
      // Llamamos a un nuevo endpoint que crearemos en el backend
      const response = await authFetch(`/sections/${sectionId}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({ weeklySchedule: schedule }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'No se pudo guardar el horario.');
      }
      onSaveSuccess(); // Notificamos al componente padre
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Configurar Horario de Sección">
        <div className="p-4">
            <p className="text-sm text-gray-700 bg-yellow-100 p-3 rounded-md mb-4">{message}</p>
            <ScheduleForm
                onSave={handleSaveSchedule}
                onCancel={onClose}
                isSaving={isSaving}
            />
            {error && <p className="mt-4 text-sm text-center text-red-600">{error}</p>}
        </div>
    </Modal>
  );
}