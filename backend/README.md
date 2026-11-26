[← Volver al README principal](../README.md) · [English overview](../README.en.md)

# Backend — API de Asistencia Académica (FastAPI)

Servicio backend asíncrono en **Python / FastAPI** encargado de emitir y validar tokens QR firmados, gestionar notificaciones en tiempo real vía WebSocket, administrar entidades académicas en **Cloud Firestore**, ejecutar reportes programados e integrarse bidireccionalmente con **Canvas LMS**.

---

## Estructura de archivos

- [`back.py`](back.py): aplicación FastAPI principal, autenticación con Firebase Admin, gestor de conexiones WebSocket (`ConnectionManager`), lógica de negocio, endpoints REST, exportaciones y tareas programadas con `APScheduler`.
- [`lms_canvas_client.py`](lms_canvas_client.py): cliente HTTP asíncrono (`httpx`) para consumir la API REST v1 de Canvas LMS (`GET`, `POST`, `PUT`).
- [`requirements.txt`](requirements.txt): dependencias Python del servicio.
- [`.env.example`](.env.example): plantilla de variables de entorno locales.

---

## Tecnologías clave

- **FastAPI + Uvicorn + Pydantic:** API REST asíncrona, WebSockets y validación de esquemas.
- **itsdangerous (`URLSafeTimedSerializer`):** generación y verificación criptográfica de tokens temporales (`TOKEN_MAX_AGE_SECONDS = 30`).
- **Firebase Admin SDK:** verificación de ID tokens de Firebase Auth, persistencia en Cloud Firestore y envío de notificaciones push (FCM).
- **APScheduler (`AsyncIOScheduler`):** ejecución diaria de reportes/analíticas y generación programada de *snapshots* de alerta temprana en zona horaria `America/Santiago`.
- **SendGrid (`sendgrid`):** envío de correos de alerta o reportes administrativos.

---

## Mapa de endpoints (`back.py`)

Dado que `back.py` concentra la API completa, esta guía resume los grupos de rutas para facilitar la revisión:

| Dominio | Rutas principales | Referencia aproximada |
| :--- | :--- | :--- |
| **Salud y tokens QR** | `GET /`, `GET /token`, `GET /validate/{token_qr}`, `WS /ws/{user_id}` | Líneas 218–490 |
| **Activación y asistencia en reunión** | `POST /meetings/{meeting_id}/activate`, `GET /meetings/{meeting_id}/attendance-details`, `POST /meetings/{meeting_id}/students/{student_uid}/toggle-attendance` | Líneas 251–760 |
| **Matriz y secciones docentes** | `GET /sections/{section_id}/attendance-matrix`, `GET /sections-taught-by-professor`, `GET /users/me/courses-with-sections` | Líneas 763–1080 |
| **CRUD académico (Cursos, Secciones, Reuniones)** | `POST/DELETE /courses`, `GET /courses/all`, `POST/DELETE /sections`, `POST/DELETE /class-meetings/*`, `PUT /sections/{id}/schedule`, `POST /sections/{id}/create-meetings-from-schedule` | Líneas 1086–1990 y 3369–3500 |
| **Administración de usuarios e inscripciones** | `GET /users/by-role`, `POST /admin/users`, `POST /admin/users/batch-import`, `GET /admin/users/by-email`, `POST /sections/{section_id}/enroll-students` | Líneas 1428–1490 y 1994–2540 |
| **Reportes diarios y alertas tempranas** | `GET /reports/early-warning`, `POST/GET /reports/snapshots*`, `GET /config/semester-dates`, `GET /reports/daily/latest`, `GET /reports/daily/{date}*` | Líneas 2543–3135 y 4115–4170 |
| **Integración Canvas LMS** | `GET /lms/sync/initiate`, `POST /lms/sync/process-course`, `POST /lms/canvas/sections/{section_id}/sync-attendance-grades` | Líneas 3139–3365 y 3506–3600 |
| **Exportaciones y analítica** | `GET /export/section/{id}/attendance`, `GET /export/snapshot/{id}`, `GET /export/daily-report-excel/{date}`, `GET /analytics/*` | Líneas 3604–4290 |

---

## Modelo de colecciones en Cloud Firestore

- `users`: perfiles, roles (`admin`, `profesor`, `ayudante`, `estudiante`) y `fcmToken`.
- `courses`: asignaturas registradas.
- `sections` (y subcolección `enrolledUsers`): paralelos/secciones, horarios y estudiantes inscritos.
- `classMeetings`: sesiones programadas, responsables (`responsibleUIDs`), tipo (`Cátedra`, `Ayudantía`, `Laboratorio`) y estado `isActiveForAttendance`.
- `attendanceRecords`: registros individuales de asistencia (QR o corrección manual auditada).
- `dailyReports`, `attendanceSnapshots`, `analyticsSummaries`: agregaciones generadas bajo demanda o por `APScheduler`.
- `appConfig` (doc `reportDates`): fechas de semestre, horas de corte y fechas de *snapshots*.

---

## Variables de entorno

Copia [`.env.example`](.env.example) a `.env` solo en un entorno local aislado:

| Variable | Obligatoria | Descripción |
| :--- | :---: | :--- |
| `SECRET_KEY` | Sí | Clave secreta aleatoria para firmar los tokens QR (`itsdangerous`). |
| `GOOGLE_APPLICATION_CREDENTIALS` | Sí | Ruta absoluta a un archivo JSON de cuenta de servicio de Firebase **fuera del repositorio**. |
| `ALLOWED_ORIGINS` | No | Lista de orígenes CORS separados por coma (por defecto `http://localhost:3000`). |
| `CANVAS_API_URL` | No | URL base de la instancia de Canvas LMS (solo si se prueba la integración LMS). |
| `CANVAS_ACCESS_TOKEN` | No | Token Bearer de Canvas LMS. |
| `SENDGRID_API_KEY` | No | API key de SendGrid para notificaciones por correo. |
| `SENDGRID_FROM_EMAIL` | No | Correo remitente verificado en SendGrid. |

---

## Ejecución local

```bash
python -m venv .venv
# Windows (PowerShell): .venv\Scripts\Activate.ps1
# Linux / macOS:        source .venv/bin/activate

python -m pip install -r requirements.txt
python -m uvicorn back:app --host 127.0.0.1 --port 8000
```

> **Notas antes de ejecutar:**
> - El servicio exige `SECRET_KEY` y `GOOGLE_APPLICATION_CREDENTIALS` al iniciar; fallará explícitamente si no están configurados.
> - `APScheduler` lee `appConfig/reportDates` al arranque y puede escribir reportes/snapshots o emitir notificaciones si ese documento existe en tu proyecto de Firestore.
> - Antes de exponer el servicio en red, revisa la autorización del endpoint WebSocket (`/ws/{user_id}`) y aísla las integraciones externas (Canvas, FCM, SendGrid).
