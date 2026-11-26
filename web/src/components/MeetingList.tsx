"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { SectionItem } from '@/types';

export default function MeetingList() {
  const { authFetch } = useAuth();

  const [sections, setSections] = useState<SectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSections() {
      setLoading(true);
      setError(null);
      try {
        const response = await authFetch('/sections-taught-by-professor', { method: 'GET' });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          const errorMessage = errorData?.detail || errorData?.message || `Error: ${response.statusText}`;
          throw new Error(errorMessage);
        }
        const data: SectionItem[] = await response.json();
        setSections(data);
            } catch (err) {
        if (err instanceof Error && err.message !== 'Sesión inválida o expirada.') {
          setError(err.message);
          console.error("Error fetching sections in MeetingList:", err);
        }
            } finally {
        setLoading(false);
      }
    }

    fetchSections();
  }, [authFetch]);

  if (loading) return <p className="text-center text-gray-500 py-4">Cargando secciones...</p>;
  if (error) return <p className="text-red-500 text-center py-4">Error: {error}</p>;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Mis Secciones</h2>
      {sections.length === 0 ? (
        <p className="text-gray-500">No tienes secciones asignadas.</p>
      ) : (
      <ul className="border rounded-md divide-y divide-gray-200">
        {sections.map(section => (
          <li key={section.sectionID} className="hover:bg-gray-50 transition-colors">
            <Link
              href={`/dashboard/section/${section.sectionID}/attendance`}
              className="block p-3 sm:p-4"
              legacyBehavior
            >
              <span className="font-semibold text-blue-600 hover:text-blue-700">{section.courseName}</span>
              <span className="text-gray-700"> - {section.sectionIdentifier || 'Sección Desconocida'}</span>
            </Link>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}