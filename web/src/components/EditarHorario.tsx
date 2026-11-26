import { useState } from "react";

const dias = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

export type WeeklySchedule = {
  [dia: string]: { inicio: string; fin: string }[];
};

interface EditarHorarioProps {
  onSave: (horario: WeeklySchedule) => void;
  initialSchedule?: WeeklySchedule;
}

export default function EditarHorario({ onSave, initialSchedule = {} }: EditarHorarioProps) {
  const [horario, setHorario] = useState<WeeklySchedule>(initialSchedule);

  const handleAddBloque = (dia: string) => {
    setHorario((prev) => ({
      ...prev,
      [dia]: [...(prev[dia] || []), { inicio: "", fin: "" }]
    }));
  };

  const handleChange = (dia: string, index: number, campo: "inicio" | "fin", value: string) => {
    const nuevosBloques = [...(horario[dia] || [])];
    nuevosBloques[index] = { ...nuevosBloques[index], [campo]: value };
    setHorario((prev) => ({
      ...prev,
      [dia]: nuevosBloques
    }));
  };

  const handleSave = () => {
    const horarioValido = Object.fromEntries(
      Object.entries(horario).filter(([, bloques]) =>
        bloques.some(({ inicio, fin }) => inicio && fin)
      )
    );
    onSave(horarioValido);
  };

  return (
    <div className="max-w-2xl mx-auto p-4 border rounded-lg shadow bg-white">
      <h2 className="text-xl font-bold mb-4">Editar horario de la sección</h2>
      {dias.map((dia) => (
        <div key={dia} className="mb-6">
          <label className="block capitalize font-medium mb-2">{dia}</label>
          {(horario[dia] || []).map((bloque, index) => (
            <div key={index} className="flex gap-2 mb-2">
              <input
                type="time"
                className="flex-1 px-2 py-1 border rounded"
                value={bloque.inicio}
                onChange={(e) => handleChange(dia, index, "inicio", e.target.value)}
              />
              <span className="self-center">a</span>
              <input
                type="time"
                className="flex-1 px-2 py-1 border rounded"
                value={bloque.fin}
                onChange={(e) => handleChange(dia, index, "fin", e.target.value)}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => handleAddBloque(dia)}
            className="text-sm text-blue-600 hover:underline"
          >
            + Agregar bloque
          </button>
        </div>
      ))}
      <button
        onClick={handleSave}
        className="mt-4 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
      >
        Guardar horario
      </button>
    </div>
  );
}
