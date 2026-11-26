'use client';

import { useState } from 'react';
import EditarHorario, { WeeklySchedule } from '@/components/EditarHorario';

export default function EditarHorarioPage() {

  // Puedes precargar este horario desde Firestore si lo deseas
  const [initialSchedule] = useState<WeeklySchedule>({});

  const handleGuardar = (horario: WeeklySchedule) => {
    console.log('Horario guardado:', horario);

    // Aquí podrías conectarte a Firestore, por ejemplo:
    // await setDoc(doc(db, "sections", sectionId), { weeklySchedule: horario }, { merge: true });

    // Redirigir si quieres
    // router.push('/dashboard/section/123'); // cambia por la ruta que corresponda
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <EditarHorario onSave={handleGuardar} initialSchedule={initialSchedule} />
    </div>
  );
}
