import logging
import os
import json
import re
import csv
import io
import firebase_admin
import asyncio
import pytz
import traceback
import ssl
import certifi
import urllib.request
from dotenv import load_dotenv
from typing import Dict, Optional, List, Any, Set
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadTimeSignature, BadSignature
from firebase_admin import credentials, auth, firestore, messaging
from google.protobuf.timestamp_pb2 import Timestamp
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, time as py_time, timezone
from datetime import date
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from lms_canvas_client import call_canvas_api
from fastapi.responses import StreamingResponse
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from python_http_client.client import Client # Asegúrate de tener este import

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ssl_context = ssl.create_default_context(cafile=certifi.where())
opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context))
urllib.request.install_opener(opener)

# --- Configuración ---
load_dotenv()
SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY.strip():
    raise RuntimeError("Configura SECRET_KEY antes de iniciar el backend.")
TOKEN_MAX_AGE_SECONDS = 30
TOKEN_SALT = 'token-de-usuario'
serializer = URLSafeTimedSerializer(SECRET_KEY)
chile_tz = pytz.timezone('America/Santiago')
# --- Inicialización de FastAPI y Logger ---
app = FastAPI(
    title="API de Tokens Seguros con Notificaciones WS",
    description="Genera y valida tokens, notifica validaciones por WebSocket.",
    version="1.1.0" # Incrementamos versión
)

allowed_origins_str = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")

# Convierte el string en una lista de orígenes
origins = [origin.strip() for origin in allowed_origins_str.split(",")]

logger.info(f"Orígenes CORS permitidos: {origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Firebase Admin requires an explicitly configured credential file.
cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
if not cred_path:
    raise RuntimeError("Configura GOOGLE_APPLICATION_CREDENTIALS para un proyecto aislado.")
try:
    cred = credentials.Certificate(cred_path)
    firebase_app = firebase_admin.initialize_app(cred)
    db = firestore.client(app=firebase_app)
except (ValueError, OSError):
    raise RuntimeError("Comprueba la configuración local de Firebase Admin.") from None

# --- Gestor de Conexiones WebSocket ---
class ConnectionManager:
    # ... (código existente con user_id: str) ...
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    async def connect(self, websocket: WebSocket, user_id: str): # user_id str
         # ...
         await websocket.accept()
         if user_id not in self.active_connections:
            self.active_connections[user_id] = []
         self.active_connections[user_id].append(websocket)
         logger.info(f"WebSocket conectado para user_id: {user_id} (Total: {len(self.active_connections[user_id])})")
    def disconnect(self, websocket: WebSocket, user_id: str): # user_id str
        # ... (lógica existente para remover y limpiar)
        if user_id in self.active_connections:
            try:
                self.active_connections[user_id].remove(websocket)
            except ValueError:
                 logger.warning(f"WebSocket ya removido o no encontrado para user_id {user_id} durante disconnect.")
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                logger.info(f"Última conexión cerrada, eliminando entrada para user_id: {user_id}")
            else:
                logger.info(f"WebSocket desconectado para user_id: {user_id} (Restantes: {len(self.active_connections[user_id])})")
        else:
             logger.warning(f"Intento de desconexión para user_id {user_id} sin conexión registrada.")
    async def send_personal_message(self, message: str, user_id: str): # user_id str
        # ... (lógica existente con manejo de errores y limpieza)
        if user_id in self.active_connections:
            disconnected_websockets = []
            for websocket in list(self.active_connections[user_id]):
                try:
                    await websocket.send_text(message)
                    logger.info(f"Mensaje '{message}' enviado a user_id: {user_id}")
                except Exception as e:
                    logger.warning(f"Error enviando a WebSocket para user_id {user_id}: {e}. Marcando para desconexión.")
                    disconnected_websockets.append(websocket)
            for ws in disconnected_websockets:
               self.disconnect(ws, user_id)
        else:
            logger.info(f"No hay conexiones WebSocket activas para user_id {user_id} para enviar mensaje.")



# --- Instancia del Gestor ---
manager = ConnectionManager()

# --- Dependencia de Autenticación ---
security = HTTPBearer() # Esquema para extraer token 'Bearer'

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    """
    Dependencia para verificar el token de ID de Firebase - VERSIÓN DEBUG CON PRINT
    """
    if credentials is None:
         print("--- DEBUG: GET_CURRENT_USER - FALLO: No se proporcionaron credenciales ---")
         raise HTTPException(
             status_code=status.HTTP_401_UNAUTHORIZED,
             detail="No se proporcionaron credenciales (Bearer token)",
             headers={"WWW-Authenticate": "Bearer"},
         )

    token = credentials.credentials # Extrae el token
    print(f"\n--- DEBUG: GET_CURRENT_USER - Verificando token COMPLETO: {token} ---")

    if not firebase_admin._apps:
         print("--- DEBUG: GET_CURRENT_USER - FALLO: Firebase Admin SDK no inicializado antes de verificar. ---")
         raise HTTPException(
              status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
              detail="Servicio de autenticación no disponible.",
         )

    try:
        decoded_token = auth.verify_id_token(token)
        user_uid = decoded_token.get('uid')

        # --- INICIO DE CAMBIO PARA ROLES MÚLTIPLES ---
        if user_uid and db: 
            user_doc_ref = db.collection('users').document(user_uid)
            user_doc = await asyncio.to_thread(user_doc_ref.get)
            if user_doc.exists:
                user_data = user_doc.to_dict()
                # Lee el campo 'roles' (array) en lugar de 'role' (string)
                user_roles_from_db = user_data.get('roles') 
                if isinstance(user_roles_from_db, list):
                    # Asegurarse de que todos los elementos en la lista son strings
                    decoded_token['roles'] = [str(r) for r in user_roles_from_db if isinstance(r, str)]
                elif isinstance(user_roles_from_db, str): 
                    # Caso de fallback si aún encuentras un 'role' como string (datos antiguos)
                    decoded_token['roles'] = [user_roles_from_db]
                    logger.warning(f"Usuario {user_uid} tiene 'role' como string en Firestore, se convirtió a array ['{user_roles_from_db}']. Considerar actualizar el documento en la base de datos.")
                else:
                    decoded_token['roles'] = [] # Default a array vacío si 'roles' no existe o no es lista/string
                # logger.info(f"User {user_uid} roles fetched from Firestore: {decoded_token['roles']}") # Log más detallado
            else:
                decoded_token['roles'] = [] 
                logger.warning(f"User profile for {user_uid} not found in 'users' collection. Roles set to empty array.")
        else:
            decoded_token['roles'] = [] 
            if not user_uid:
                 logger.warning("No user_uid found in decoded_token.")
            if not db:
                 logger.error("Firestore db client is not available in get_current_user.")
        # --- FIN DE CAMBIO PARA ROLES MÚLTIPLES ---

        print(f"--- DEBUG: GET_CURRENT_USER - VERIFICACIÓN EXITOSA ---")
        print(f"--- UID del token verificado: {decoded_token.get('uid')} ---")
        print(f"--- Email del token (si existe): {decoded_token.get('email')} ---")
        print(f"--- Roles del usuario: {decoded_token.get('roles')} ---") # Log actualizado
        print(f"-------------------------------------------------------\n")
        return decoded_token

    except Exception as e:
        # SI LLEGA AQUÍ, LA VERIFICACIÓN FALLÓ
        print(f"--- DEBUG: GET_CURRENT_USER - VERIFICACIÓN FALLIDA ---")
        print(f"--- Tipo de Error: {type(e).__name__} ---") # Imprime el tipo de excepción
        print(f"--- Mensaje de Error: {e} ---")           # Imprime el mensaje de la excepción
        print(f"---------------------------------------------------\n")
        # Levanta la excepción HTTP como antes
        if isinstance(e, auth.UserNotFoundError):
             detail_msg = "Usuario no encontrado."
        elif isinstance(e, auth.ExpiredIdTokenError):
             detail_msg = "Token expirado."
        elif isinstance(e, auth.RevokedIdTokenError):
             detail_msg = "Token revocado."
        elif isinstance(e, auth.InvalidIdTokenError):
             detail_msg = "Token inválido (firma, formato, etc.)."
        else:
             detail_msg = f"Error inesperado en verificación: {e}"

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail_msg,
            headers={"WWW-Authenticate": "Bearer error=\"invalid_token\""},
        )
# --- Rutas HTTP (Sin cambios en / y /token/{user_id}) ---
@app.get('/')
async def index():
    return {"message": "API de Tokens lista con WebSockets y Auth Firebase."}

# CAMBIO: Ruta protegida, obtiene user_id del token verificado
@app.get('/token') # Ya no necesita user_id en la ruta
async def generate_token(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Genera un token de QR temporal para el usuario autenticado.
    Requiere un token de ID de Firebase válido en el header Authorization: Bearer.
    """
    user_id = current_user.get('uid') # Obtenemos el UID del token verificado
    if not user_id:
         # Esto no debería pasar si get_current_user funciona bien, pero por si acaso
         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No se pudo obtener UID del token.")

    try:
        # Generamos el token QR usando el UID verificado
        # Nota: Este token (el QR) sigue siendo un token 'itsdangerous', no el token de Firebase.
        qr_token = serializer.dumps({'id': user_id}, salt=TOKEN_SALT)
        logger.info(f"Token QR generado para user_id: {user_id}")
        return {
            'user_id': user_id, # Devolvemos el UID verificado
            'token': qr_token, # El token para el QR
            'expires_in_seconds': TOKEN_MAX_AGE_SECONDS
        }
    except Exception as e:
        logger.error(f"Error generando token QR para UID {user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error interno al generar el token QR."
        )

@app.post("/meetings/{meeting_id}/activate", tags=["Meetings"])
async def activate_meeting_and_notify(meeting_id: str, current_user: dict = Depends(get_current_user)):
    """
    Activa una reunión para la toma de asistencia y envía una notificación push
    a todos los estudiantes inscritos en la sección.
    """
    user_uid = current_user.get("uid")
    user_roles = current_user.get("roles", [])

    # 1. VERIFICAR PERMISOS
    if not any(role in user_roles for role in ["admin", "profesor", "ayudante"]):
        raise HTTPException(status_code=403, detail="No tienes permiso para activar reuniones.")

    # 2. ACTIVAR LA REUNIÓN EN FIRESTORE
    meeting_ref = db.collection('classMeetings').document(meeting_id)
    meeting_doc = await asyncio.to_thread(meeting_ref.get)
    if not meeting_doc.exists:
        raise HTTPException(status_code=404, detail="La reunión no fue encontrada.")
    
    await asyncio.to_thread(meeting_ref.update, {"isActiveForAttendance": True, "activatedBy": user_uid})
    logger.info(f"Reunión {meeting_id} activada por usuario {user_uid}.")

    # 3. OBTENER ESTUDIANTES Y SUS TOKENS FCM
    meeting_data = meeting_doc.to_dict()
    section_id = meeting_data.get("sectionID")
    if not section_id:
        logger.error(f"La reunión {meeting_id} no tiene un sectionID asociado. No se pueden enviar notificaciones.")
        return {"status": "success", "message": "Reunión activada, pero no se pudieron enviar notificaciones (sin sectionID)."}

    enrolled_users_ref = db.collection('sections').document(section_id).collection('enrolledUsers')
    enrolled_docs = await asyncio.to_thread(list, enrolled_users_ref.stream())
    student_uids = [doc.id for doc in enrolled_docs]

    fcm_tokens = []
    if student_uids:
        batched_student_uids = [student_uids[i:i + 30] for i in range(0, len(student_uids), 30)]
        
        for batch in batched_student_uids:
            if not batch: continue
            user_docs_query = db.collection('users').where(field_path='__name__', op_string='in', value=batch)
            user_docs = await asyncio.to_thread(list, user_docs_query.stream())

            for doc in user_docs:
                user_data = doc.to_dict()
                if user_data.get("fcmToken"):
                    fcm_tokens.append(user_data["fcmToken"])
    
    if not fcm_tokens:
        logger.warning(f"No se encontraron tokens FCM para los estudiantes de la sección {section_id}.")
        return {"status": "success", "message": "Reunión activada, pero no se encontraron dispositivos para notificar."}

    # 4. CONSTRUIR Y ENVIAR NOTIFICACIONES DE FORMA INDIVIDUAL
    section_info_doc = await asyncio.to_thread(db.collection('sections').document(section_id).get)
    course_name = section_info_doc.to_dict().get("courseName", "un curso")

    success_count = 0
    failure_count = 0

    for token in fcm_tokens:
        try:
            message_single = messaging.Message(
                notification=messaging.Notification(
                    title=f"¡Clase de {course_name} ha comenzado!",
                    body="La asistencia ya está activa. Ingresa a la app para generar tu código QR."
                ),
                token=token,
                data={"click_action": "FLUTTER_NOTIFICATION_CLICK", "screen": "qr_generator"}
            )
            messaging.send(message_single)
            success_count += 1
        except Exception as e:
            logger.warning(f"Fallo al enviar notificación a token {token}: {e}")
            failure_count += 1

    logger.info(f"Notificaciones enviadas: {success_count} exitosas, {failure_count} fallidas.")

    return {
        "status": "success",
        "message": f"Reunion activada y se enviaron {success_count} notificaciones (con {failure_count} fallos)."
    }

# --- Ruta HTTP /validate/{token} MODIFICADA ---
@app.get('/validate/{token_qr}')
async def validate_token_qr(
    token_qr: str,
    meetingId: str | None = None,
    current_validator: Dict[str, Any] = Depends(get_current_user) # <-- DESCOMENTADO Y ACTIVADO
):
    if db is None:
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible.")

    if not meetingId:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El ID de la reunión (meetingId) es requerido como query parameter."
        )

    attendee_uid: Optional[str] = None # Initialize to allow logging even if token validation fails early

    try:
        # 1. Validar el token QR y obtener attendee_uid
        data_from_token = serializer.loads(token_qr, salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE_SECONDS)
        attendee_uid = data_from_token.get('id')
        if not isinstance(attendee_uid, str):
            raise BadSignature("El token QR no contiene un ID de usuario válido.")
        
        logger.info(f"Token QR validado (itsdangerous) para attendee_uid: {attendee_uid} para meetingId: {meetingId}")

        # 2. Obtener el sectionID y verificar que la reunión esté activa
        meeting_doc_ref = db.collection('classMeetings').document(meetingId)
        meeting_doc = await asyncio.to_thread(meeting_doc_ref.get)

        if not meeting_doc.exists:
            logger.warning(f"Validación QR fallida: Reunión (meetingId: {meetingId}) no encontrada.")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="La reunión especificada no existe.")

        meeting_data = meeting_doc.to_dict()
        section_id_from_meeting = meeting_data.get('sectionID')
        is_active_for_attendance = meeting_data.get('isActiveForAttendance', False)

        if not section_id_from_meeting:
            logger.error(f"Error de config: Reunión {meetingId} no tiene sectionID.")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error de configuración de la reunión.")

        if not is_active_for_attendance:
            logger.warning(f"Validación QR fallida: Reunión {meetingId} (Sección: {section_id_from_meeting}) no está activa para tomar asistencia.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta reunión no está activa para tomar asistencia.")

        # 3. Verificar inscripción del attendee_uid en la sección
        # Document ID in enrolledUsers is the studentUID itself
        enrollment_ref = db.collection('sections').document(section_id_from_meeting).collection('enrolledUsers').document(attendee_uid)
        enrollment_doc = await asyncio.to_thread(enrollment_ref.get)

        if not enrollment_doc.exists:
            logger.warning(f"Validación QR denegada: Usuario {attendee_uid} NO inscrito en sección {section_id_from_meeting}.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="El usuario no está inscrito en la sección de esta clase.")
        
        logger.info(f"Inscripción confirmada para {attendee_uid} en sección {section_id_from_meeting}.")
        
        # 4. Prevenir doble marcado de asistencia
        attendance_query = db.collection('attendanceRecords') \
                             .where('meetingID', '==', meetingId) \
                             .where('attendeeUID', '==', attendee_uid) \
                             .limit(1)
        
        existing_attendance_docs = await asyncio.to_thread(list, attendance_query.stream())

        if existing_attendance_docs:
            first_attendance_data = existing_attendance_docs[0].to_dict()
            logger.info(f"Asistencia YA REGISTRADA para {attendee_uid} en meeting {meetingId} (timestamp: {first_attendance_data.get('timestamp')}).")
            await manager.send_personal_message("VALIDATED_ALREADY", attendee_uid)
            return {
                'status': 'ya_registrado',
                'message': 'La asistencia ya fue registrada previamente para este usuario en esta reunión.',
                'user_id': attendee_uid,
                'meeting_id': meetingId,
                'firstAttendanceTimestamp': first_attendance_data.get('timestamp')
            }

        # --- 5. Obtener el nombre del estudiante desde la colección 'users' ---
        attendee_name_to_store = attendee_uid # Fallback
        try:
            user_profile_doc_ref = db.collection('users').document(attendee_uid)
            user_profile_doc = await asyncio.to_thread(user_profile_doc_ref.get)
            if user_profile_doc.exists:
                user_profile_data = user_profile_doc.to_dict()
                # Prioritize displayName if it exists and is set
                if user_profile_data.get("displayName"):
                    attendee_name_to_store = user_profile_data["displayName"]
                # Fallback to constructing from nombres and apellidos if displayName is not set
                elif user_profile_data.get("nombres") and user_profile_data.get("apellidos"):
                    attendee_name_to_store = f"{user_profile_data.get('nombres')} {user_profile_data.get('apellidos')}".strip()
                else: # If neither displayName nor parts are available, log warning and use UID
                    logger.warning(f"No se encontró 'displayName' ni 'nombres'/'apellidos' para attendeeUID: {attendee_uid} en la colección 'users'. Usando UID como nombre.")
                logger.info(f"Nombre '{attendee_name_to_store}' obtenido/construido para attendeeUID: {attendee_uid} desde la colección 'users'.")
            else:
                logger.warning(f"No se encontró perfil en 'users' para attendeeUID: {attendee_uid}. Usando UID como nombre.")
        except Exception as e_user_fetch:
            logger.error(f"Error al intentar obtener nombre para attendeeUID {attendee_uid} desde 'users': {e_user_fetch}", exc_info=True)
        # --- FIN OBTENCIÓN DE NOMBRE ---
        
        # 6. Registrar Asistencia en attendanceRecords
        new_attendance_ref = db.collection('attendanceRecords').document() # ID autogenerado
        
        # --- INICIO DE LA MODIFICACIÓN ---
        validator_uid = current_validator.get('uid')
        validator_name = current_validator.get('name', validator_uid) # Usa el nombre, o el UID como fallback
        # --- FIN DE LA MODIFICACIÓN ---

        await asyncio.to_thread(new_attendance_ref.set, {
            'meetingID': meetingId,
            'sectionID': section_id_from_meeting,
            'attendeeUID': attendee_uid,
            'attendeeName': attendee_name_to_store,
            'timestamp': firestore.SERVER_TIMESTAMP,
            'method': "qr_scan",
            'validatedByUID': validator_uid, # <-- AÑADIDO
            'validatedByName': validator_name, # <-- MODIFICADO
        })
        logger.info(f"Asistencia registrada por QR para {attendee_uid} (Nombre: {attendee_name_to_store}) en meeting {meetingId}.")

        await manager.send_personal_message("VALIDATED_NEWLY", attendee_uid)

        return {
            'status': 'asistencia_registrada_por_qr',
            'message': f'Asistencia registrada por QR para el usuario ID: {attendee_uid} en la reunión ID: {meetingId}.',
            'user_id': attendee_uid,
            'meeting_id': meetingId,
            'attendeeName': attendee_name_to_store
        }

    except SignatureExpired:
        logger.info(f"Token QR expirado: {token_qr}")
        raise HTTPException(status_code=400, detail="El token QR ha expirado.")
    except (BadSignature, BadTimeSignature) as e_sig: # Renombrada para evitar colisión con 'e' general
        logger.warning(f"Token QR inválido o manipulado: {token_qr} - Error: {e_sig}")
        raise HTTPException(status_code=400, detail="El token QR es inválido o ha sido manipulado.")
    except HTTPException as http_exc: # Re-lanzar HTTPExceptions que ya manejamos (ej. 403, 404)
        raise http_exc
    except Exception as e: # Captura general para errores inesperados
        logger.error(f"Error inesperado en /validate: QR={token_qr}, Meeting={meetingId}, Attendee={attendee_uid} - Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al procesar la solicitud de validación del QR.")

# --- Ruta WebSocket ---
# Decisión: ¿Autenticar la conexión WebSocket? Es más complejo.
# Por ahora, la dejamos como estaba, identificando al usuario por el user_id en la URL.
# Una mejora sería requerir un token (quizás el QR token recién generado o el ID token)
# como primer mensaje tras conectar, y desconectar si no es válido.
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    # (Sin cambios respecto a la versión anterior con user_id string)
    await manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            # logger.debug(f"WS Msg from {user_id}: {data}")
    except WebSocketDisconnect:
        logger.info(f"WS desconectado limpiamente para user_id: {user_id}")
        manager.disconnect(websocket, user_id)
    except Exception as e:
        logger.error(f"Error en WS para user_id {user_id}: {e}", exc_info=True)
        manager.disconnect(websocket, user_id)

@app.get("/meetings/{meeting_id}/attendance-details", tags=["Meetings"])
async def get_meeting_attendance_details(meeting_id: str, current_user: dict = Depends(get_current_user)):
    """
    Obtiene los detalles de asistencia para una reunión específica, incluyendo
    quién asistió, quién no, y los detalles de la validación.
    """
    requesting_user_uid = current_user.get("uid")
    user_roles = current_user.get("roles", [])
    logger.info(f"Usuario {requesting_user_uid} (Roles: {user_roles}) solicitando detalles de asistencia para meeting_id: {meeting_id}")

    if not db:
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible.")

    try:
        # 1. Obtener detalles de la reunión y verificar permisos
        meeting_doc_ref = db.collection('classMeetings').document(meeting_id)
        meeting_doc = await asyncio.to_thread(meeting_doc_ref.get)
        if not meeting_doc.exists:
            raise HTTPException(status_code=404, detail="Reunión no encontrada.")
        
        meeting_data = meeting_doc.to_dict()
        section_id = meeting_data.get("sectionID")
        
        # (Aquí va tu lógica de permisos para asegurar que el usuario puede ver estos detalles)

        # 2. Obtener la lista de UIDs y nombres de estudiantes inscritos en la sección
        enrolled_student_docs_stream = await asyncio.to_thread(
            db.collection('sections').document(section_id).collection('enrolledUsers').stream
        )
        student_uids_from_enrollment: List[str] = [doc.id for doc in enrolled_student_docs_stream]

        students_details_map: Dict[str, Dict[str, Any]] = {}
        if student_uids_from_enrollment:
            batched_student_uids = [
                student_uids_from_enrollment[i:i + 30] 
                for i in range(0, len(student_uids_from_enrollment), 30)
            ]
            for batch_uids in batched_student_uids:
                if not batch_uids: continue
                users_query = db.collection('users').where('__name__', 'in', batch_uids)
                user_docs_stream = await asyncio.to_thread(users_query.stream)
                for user_doc_snapshot in user_docs_stream:
                    if user_doc_snapshot.exists:
                        user_data_from_db = user_doc_snapshot.to_dict()
                        display_name = user_data_from_db.get("displayName", user_doc_snapshot.id)
                        if not user_data_from_db.get("displayName") and user_data_from_db.get("nombres") and user_data_from_db.get("apellidos"):
                             display_name = f"{user_data_from_db.get('nombres')} {user_data_from_db.get('apellidos')}".strip()
                        students_details_map[user_doc_snapshot.id] = {"displayName": display_name}

        # 3. Obtener los registros de asistencia con sus detalles de validación
        attendance_records_query = db.collection('attendanceRecords').where('meetingID', '==', meeting_id)
        attendance_docs_stream_local = await asyncio.to_thread(attendance_records_query.stream)

        attendance_details_map: Dict[str, Dict[str, Any]] = {}
        for doc_att in attendance_docs_stream_local:
            attendance_data = doc_att.to_dict()
            attendee_uid = attendance_data.get("attendeeUID")
            if attendee_uid:
                validation_timestamp = attendance_data.get("timestamp")
                formatted_time = None
                if isinstance(validation_timestamp, datetime):
                    validation_timestamp_chile = validation_timestamp.astimezone(chile_tz)
                    formatted_time = validation_timestamp_chile.strftime('%H:%M:%S')
                
                validator_display = attendance_data.get("validatedByName") or \
                                    attendance_data.get("validatedByUID") or \
                                    "QR Scan"

                attendance_details_map[attendee_uid] = {
                    "validatedBy": validator_display,
                    "validationTimestamp": formatted_time
                }

        # 4. Construir la lista final de estudiantes para la respuesta
        students_list_for_response = []
        for student_uid in student_uids_from_enrollment:
            student_info = students_details_map.get(student_uid, {"displayName": student_uid})
            is_attended = student_uid in attendance_details_map
            attendance_record = attendance_details_map.get(student_uid)
            
            students_list_for_response.append({
                "uid": student_uid,
                "studentName": student_info.get("displayName", student_uid),
                "attended": is_attended,
                "validatedBy": attendance_record.get("validatedBy") if attendance_record else None,
                "validationTimestamp": attendance_record.get("validationTimestamp") if attendance_record else None,
            })
        
        # 5. Preparar los datos de la reunión para la respuesta final
        processed_meeting_data = {}
        if meeting_data:
            processed_meeting_data = meeting_data.copy()
            for key, value in meeting_data.items():
                if hasattr(value, 'isoformat'):
                    processed_meeting_data[key] = value.isoformat()
                elif isinstance(value, Timestamp):
                    processed_meeting_data[key] = value.ToDatetime().isoformat()
        
        # Añadimos el nombre del profesor a los detalles de la reunión
        if section_id:
            section_doc_ref = db.collection('sections').document(section_id)
            section_doc = await asyncio.to_thread(section_doc_ref.get)
            if section_doc.exists:
                section_data = section_doc.to_dict()
                professors_info = section_data.get("professorsInfo", [])
                
                # --- INICIO DE LA MODIFICACIÓN ---
                processed_meeting_data["professorName"] = ", ".join([p.get("displayName", "N/A") for p in professors_info])
                processed_meeting_data["courseName"] = section_data.get("courseName", "N/A")
                processed_meeting_data["sectionIdentifier"] = section_data.get("sectionIdentifier", "N/A")
                # --- FIN DE LA MODIFICACIÓN ---
        
        return {
            "meetingDetails": processed_meeting_data, 
            "students": students_list_for_response
        }

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error al obtener detalles de asistencia para meeting_id {meeting_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener los detalles de asistencia.")
    
@app.post("/meetings/{meeting_id}/students/{student_uid}/toggle-attendance", tags=["Meetings", "Attendance"])
async def toggle_student_attendance(
    meeting_id: str,
    student_uid: str, # El UID del estudiante cuya asistencia se va a cambiar
    current_user: dict = Depends(get_current_user) # El usuario (profesor/admin/ayudante) autenticado
):
    requesting_user_uid = current_user.get("uid")
    requesting_user_roles = current_user.get("roles", [])

    logger.info(f"Usuario {requesting_user_uid} (Roles: {requesting_user_roles}) intentando cambiar asistencia para estudiante {student_uid} en reunión {meeting_id}.")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    try:
        # 1. Obtener detalles de la reunión y su sección
        meeting_doc_ref = db.collection('classMeetings').document(meeting_id)
        meeting_doc = await asyncio.to_thread(meeting_doc_ref.get)

        if not meeting_doc.exists:
            logger.warning(f"Intento de cambiar asistencia para reunión inexistente: {meeting_id}")
            raise HTTPException(status_code=404, detail="Reunión no encontrada.")

        meeting_data = meeting_doc.to_dict()
        section_id_from_meeting = meeting_data.get("sectionID")
        is_meeting_active_for_attendance = meeting_data.get("isActiveForAttendance", False) # Verificar si la reunión está activa

        if not section_id_from_meeting:
             logger.error(f"Error de configuración: Reunión {meeting_id} no tiene un sectionID asociado.")
             raise HTTPException(status_code=500, detail="Error de configuración de la reunión, falta sectionID.")

        # Solo permitir el cambio si la reunión está activa para tomar asistencia
        if not is_meeting_active_for_attendance:
            logger.warning(f"Intento de cambiar asistencia para reunión {meeting_id} que no está activa para tomar asistencia.")
            raise HTTPException(status_code=403, detail="Esta reunión no está actualmente activa para modificar la asistencia.")


        # 2. Verificar Permisos del Usuario que realiza la acción
        can_toggle = False
        if "admin" in requesting_user_roles:
            can_toggle = True
        else:
            section_doc_for_permission_ref = db.collection('sections').document(section_id_from_meeting)
            section_doc_for_permission = await asyncio.to_thread(section_doc_for_permission_ref.get)
            if section_doc_for_permission.exists:
                section_data_for_permission = section_doc_for_permission.to_dict()
                prof_uids = section_data_for_permission.get("professorUIDs", [])
                asst_uids = section_data_for_permission.get("assistantUIDs", [])
                
                if ("profesor" in requesting_user_roles and requesting_user_uid in prof_uids) or \
                   ("ayudante" in requesting_user_roles and requesting_user_uid in asst_uids):
                    can_toggle = True
            
        if not can_toggle:
            logger.warning(f"Usuario {requesting_user_uid} (roles: {requesting_user_roles}) no autorizado para modificar asistencia de reunión {meeting_id}.")
            raise HTTPException(status_code=403, detail="No tienes permiso para modificar la asistencia de esta reunión.")

        # 3. Verificar si el estudiante (student_uid) está inscrito en la sección de esta reunión
        enrollment_ref = db.collection('sections').document(section_id_from_meeting).collection('enrolledUsers').document(student_uid)
        enrollment_doc = await asyncio.to_thread(enrollment_ref.get)
        if not enrollment_doc.exists:
            logger.warning(f"Intento de cambiar asistencia para estudiante {student_uid} no inscrito en sección {section_id_from_meeting} (reunión {meeting_id}).")
            raise HTTPException(status_code=404, detail="El estudiante especificado no está inscrito en la sección de esta clase.")

        # 4. Buscar un registro de asistencia existente para este estudiante y reunión
        attendance_query = db.collection('attendanceRecords') \
                             .where('meetingID', '==', meeting_id) \
                             .where('attendeeUID', '==', student_uid) \
                             .limit(1)

        existing_attendance_docs = await asyncio.to_thread(list, attendance_query.stream())

        new_attendance_status: bool
        action_taken: str
        attendee_name_to_store = student_uid # Fallback inicial

        if existing_attendance_docs:
            # Si ya existe, eliminar el registro de asistencia (marcar como NO asistió)
            doc_to_delete_id = existing_attendance_docs[0].id
            await asyncio.to_thread(db.collection('attendanceRecords').document(doc_to_delete_id).delete)
            new_attendance_status = False
            action_taken = "asistencia_eliminada"
            logger.info(f"Asistencia eliminada para estudiante {student_uid} en reunión {meeting_id} por usuario {requesting_user_uid}.")
            # No necesitamos el nombre para una eliminación, pero sí para la respuesta si se quisiera
            user_profile_doc_ref_for_name = db.collection('users').document(student_uid)
            user_profile_doc_for_name = await asyncio.to_thread(user_profile_doc_ref_for_name.get)
            if user_profile_doc_for_name.exists:
                user_profile_data = user_profile_doc_for_name.to_dict()
                if user_profile_data.get("displayName"):
                    attendee_name_to_store = user_profile_data["displayName"]
                elif user_profile_data.get("nombres") and user_profile_data.get("apellidos"):
                    attendee_name_to_store = f"{user_profile_data.get('nombres')} {user_profile_data.get('apellidos')}".strip()

        else:
            # Si no existe, crear un nuevo registro de asistencia (marcar como SÍ asistió)
            new_attendance_ref = db.collection('attendanceRecords').document()
                
            # Obtener el nombre del estudiante desde la colección 'users'
            try:
                user_profile_doc_ref = db.collection('users').document(student_uid)
                user_profile_doc = await asyncio.to_thread(user_profile_doc_ref.get)
                if user_profile_doc.exists:
                    user_profile_data = user_profile_doc.to_dict()
                    if user_profile_data.get("displayName"):
                        attendee_name_to_store = user_profile_data["displayName"]
                    elif user_profile_data.get("nombres") and user_profile_data.get("apellidos"):
                        attendee_name_to_store = f"{user_profile_data.get('nombres')} {user_profile_data.get('apellidos')}".strip()
                    else:
                        logger.warning(f"No se encontró 'displayName' ni 'nombres'/'apellidos' para student_uid: {student_uid} en 'users' (toggle). Usando UID.")
                else:
                    logger.warning(f"No se encontró perfil en 'users' para student_uid: {student_uid}. Usando UID como nombre (toggle).")
            except Exception as e_user_fetch:
                logger.error(f"Error al intentar obtener nombre para student_uid {student_uid} desde 'users' (toggle): {e_user_fetch}", exc_info=True)
            
            validator_name = current_user.get("name", requesting_user_uid) # Obtener nombre del validador
            # --- FIN DE LA MODIFICACIÓN ---

            await asyncio.to_thread(new_attendance_ref.set, {
                'meetingID': meeting_id,
                'sectionID': section_id_from_meeting,
                'attendeeUID': student_uid,
                'attendeeName': attendee_name_to_store,
                'timestamp': firestore.SERVER_TIMESTAMP,
                'validatedByUID': requesting_user_uid,
                'validatedByName': validator_name, # <-- AÑADIDO
                'method': "manual_toggle"
            })
# ...
            new_attendance_status = True
            action_taken = "asistencia_registrada"
            logger.info(f"Asistencia registrada (toggle) para estudiante {student_uid} (Nombre: {attendee_name_to_store}) en reunión {meeting_id} por usuario {requesting_user_uid}.")
        
        return {
            "status": action_taken,
            "attendeeUID": student_uid,
            "meetingID": meeting_id,
            "newAttendanceStatus": new_attendance_status,
            "attendeeName": attendee_name_to_store # Devolver el nombre usado/obtenido
        }

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error al cambiar asistencia para estudiante {student_uid} en reunión {meeting_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al cambiar el estado de asistencia.")
    
@app.get("/sections/{section_id}/attendance-matrix", tags=["Sections", "Attendance Matrix"])
async def get_section_attendance_matrix(
    section_id: str,
    meeting_types: Optional[List[str]] = Query(None, description="Tipos de reunión a incluir (ej: Cátedra,Ayudantía)."),
    current_user: dict = Depends(get_current_user)
):
    requesting_user_uid = current_user.get("uid")
    user_roles = current_user.get("roles", [])

    logger.info(f"Usuario {requesting_user_uid} solicitando matriz para sección {section_id} con filtros: {meeting_types}")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    try:
        # --- 1. Validar permisos y obtener detalles de la sección (sin cambios) ---
        section_doc_ref = db.collection('sections').document(section_id)
        section_doc = await asyncio.to_thread(section_doc_ref.get)
        if not section_doc.exists:
            raise HTTPException(status_code=404, detail="Sección no encontrada.")
        # ... (lógica de permisos sin cambios) ...
        section_data = section_doc.to_dict()
        section_details_for_response = {
            "sectionId": section_id,
            "courseName": section_data.get("courseName", "Curso Desconocido"),
            "sectionIdentifier": section_data.get("sectionIdentifier", "Sección Desconocida"),
            "courseID": section_data.get("courseID", "ID de Curso Desconocido"),
        }
        
        # --- INICIO DE LA CORRECCIÓN ---

        # 2. Obtener TODOS los tipos de reunión disponibles PRIMERO, sin filtros.
        all_meetings_query = db.collection('classMeetings').where('sectionID', '==', section_id)
        all_meetings_docs = await asyncio.to_thread(list, all_meetings_query.stream())
        
        all_available_meeting_types: Set[str] = set()
        for doc in all_meetings_docs:
            meeting_data = doc.to_dict()
            if meeting_data and meeting_data.get("meetingType"):
                all_available_meeting_types.add(meeting_data.get("meetingType"))
        
        logger.info(f"Tipos de reunión disponibles para la sección {section_id}: {all_available_meeting_types}")

        # 3. Ahora, crear la consulta principal, que SÍ puede estar filtrada.
        meetings_query = db.collection('classMeetings') \
                        .where('sectionID', '==', section_id) \
                        .order_by('meetingDateTime', direction=firestore.Query.ASCENDING)
        
        if meeting_types:
            meetings_query = meetings_query.where('meetingType', 'in', meeting_types)
            logger.info(f"Aplicando filtro de tipo de reunión: {meeting_types}")

        meetings_docs_stream = await asyncio.to_thread(meetings_query.stream)
        
        # --- FIN DE LA CORRECCIÓN ---

        meetings_for_response = []
        meeting_ids_set: Set[str] = set()

        for doc_meeting in meetings_docs_stream:
            meeting_item = doc_meeting.to_dict()
            if meeting_item:
                datetime_str: Optional[str] = None
                meeting_datetime_original = meeting_item.get('meetingDateTime')
                if meeting_datetime_original:
                    if hasattr(meeting_datetime_original, 'isoformat'):
                        datetime_str = meeting_datetime_original.isoformat()
                    elif isinstance(meeting_datetime_original, str):
                        datetime_str = meeting_datetime_original
                    elif isinstance(meeting_datetime_original, Timestamp):
                        datetime_str = meeting_datetime_original.ToDatetime().isoformat()
                
                meetings_for_response.append({
                    "meetingId": doc_meeting.id,
                    "meetingDateTime": datetime_str,
                    "isActiveForAttendance": meeting_item.get("isActiveForAttendance", False),
                    "meetingType": meeting_item.get("meetingType")
                })
                meeting_ids_set.add(doc_meeting.id)
        
        # ... (el resto de la lógica para estudiantes y porcentajes no necesita cambios) ...
        # ... (pegar aquí el resto de la función desde tu archivo original) ...
        enrolled_student_docs_stream = await asyncio.to_thread(
            db.collection('sections').document(section_id).collection('enrolledUsers').stream
        )
        student_uids_from_enrollment: List[str] = [enrolled_doc.id for enrolled_doc in enrolled_student_docs_stream]
        students_details_map: Dict[str, Dict[str, Any]] = {}
        if student_uids_from_enrollment:
            batched_student_uids = [
                student_uids_from_enrollment[i:i + 30] 
                for i in range(0, len(student_uids_from_enrollment), 30)
            ]
            for batch_uids in batched_student_uids:
                if not batch_uids: continue
                users_query = db.collection('users').where('__name__', 'in', batch_uids)
                user_docs_stream = await asyncio.to_thread(users_query.stream)
                for user_doc_snapshot in user_docs_stream:
                    if user_doc_snapshot.exists:
                        user_data_from_db = user_doc_snapshot.to_dict()
                        display_name = user_data_from_db.get("displayName", user_doc_snapshot.id)
                        if not user_data_from_db.get("displayName") and user_data_from_db.get("nombres") and user_data_from_db.get("apellidos"):
                            display_name = f"{user_data_from_db.get('nombres')} {user_data_from_db.get('apellidos')}".strip()
                        students_details_map[user_doc_snapshot.id] = {"displayName": display_name}
                    else:
                        students_details_map[user_doc_snapshot.id] = {"displayName": user_doc_snapshot.id}

        enrolled_students_list_for_matrix = []
        for student_uid_item in student_uids_from_enrollment:
            student_detail = students_details_map.get(student_uid_item, {"displayName": student_uid_item})
            enrolled_students_list_for_matrix.append({
                "studentUid": student_uid_item,
                "studentName": student_detail.get("displayName", student_uid_item), 
            })

        attendance_map: Dict[str, Dict[str, bool]] = {mid: {} for mid in meeting_ids_set}
        if meeting_ids_set and student_uids_from_enrollment:
            chunk_size = 30 
            for i in range(0, len(student_uids_from_enrollment), chunk_size):
                chunk_student_uids = student_uids_from_enrollment[i:i + chunk_size]
                if not chunk_student_uids: continue
                attendance_records_query = db.collection('attendanceRecords').where('sectionID', '==', section_id).where('attendeeUID', 'in', chunk_student_uids)
                attendance_docs_stream_att = await asyncio.to_thread(attendance_records_query.stream)
                for doc_attendance in attendance_docs_stream_att:
                    record = doc_attendance.to_dict()
                    meeting_id_of_record = record.get("meetingID")
                    attendee_uid_of_record = record.get("attendeeUID")
                    if meeting_id_of_record in attendance_map and attendee_uid_of_record:
                        if attendee_uid_of_record in students_details_map:
                            attendance_map[meeting_id_of_record][attendee_uid_of_record] = True

        students_attendance_for_response = []
        relevant_meetings_for_denominator = [m for m in meetings_for_response if m.get("isActiveForAttendance", False)]
        total_meetings_considered_for_percentage = len(relevant_meetings_for_denominator)
        meeting_ids_considered_for_percentage = {m['meetingId'] for m in relevant_meetings_for_denominator}
        for student_info in enrolled_students_list_for_matrix:
            student_uid = student_info["studentUid"]
            student_name = student_info["studentName"]
            attended_count = 0
            student_attendance_by_meeting: Dict[str, Optional[bool]] = {}
            for meeting_info in meetings_for_response:
                meeting_id = meeting_info["meetingId"]
                attended_this_meeting = attendance_map.get(meeting_id, {}).get(student_uid, False)
                student_attendance_by_meeting[meeting_id] = attended_this_meeting
                if meeting_id in meeting_ids_considered_for_percentage and attended_this_meeting:
                    attended_count += 1
            overall_percentage = 0
            if total_meetings_considered_for_percentage > 0:
                overall_percentage = round((attended_count / total_meetings_considered_for_percentage) * 100)
            students_attendance_for_response.append({
                "studentUid": student_uid,
                "studentName": student_name,
                "overallAttendancePercentage": overall_percentage,
                "attendanceByMeeting": student_attendance_by_meeting
            })

        # La respuesta final ahora siempre incluye todos los tipos de reunión disponibles
        return {
            "sectionDetails": section_details_for_response,
            "meetings": meetings_for_response,
            "studentsAttendance": students_attendance_for_response,
            "availableMeetingTypes": sorted(list(all_available_meeting_types))
        }

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error al obtener matriz de asistencia para section_id {section_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error interno al obtener la matriz de asistencia: {str(e)}")

@app.get("/sections-taught-by-professor", tags=["Sections"])
async def list_sections_taught_by_professor(current_user: dict = Depends(get_current_user)):
    """
    Endpoint para listar las secciones únicas enseñadas/organizadas por el profesor autenticado.
    """
    user_uid = current_user.get("uid")
    logger.info(f"Profesor {user_uid} solicitando SUS secciones desde /sections-taught-by-professor.")

    if not db:
        logger.error("Cliente de Firestore (db) no está disponible.")
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible.")

    sections_list = []
    try:
        # Consulta la colección 'sections' directamente, filtrando por 'organizerUID'
        sections_query = db.collection('sections').where('organizerUID', '==', user_uid)
        
        # Opcional: podrías querer ordenar estas secciones, por ejemplo, por courseName y luego sectionIdentifier
        # sections_query = sections_query.order_by('courseName').order_by('sectionIdentifier')
        # Si añades order_by, asegúrate de tener los índices compuestos correspondientes en Firestore.

        docs_stream = await asyncio.to_thread(sections_query.stream)

        for doc in docs_stream:
            section_data = doc.to_dict()
            if section_data:
                sections_list.append({
                    "sectionID": doc.id, # El ID del documento de la sección
                    "courseName": section_data.get("courseName", "Curso Desconocido"),
                    "sectionIdentifier": section_data.get("sectionIdentifier", "Sección Desconocida"),
                    # Puedes añadir más campos de la sección si los necesitas para mostrar
                })
        
        logger.info(f"Se encontraron {len(sections_list)} secciones organizadas por el profesor {user_uid}.")

    except Exception as e:
        logger.error(f"Error al obtener secciones de Firestore para el organizador {user_uid}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener la lista de secciones.")

    return sections_list

@app.get("/users/me/courses-with-sections", tags=["Users", "Courses", "Sections"])
async def get_my_courses_with_their_sections(current_user: dict = Depends(get_current_user)):
    user_uid = current_user.get("uid")
    user_roles = current_user.get("roles", []) # Obtener roles del usuario autenticado
    user_display_name = current_user.get("name", user_uid) # Asumiendo que 'name' es el displayName

    if not user_uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No se pudo obtener UID del token.")
    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    logger.info(f"Usuario {user_uid} (Roles: {user_roles}, Nombre: {user_display_name}) solicitando cursos con secciones.")
    
    try:
        sections_by_course_id: Dict[str, List[Dict[str, Any]]] = {}
        course_ids_from_sections: Set[str] = set()
        
        # --- INICIO DE LA LÓGICA MODIFICADA ---
        sections_query = db.collection('sections') # Query base
        
        if "admin" not in user_roles: # Si el usuario NO es admin, aplicar el filtro por profesor
            logger.info(f"Usuario {user_uid} no es admin, filtrando secciones por professorUIDs.")
            sections_query = sections_query.where('professorUIDs', 'array_contains', user_uid)
        else:
            logger.info(f"Usuario {user_uid} es admin, obteniendo todas las secciones para construir la lista de cursos.")
        # --- FIN DE LA LÓGICA MODIFICADA ---
        
        sections_stream = await asyncio.to_thread(sections_query.stream)

        for section_doc in sections_stream:
            section_data = section_doc.to_dict()
            course_id = section_data.get("courseID")

            if course_id:
                course_ids_from_sections.add(course_id)
                if course_id not in sections_by_course_id:
                    sections_by_course_id[course_id] = []
                
                # Formatear la información de profesores y ayudantes para la respuesta de la sección
                # (Esta parte es opcional si no la necesitas directamente en este endpoint)
                prof_info_display = ", ".join([p.get('displayName', 'N/A') for p in section_data.get('professorsInfo', [])])
                asst_info_display = ", ".join([a.get('displayName', 'N/A') for a in section_data.get('assistantsInfo', [])])

                sections_by_course_id[course_id].append({
                    "sectionID": section_doc.id,
                    "sectionIdentifier": section_data.get("sectionIdentifier", "N/A"),
                    "courseName": section_data.get("courseName", "Nombre de Curso Desconocido"), # Denormalizado
                    "professorsDisplay": prof_info_display if prof_info_display else "No asignados", # Opcional
                    "assistantsDisplay": asst_info_display if asst_info_display else "No asignados", # Opcional
                })
        
        if not course_ids_from_sections:
            logger.info(f"No se encontraron secciones para el usuario {user_uid} (o el admin no encontró secciones en el sistema).")
            return []

        # Obtener los detalles de los cursos
        # (La lógica para obtener los documentos de 'courses' y construir 'courses_data_list'
        #  puede permanecer igual que la tenías, ya que se basa en 'course_ids_from_sections')
        
        # Creamos una lista de tareas para obtener los documentos de cursos en paralelo
        course_docs_futures = [asyncio.to_thread(db.collection('courses').document(cid).get) for cid in list(course_ids_from_sections)]
        retrieved_course_docs = await asyncio.gather(*course_docs_futures)
        
        courses_data_list = []

        for course_doc in retrieved_course_docs:
            if course_doc.exists:
                course_data = course_doc.to_dict()
                course_id_val = course_doc.id 
                               
                # Filtrar las secciones que realmente pertenecen a este curso para la respuesta final
                # Usamos los datos ya procesados en sections_by_course_id
                course_sections_for_response = []
                for section_item in sections_by_course_id.get(course_id_val, []):
                    course_sections_for_response.append({
                        "sectionID": section_item["sectionID"],
                        "sectionIdentifier": section_item["sectionIdentifier"],
                        "courseName": section_item["courseName"] # Ya estaba denormalizado
                    })

                if course_sections_for_response: # Solo añadir el curso si tiene secciones relevantes para el usuario
                    courses_data_list.append({
                        "courseID": course_id_val,
                        "courseName": course_data.get("courseName", "Curso Desconocido"),
                        "description": course_data.get("description", ""),
                        "sections": sorted(
                            course_sections_for_response, 
                            key=lambda s: s.get("sectionIdentifier", "")
                        )
                    })
        
        courses_data_list.sort(key=lambda c: c.get("courseName", ""))
        logger.info(f"Devolviendo {len(courses_data_list)} cursos con sus secciones para el usuario {user_uid}.")
        return courses_data_list

    except Exception as e:
        logger.error(f"Error al obtener cursos y secciones para el usuario {user_uid}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error interno al obtener los datos de cursos y secciones: {str(e)}")
    
# --- Modelo Pydantic para la creación de un curso ---
class CourseCreate(BaseModel):
    courseCode: str = Field(..., title="Código del Curso", description="Ej: CALC101, INF230", min_length=3, max_length=20)
    courseName: str = Field(..., title="Nombre del Curso", description="Ej: Cálculo 1, Ingeniería de Software", min_length=3, max_length=100)
    description: Optional[str] = Field(None, title="Descripción del Curso", max_length=500)
    # No incluimos organizerUID aquí, ya que la creación de un curso
    # podría ser una tarea más administrativa o el organizador se asigna al crear secciones.
    # Si un curso siempre es creado por un profesor específico que se vuelve su "dueño", podrías añadirlo.

class CourseResponse(CourseCreate): # Modelo para la respuesta, puede incluir el ID
    id: str = Field(..., title="ID del Curso en Firestore")
    createdAt: Optional[Any] = Field(None, title="Timestamp de creación") # Firestore timestamp

# --- Nuevo Endpoint para Crear Curso ---
@app.post("/courses", response_model=CourseResponse, status_code=status.HTTP_201_CREATED, tags=["Courses"])
async def create_course(
    course_data: CourseCreate, 
    current_user: dict = Depends(get_current_user) # Asegurar que solo usuarios autenticados puedan crear
):
    user_uid = current_user.get("uid")
    user_email = current_user.get("email", "N/A") # Para logging

    logger.info(f"Usuario {user_email} (UID: {user_uid}) intentando crear curso: {course_data.courseName}")

    if not db:
        logger.error("Error crítico: Cliente de Firestore (db) no está disponible en create_course.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    # Validaciones adicionales (opcional, pero recomendado)
    # Verificar si ya existe un curso con el mismo courseCode (si courseCode debe ser único)
    try:
        # Usar el courseCode como ID del documento y verificar si ya existe
        doc_id_for_course = course_data.courseCode
        new_course_ref = db.collection('courses').document(doc_id_for_course)
        existing_doc = await asyncio.to_thread(new_course_ref.get)
        if existing_doc.exists:
            logger.warning(f"Intento de crear curso con código duplicado: {course_data.courseCode}")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un curso con el código '{course_data.courseCode}'.",
            )

        course_to_save = course_data.model_dump()  # Usar model_dump() para Pydantic v2+
        course_to_save['createdAt'] = firestore.SERVER_TIMESTAMP
        course_to_save['createdByUID'] = user_uid  # Guardar quién creó el curso

        await asyncio.to_thread(new_course_ref.set, course_to_save)

        created_course_data_for_response = {
            "id": new_course_ref.id,  # new_course_ref.id será igual a doc_id_for_course
            **course_data.model_dump(),
        }
        logger.info(f"Curso '{course_data.courseName}' (ID: {new_course_ref.id}) creado exitosamente por {user_email}.")

        return CourseResponse(**created_course_data_for_response)

    except HTTPException as http_exc:  # Relanzar excepciones HTTP que ya manejamos (como el 409)
        raise http_exc
    except Exception as e:
        logger.error(f"Error al crear el curso '{course_data.courseName}' en Firestore: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ocurrió un error inesperado al crear el curso: {str(e)}",
        )

# --- Nuevo Endpoint para Eliminar Curso (y sus datos asociados) ---
@app.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Courses", "Admin"])
async def delete_course_and_associated_data(
    course_id: str,
    current_user: dict = Depends(get_current_user)
):
    user_uid = current_user.get("uid")
    user_email = current_user.get("email", "N/A")
    user_roles = current_user.get("roles", []) # Obtener array de roles

    logger.info(f"Usuario {user_email} (UID: {user_uid}, Roles: {user_roles}) intentando eliminar curso ID: {course_id}")

    # --- VERIFICACIÓN DE ROL ---
    if "admin" not in user_roles: # Verificar si 'admin' está en la lista de roles
        logger.warning(f"User {user_uid} (roles: {user_roles}) NO AUTORIZADO para eliminar curso {course_id}.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para eliminar cursos."
        )
    
    if not db:
        logger.error("Error crítico: Cliente de Firestore (db) no está disponible en delete_course.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    try:
        course_ref = db.collection('courses').document(course_id)
        course_doc = await asyncio.to_thread(course_ref.get)

        if not course_doc.exists:
            logger.warning(f"Intento de eliminar curso inexistente: {course_id}")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Curso con ID '{course_id}' no encontrado.")

        # Opcional: Verificar permisos (ej. solo el creador o un admin puede eliminar)
        # course_data = course_doc.to_dict()
        # if course_data.get("createdByUID") != user_uid and not current_user.get("isAdmin", False): # Asumiendo un rol de admin
        #     logger.warning(f"Usuario {user_uid} no autorizado para eliminar curso {course_id}")
        #     raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para eliminar este curso.")

        # Iniciar un batch de Firestore para realizar múltiples eliminaciones atómicamente (o al menos agruparlas)
        batch = db.batch()

        # 1. Encontrar y eliminar secciones asociadas (y sus subcolecciones)
        sections_query = db.collection('sections').where('courseID', '==', course_id)
        sections_stream = await asyncio.to_thread(sections_query.stream)
        
        section_ids_to_delete = []
        for section_doc in sections_stream:
            logger.info(f"Marcando para eliminar sección: {section_doc.id} del curso {course_id}")
            section_ids_to_delete.append(section_doc.id)
            
            # Eliminar subcolección 'enrolledUsers' de la sección
            enrolled_users_ref = section_doc.reference.collection('enrolledUsers')
            enrolled_users_stream = await asyncio.to_thread(enrolled_users_ref.stream)
            for enrolled_user_doc in enrolled_users_stream:
                logger.debug(f"  Marcando para eliminar enrolledUser: {enrolled_user_doc.id} de sección {section_doc.id}")
                batch.delete(enrolled_user_doc.reference)
            
            batch.delete(section_doc.reference) # Eliminar el documento de la sección

        # 2. Encontrar y eliminar classMeetings asociadas a las secciones (o directamente al curso si se tiene courseID en classMeetings)
        #    Si tienes muchos section_ids, una query 'in' tiene límites (30). Podrías necesitar múltiples batches o queries.
        if section_ids_to_delete:
            # Dividir section_ids_to_delete en chunks de 30 si es necesario para la query 'in'
            chunk_size = 30
            for i in range(0, len(section_ids_to_delete), chunk_size):
                chunk_section_ids = section_ids_to_delete[i:i + chunk_size]
                meetings_query = db.collection('classMeetings').where('sectionID', 'in', chunk_section_ids)
                meetings_stream = await asyncio.to_thread(meetings_query.stream)
                
                meeting_ids_to_delete_for_attendance = []
                for meeting_doc in meetings_stream:
                    logger.info(f"Marcando para eliminar classMeeting: {meeting_doc.id}")
                    meeting_ids_to_delete_for_attendance.append(meeting_doc.id)
                    batch.delete(meeting_doc.reference)
                
                # 3. Encontrar y eliminar attendanceRecords asociados a las classMeetings
                if meeting_ids_to_delete_for_attendance:
                    for j in range(0, len(meeting_ids_to_delete_for_attendance), chunk_size):
                        chunk_meeting_ids = meeting_ids_to_delete_for_attendance[j:j + chunk_size]
                        attendance_query = db.collection('attendanceRecords').where('meetingID', 'in', chunk_meeting_ids)
                        attendance_stream = await asyncio.to_thread(attendance_query.stream)
                        for attendance_doc in attendance_stream:
                            logger.debug(f"  Marcando para eliminar attendanceRecord: {attendance_doc.id}")
                            batch.delete(attendance_doc.reference)
        
        # 4. Finalmente, eliminar el curso mismo
        batch.delete(course_ref)
        logger.info(f"Marcando para eliminar curso: {course_id}")

        # Ejecutar el batch
        await asyncio.to_thread(batch.commit)
        
        logger.info(f"Curso '{course_id}' y sus datos asociados eliminados exitosamente por {user_email}.")
        # No se devuelve cuerpo en una respuesta 204 No Content

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error al eliminar el curso '{course_id}' y sus datos asociados: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ocurrió un error inesperado al eliminar el curso: {str(e)}",
        )
    
class CourseBasicInfo(BaseModel): # Modelo Pydantic para la info básica del curso
    id: str
    courseName: str
    # courseCode: str # No es necesario si id es el courseCode

@app.get("/courses/all", response_model=List[CourseBasicInfo], tags=["Courses", "Admin"])
async def list_all_courses_for_admin(
    current_user: dict = Depends(get_current_user)
):
    user_roles = current_user.get("roles", [])
    logger.info(f"User {current_user.get('uid')} with roles {user_roles} requesting all courses.")

    # --- VERIFICACIÓN DE ROL ---
    if "admin" not in user_roles: 
        logger.warning(f"User {current_user.get('uid')} (roles: {user_roles}) NO AUTORIZADO. Se requiere el rol 'admin'.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes los permisos necesarios para realizar esta acción."
    )

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")
    
    courses_list = []
    try:
        # --- INICIO DE LA CORRECCIÓN ---
        def get_courses_sync():
            # Esta función síncrona se ejecutará en el hilo de asyncio
            _courses = []
            # Aquí .stream() devuelve un generador que se itera síncronamente
            documents = db.collection('courses').order_by("courseName").stream() 
            for doc in documents:
                data = doc.to_dict()
                _courses.append({
                    "id": doc.id,
                    "courseName": data.get("courseName", "Nombre no disponible"),
                })
            return _courses

        courses_list = await asyncio.to_thread(get_courses_sync)
        # --- FIN DE LA CORRECCIÓN ---
        
        logger.info(f"Admin {current_user.get('uid')} listó {len(courses_list)} cursos.")
        return courses_list
    except Exception as e:
        logger.error(f"Error al listar todos los cursos para admin: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error al obtener la lista de cursos.")

class WeeklyScheduleItem(BaseModel):
    dayOfWeek: str = Field(...)
    startTime: str = Field(...)
    endTime: str = Field(...)
    location: Optional[str] = Field(None)
    meetingType: str = Field(..., description="Ej: Cátedra, Ayudantía")

class UserAssignment(BaseModel):
    uid: str = Field(..., description="UID del usuario (profesor o ayudante)")
    displayName: str = Field(..., description="Nombre para mostrar del usuario")

class SectionCreate(BaseModel):
    courseID: str = Field(..., description="ID del curso al que pertenece la sección.")
    courseName: str = Field(..., description="Nombre del curso (denormalizado).")
    professors: List[UserAssignment] = Field(..., description="Lista de profesores asignados. Debe haber al menos uno.")
    assistants: Optional[List[UserAssignment]] = Field(None, description="Lista opcional de ayudantes asignados.")
    sectionIdentifier: str = Field(..., description="Identificador de la sección.")
    weeklySchedule: List[WeeklyScheduleItem] = Field(..., description="Horario semanal de la sección.") # Asumo que WeeklyScheduleItem ya está definido

class SectionResponse(BaseModel): # Ajusta según lo que devuelvas
    id: str = Field(..., title="ID de la Sección en Firestore")
    courseID: str
    courseName: str
    sectionIdentifier: str
    professors: List[UserAssignment] # Devolver la lista de profesores
    assistants: Optional[List[UserAssignment]] = None # Devolver la lista de ayudantes
    weeklySchedule: List[WeeklyScheduleItem]
    createdAt: Optional[Any] = Field(None, title="Timestamp de creación")

@app.post("/sections", response_model=SectionResponse, status_code=status.HTTP_201_CREATED, tags=["Sections", "Admin"])
async def create_section(
    section_data: SectionCreate, # Usa el nuevo SectionCreate
    current_user: dict = Depends(get_current_user)
):
    user_uid_performing_action = current_user.get("uid")
    user_email_performing_action = current_user.get("email", "N/A")
    user_roles = current_user.get("roles", []) 

    logger.info(f"Usuario {user_email_performing_action} (Roles: {user_roles}) intentando crear sección: {section_data.sectionIdentifier} para curso {section_data.courseName}")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    if "admin" not in user_roles: 
        logger.warning(f"User {current_user.get('uid')} (roles: {user_roles}) NO AUTORIZADO. Se requiere el rol 'admin'.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes los permisos necesarios para realizar esta acción."
    )

    # --- INICIO DE CAMBIOS ---
    if not section_data.professors: # Validar que haya al menos un profesor
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Se debe asignar al menos un profesor a la sección.")

    # Validar existencia del curso
    course_ref = db.collection('courses').document(section_data.courseID)
    course_doc = await asyncio.to_thread(course_ref.get)
    if not course_doc.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"El curso con ID '{section_data.courseID}' no existe.")

    # Validar existencia de todos los profesores asignados
    for prof_assignment in section_data.professors:
        prof_ref = db.collection('users').document(prof_assignment.uid)
        prof_doc = await asyncio.to_thread(prof_ref.get)
        if not prof_doc.exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"El profesor con UID '{prof_assignment.uid}' ({prof_assignment.displayName}) no existe.")
        # Opcional: verificar rol del profesor si es necesario
        # prof_data = prof_doc.to_dict()
        # if prof_data.get('role') not in ['profesor', 'admin']:
        #     raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"El usuario {prof_assignment.displayName} no tiene el rol de profesor o admin.")


    # Validar existencia de todos los ayudantes asignados (si los hay)
    if section_data.assistants:
        for asst_assignment in section_data.assistants:
            asst_ref = db.collection('users').document(asst_assignment.uid)
            asst_doc = await asyncio.to_thread(asst_ref.get)
            if not asst_doc.exists:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"El ayudante con UID '{asst_assignment.uid}' ({asst_assignment.displayName}) no existe.")
            # Opcional: verificar rol del ayudante

    # Verificar si la sección ya existe (courseID + sectionIdentifier)
    try:
        existing_section_query = db.collection('sections') \
                                   .where(field_path='courseID', op_string='==', value=section_data.courseID) \
                                   .where(field_path='sectionIdentifier', op_string='==', value=section_data.sectionIdentifier) \
                                   .limit(1)
        docs = await asyncio.to_thread(list, existing_section_query.stream())
        if docs:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Ya existe la sección '{section_data.sectionIdentifier}' para el curso '{section_data.courseName}'.")
    except Exception as e_query:
        logger.error(f"Error al verificar existencia de sección: {e_query}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error al verificar datos de la sección.")

    try:
        new_section_ref = db.collection('sections').document()
        
        professor_uids_list = [p.uid for p in section_data.professors]
        assistant_uids_list = [a.uid for a in section_data.assistants] if section_data.assistants else []

        # Prepara los datos para guardar en Firestore
        section_to_save = {
            "courseID": section_data.courseID,
            "courseName": section_data.courseName, # Denormalizado
            "sectionIdentifier": section_data.sectionIdentifier,
            "professorsInfo": [p.model_dump() for p in section_data.professors], # Guardar {uid, displayName}
            "professorUIDs": professor_uids_list, # Array de UIDs para query
            "assistantsInfo": [a.model_dump() for a in section_data.assistants] if section_data.assistants else [],
            "assistantUIDs": assistant_uids_list,
            "weeklySchedule": [item.model_dump() for item in section_data.weeklySchedule],
            "createdAt": firestore.SERVER_TIMESTAMP,
            "createdByUID": user_uid_performing_action # Quién creó la sección (admin)
        }
        # --- FIN DE CAMBIOS ---

        await asyncio.to_thread(new_section_ref.set, section_to_save)
        
        # Construir la respuesta
        response_data = {
            "id": new_section_ref.id,
            **section_data.model_dump(), # Esto ya incluye professors y assistants como listas de UserAssignment
            # "createdAt": "pending" # Firestore SERVER_TIMESTAMP no estará disponible inmediatamente
        }

        logger.info(f"Sección '{section_data.sectionIdentifier}' (ID: {new_section_ref.id}) para curso '{section_data.courseName}' creada.")
        return SectionResponse(**response_data)

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error al crear la sección '{section_data.sectionIdentifier}': {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Ocurrió un error inesperado al crear la sección: {str(e)}")
    
class UserBasicInfo(BaseModel): # Similar a tu UserForListing
    uid: str
    displayName: str
    email: Optional[str] = None
    roles: Optional[List[str]] = None

@app.get("/users/by-role", response_model=List[UserBasicInfo], tags=["Users", "Admin"])
async def get_users_by_role(
    roles: Optional[str] = Query(None, description="Lista de roles separados por coma (ej: admin,profesor)"),
    current_user: dict = Depends(get_current_user)
):
    requesting_user_roles = current_user.get("roles", [])

    logger.info(f"User {current_user.get('uid')} with roles {requesting_user_roles} requesting users by roles: {roles}.")

    allowed_roles_for_this_endpoint = ["admin", "profesor"]
    if not any(role in requesting_user_roles for role in allowed_roles_for_this_endpoint):
        logger.warning(f"User {current_user.get('uid')} (roles: {requesting_user_roles}) no autorizado para /users/by-role. Se requiere uno de: {allowed_roles_for_this_endpoint}.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes los permisos necesarios para listar usuarios de esta manera.")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")
    
    users_list_response = []
    try:
        query = db.collection('users')
        
        # roles_query_param es la variable que contiene los roles solicitados en la URL
        roles_query_param = roles 

        if roles_query_param:
            # Normalizar roles a minúsculas para la query, si así los guardas en Firestore
            # Si tus roles en Firestore son sensibles a mayúsculas/minúsculas y consistentes, no necesitas .lower()
            role_list_for_query = [role.strip() for role in roles_query_param.split(',') if role.strip()]
            
            if role_list_for_query:
                logger.info(f"Filtrando usuarios que contengan alguno de los roles: {role_list_for_query}")
                # --- INICIO DE CORRECCIÓN EN LA CONSULTA DE FIRESTORE ---
                query = query.where('roles', 'array_contains_any', role_list_for_query) # <--- CORREGIDO con guion bajo
                # --- FIN DE CORRECCIÓN EN LA CONSULTA DE FIRESTORE ---
            else: 
                logger.info("Parámetro 'roles' recibido pero vacío después de procesar, no se aplicará filtro de rol específico.")
                # Si se proporcionó `roles` pero estaba vacío (ej. `roles=, ,`), podría devolver todos los usuarios o ninguno.
                # Por ahora, si role_list_for_query está vacía, la query no se modifica más, devolviendo todos los usuarios.
                # Si quieres que devuelva una lista vacía en este caso, puedes hacer:
                # if not role_list_for_query: return []
        else:
            logger.info("No se especificaron roles en el query param, listando todos los usuarios (para admin).")

        # Considera si 'order_by("displayName")' requiere un índice compuesto con 'roles' después del cambio.
        # Firestore te lo indicará con un error si es necesario.
        documents = await asyncio.to_thread(
            lambda: list(query.order_by("displayName").stream())
        )
        
        for doc in documents:
            data = doc.to_dict()
            users_list_response.append({ # Usar la variable renombrada
                "uid": doc.id,
                "displayName": data.get("displayName", "Nombre no disponible"),
                "email": data.get("email"), 
                "roles": data.get("roles", []) # Devolver el array de roles del documento
            })
        
        logger.info(f"Devolviendo {len(users_list_response)} usuarios para la solicitud de roles: {roles_query_param}")
        return users_list_response
    except Exception as e:
        logger.error(f"Error CRÍTICO al listar usuarios por rol ({roles_query_param}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error interno al obtener la lista de usuarios: {str(e)}")

@app.delete("/sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Sections", "Admin"])
async def delete_section_and_associated_data(
    section_id: str,
    current_user: dict = Depends(get_current_user)
):
    user_uid = current_user.get("uid")
    user_email = current_user.get("email", "N/A")
    user_roles = current_user.get("roles", []) 

    logger.info(f"Usuario {user_email} (UID: {user_uid}, Roles: {user_roles}) intentando eliminar sección ID: {section_id}")

    if "admin" not in user_roles: # Verificar si 'admin' está en la lista de roles
        logger.warning(f"Usuario {user_uid} (roles: {user_roles}) NO AUTORIZADO para eliminar sección {section_id}.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para eliminar secciones.")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    try:
        section_ref = db.collection('sections').document(section_id)
        section_doc = await asyncio.to_thread(section_ref.get)

        if not section_doc.exists:
            logger.warning(f"Intento de eliminar sección inexistente: {section_id}")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Sección con ID '{section_id}' no encontrada.")

        # Opcional: Verificar si el admin tiene algún permiso específico sobre el curso de esta sección si es necesario.
        # section_data = section_doc.to_dict()
        # course_id_of_section = section_data.get("courseID")
        # Aquí podrías verificar si el admin tiene permisos sobre course_id_of_section si tu lógica lo requiere.

        batch = db.batch()

        # 1. Eliminar subcolección 'enrolledUsers' de la sección
        enrolled_users_ref = section_ref.collection('enrolledUsers')
        enrolled_users_stream = await asyncio.to_thread(enrolled_users_ref.stream)
        for enrolled_user_doc in enrolled_users_stream:
            logger.debug(f"  Marcando para eliminar enrolledUser: {enrolled_user_doc.id} de sección {section_id}")
            batch.delete(enrolled_user_doc.reference)
            
        # 2. Encontrar y eliminar classMeetings asociadas a esta sección
        meetings_query = db.collection('classMeetings').where('sectionID', '==', section_id)
        meetings_stream = await asyncio.to_thread(meetings_query.stream)
        
        meeting_ids_to_delete_for_attendance = []
        for meeting_doc in meetings_stream:
            logger.info(f"Marcando para eliminar classMeeting: {meeting_doc.id} de sección {section_id}")
            meeting_ids_to_delete_for_attendance.append(meeting_doc.id)
            batch.delete(meeting_doc.reference)
        
        # 3. Encontrar y eliminar attendanceRecords asociados a las classMeetings
        if meeting_ids_to_delete_for_attendance:
            # Firestore 'in' query tiene un límite de 30 IDs. Si hay más, dividir en chunks.
            chunk_size = 30 
            for i in range(0, len(meeting_ids_to_delete_for_attendance), chunk_size):
                chunk_meeting_ids = meeting_ids_to_delete_for_attendance[i:i + chunk_size]
                attendance_query = db.collection('attendanceRecords').where('meetingID', 'in', chunk_meeting_ids)
                attendance_stream = await asyncio.to_thread(attendance_query.stream)
                for attendance_doc in attendance_stream:
                    logger.debug(f"  Marcando para eliminar attendanceRecord: {attendance_doc.id}")
                    batch.delete(attendance_doc.reference)
        
        # 4. Finalmente, eliminar la sección misma
        batch.delete(section_ref)
        logger.info(f"Marcando para eliminar sección: {section_id}")

        await asyncio.to_thread(batch.commit)
        
        logger.info(f"Sección '{section_id}' y sus datos asociados eliminados exitosamente por admin {user_email}.")
        # No se devuelve cuerpo en una respuesta 204 No Content

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error al eliminar la sección '{section_id}' y sus datos asociados: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ocurrió un error inesperado al eliminar la sección: {str(e)}",
        )

class ClassMeetingCreateBatch(BaseModel):
    sectionID: str = Field(...)
    startDate: str = Field(..., description="Fecha de inicio del rango para generar meetings (YYYY-MM-DD)")
    endDate: str = Field(..., description="Fecha de fin del rango para generar meetings (YYYY-MM-DD)")
    # Los siguientes campos son opcionales si se pueden heredar de la sección o si son los mismos para todas las meetings generadas
    location: Optional[str] = Field(None)
    organizerUID: Optional[str] = Field(None) # UID del profesor, usualmente el de la sección
    #meetingType: str = Field(..., description="Ej: Cátedra, Ayudantía, Laboratorio")
    isActiveForAttendance: bool = False # Por defecto, las meetings creadas no están activas para asistencia

class ClassMeetingBasicResponse(BaseModel): # Para la respuesta de cada meeting creada
    id: str
    sectionID: str
    meetingDateTime: Any # Firestore Timestamp o string ISO
    endTime: Any
    location: Optional[str]
    organizerUID: str
    courseName: Optional[str] = None # Denormalizado
    sectionIdentifier: Optional[str] = None # Denormalizado
    meetingType: str
    isActiveForAttendance: bool

@app.post("/class-meetings/batch", response_model=List[ClassMeetingBasicResponse], status_code=status.HTTP_201_CREATED, tags=["ClassMeetings", "Admin"])
async def create_class_meetings_batch(
    data: ClassMeetingCreateBatch, 
    current_user: dict = Depends(get_current_user)
):
    user_uid_requesting = current_user.get("uid")
    user_roles_requesting = current_user.get("roles", []) 

    logger.info(f"Usuario {user_uid_requesting} (Roles: {user_roles_requesting}) intentando crear batch de classMeetings para sección {data.sectionID}")

    # ... (validaciones de permisos, fechas, etc. existentes) ...
    allowed_roles_for_meeting_management = ["admin", "profesor"] # O los roles que definas
    if not any(role in user_roles_requesting for role in allowed_roles_for_meeting_management):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para gestionar reuniones de clase.")
    
    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")

    try:
        start_date = datetime.strptime(data.startDate, "%Y-%m-%d").date()
        end_date = datetime.strptime(data.endDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Formato de fecha inválido. Usar YYYY-MM-DD.")

    if start_date > end_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La fecha de inicio no puede ser posterior a la fecha de fin.")


    section_ref = db.collection('sections').document(data.sectionID)
    section_doc = await asyncio.to_thread(section_ref.get)
    if not section_doc.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Sección con ID '{data.sectionID}' no encontrada.")
    
    section_data = section_doc.to_dict()
    weekly_schedule = section_data.get("weeklySchedule", [])
    if not weekly_schedule:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La sección no tiene un horario semanal definido.")

    # --- OBTENER PROFESORES Y AYUDANTES DE LA SECCIÓN ---
    section_professors_uids = section_data.get("professorUIDs", [])
    section_assistants_uids = section_data.get("assistantUIDs", [])
    # --- FIN OBTENER ---

    final_organizer_uid = data.organizerUID or (section_professors_uids[0] if section_professors_uids else None) # Usar el primer profesor como organizador por defecto si no se especifica
    if not final_organizer_uid: # Asegurarse de que siempre haya un organizador principal
        # Esto podría pasar si data.organizerUID no se provee y section_professors_uids está vacío.
        # Necesitas decidir cómo manejar esto: ¿error, o asignar al admin que crea?
        # Por ahora, vamos a asumir que una sección siempre tendrá al menos un profesor.
        # O podrías hacer que el UID del usuario que crea la reunión sea el organizador por defecto.
        logger.warning(f"No se pudo determinar un organizerUID para las reuniones de la sección {data.sectionID}. Usando el UID del solicitante: {user_uid_requesting}")
        final_organizer_uid = user_uid_requesting


    created_meetings_info = []
    batch_firestore = db.batch()
    days_map = {"LUNES": 0, "MARTES": 1, "MIÉRCOLES": 2, "JUEVES": 3, "VIERNES": 4, "SÁBADO": 5, "DOMINGO": 6}
    chile_tz = pytz.timezone('America/Santiago')

    current_date_iter = start_date
    while current_date_iter <= end_date:
        day_of_week_str = list(days_map.keys())[list(days_map.values()).index(current_date_iter.weekday())].upper()

        for schedule_item in weekly_schedule:
            if schedule_item.get("dayOfWeek", "").upper() == day_of_week_str:
                try:
                    start_hour, start_minute = map(int, schedule_item.get("startTime", "00:00").split(':'))
                    end_hour, end_minute = map(int, schedule_item.get("endTime", "00:00").split(':'))
                    # --- OBTENER MEETINGTYPE DEL HORARIO DE LA SECCIÓN ---
                    meeting_type_from_schedule = schedule_item.get("meetingType")
                    if not meeting_type_from_schedule: 
                        logger.warning(f"meetingType no definido en schedule_item: {schedule_item} para sección {data.sectionID}. Usando 'Otro'.")
                        meeting_type_from_schedule = "Otro" # O un valor por defecto o lanzar error
                except ValueError:
                    logger.warning(f"Formato de hora inválido en weeklySchedule para sección {data.sectionID}: {schedule_item}")
                    continue 

                meeting_datetime_obj_naive = datetime.combine(current_date_iter, py_time(start_hour, start_minute))
                meeting_endtime_obj_naive = datetime.combine(current_date_iter, py_time(end_hour, end_minute))
                meeting_datetime_obj_aware_chile = chile_tz.localize(meeting_datetime_obj_naive)
                meeting_endtime_obj_aware_chile = chile_tz.localize(meeting_endtime_obj_naive)
                
                meeting_doc_ref = db.collection('classMeetings').document()
                
                # --- LÓGICA PARA DEFINIR responsibleUIDs ---
                responsible_uids_set = set(section_professors_uids) # Inicia con los profesores
                if meeting_type_from_schedule.upper() == "AYUDANTÍA": # Comparación insensible a mayúsculas
                    responsible_uids_set.update(section_assistants_uids)
                # --- FIN LÓGICA responsibleUIDs ---

                meeting_payload = {
                    "sectionID": data.sectionID,
                    "courseID": section_data.get("courseID"), 
                    "meetingDateTime": meeting_datetime_obj_aware_chile,
                    "endTime": meeting_endtime_obj_aware_chile,        
                    "location": data.location or schedule_item.get("location"), 
                    "organizerUID": final_organizer_uid, # El organizador principal/creador
                    "meetingType": meeting_type_from_schedule, # Usar el tipo del schedule de la sección
                    "isActiveForAttendance": data.isActiveForAttendance,
                    "responsibleUIDs": list(responsible_uids_set), # Guardar la lista de responsables
                    "createdAt": firestore.SERVER_TIMESTAMP # type: ignore
                }
                batch_firestore.set(meeting_doc_ref, meeting_payload)
                
                created_meetings_info.append({
                    "id": meeting_doc_ref.id,
                    "sectionID": data.sectionID,
                    "courseID": section_data.get("courseID"),
                    "meetingDateTime": meeting_datetime_obj_aware_chile, 
                    "endTime": meeting_endtime_obj_aware_chile,         
                    "location": meeting_payload["location"],
                    "organizerUID": final_organizer_uid,
                    "meetingType": meeting_type_from_schedule,
                    "isActiveForAttendance": data.isActiveForAttendance,
                    # "responsibleUIDs": list(responsible_uids_set) # Opcional en respuesta
                })
        current_date_iter += timedelta(days=1)

    if not created_meetings_info:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No se generaron reuniones para el rango de fechas y horario especificado.")

    await asyncio.to_thread(batch_firestore.commit)
    logger.info(f"Batch de {len(created_meetings_info)} classMeetings creado para sección {data.sectionID}.")
    
    return [ClassMeetingBasicResponse(**info) for info in created_meetings_info]

class SingleClassMeetingCreate(BaseModel):
    sectionID: str = Field(...)
    meetingDateTime: datetime # Changed from Any to datetime
    endTime: datetime         # Changed from Any to datetime
    location: Optional[str] = Field(None)
    organizerUID: Optional[str] = Field(None)
    meetingType: str = Field(...)
    isActiveForAttendance: bool = Field(False)

# Puedes reutilizar ClassMeetingBasicResponse para la respuesta o crear una específica

@app.post("/class-meetings/single", response_model=ClassMeetingBasicResponse, status_code=status.HTTP_201_CREATED, tags=["ClassMeetings", "Admin"])
async def create_single_class_meeting(
    data: SingleClassMeetingCreate, # Este modelo debe incluir 'meetingType'
    current_user: dict = Depends(get_current_user)
):
    user_uid_requesting = current_user.get("uid")
    user_roles_requesting = current_user.get("roles", []) 

    logger.info(f"Usuario {user_uid_requesting} (Roles: {user_roles_requesting}) intentando crear una classMeeting individual para sección {data.sectionID} de tipo {data.meetingType}")

    # ... (validaciones de permisos existentes) ...
    allowed_roles_for_meeting_management = ["admin", "profesor"]
    if not any(role in user_roles_requesting for role in allowed_roles_for_meeting_management):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para gestionar reuniones de clase.")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")

    section_ref = db.collection('sections').document(data.sectionID)
    section_doc = await asyncio.to_thread(section_ref.get)
    if not section_doc.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Sección con ID '{data.sectionID}' no encontrada.")
    section_data = section_doc.to_dict()

    # --- OBTENER PROFESORES Y AYUDANTES DE LA SECCIÓN ---
    section_professors_uids = section_data.get("professorUIDs", [])
    section_assistants_uids = section_data.get("assistantUIDs", [])
    # --- FIN OBTENER ---

    final_organizer_uid = data.organizerUID or (section_professors_uids[0] if section_professors_uids else user_uid_requesting)
    
    # ... (validación de organizerUID si se provee, como en tu código original) ...
    if data.organizerUID: # Si se especifica un organizador, verificar que exista (opcional pero buena práctica)
        organizer_ref = db.collection('users').document(data.organizerUID)
        organizer_doc = await asyncio.to_thread(organizer_ref.get)
        if not organizer_doc.exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"El profesor especificado con UID '{data.organizerUID}' no existe.")


    chile_tz = pytz.timezone('America/Santiago')
    utc_meeting_dt = data.meetingDateTime
    utc_end_dt = data.endTime
    if utc_meeting_dt.tzinfo is None: utc_meeting_dt = pytz.utc.localize(utc_meeting_dt)
    if utc_end_dt.tzinfo is None: utc_end_dt = pytz.utc.localize(utc_end_dt)
    meeting_dt_chile = utc_meeting_dt.astimezone(chile_tz)
    end_dt_chile = utc_end_dt.astimezone(chile_tz)

    try:
        meeting_doc_ref = db.collection('classMeetings').document()
        
        # --- LÓGICA PARA DEFINIR responsibleUIDs ---
        responsible_uids_set = set(section_professors_uids) # Inicia con los profesores
        if data.meetingType.upper() == "AYUDANTÍA": # Comparación insensible a mayúsculas
            responsible_uids_set.update(section_assistants_uids)
        # --- FIN LÓGICA responsibleUIDs ---

        meeting_payload = {
            "sectionID": data.sectionID,
            "courseID": section_data.get("courseID"), 
            "meetingDateTime": meeting_dt_chile, 
            "endTime": end_dt_chile,            
            "location": data.location,
            "organizerUID": final_organizer_uid,
            "meetingType": data.meetingType, # Usar el tipo de la solicitud
            "isActiveForAttendance": data.isActiveForAttendance,
            "responsibleUIDs": list(responsible_uids_set), # Guardar la lista de responsables
            "createdAt": firestore.SERVER_TIMESTAMP # type: ignore
        }

        await asyncio.to_thread(meeting_doc_ref.set, meeting_payload)
        
        response_object_for_pydantic = ClassMeetingBasicResponse(
            id=meeting_doc_ref.id,
            sectionID=data.sectionID,
            meetingDateTime=meeting_dt_chile, 
            endTime=end_dt_chile,                 
            location=data.location,
            organizerUID=final_organizer_uid,
            courseName=section_data.get("courseName"), # Denormalizar para respuesta
            sectionIdentifier=section_data.get("sectionIdentifier"), # Denormalizar para respuesta
            meetingType=data.meetingType,
            isActiveForAttendance=data.isActiveForAttendance
            # "responsibleUIDs": list(responsible_uids_set) # Opcional en respuesta
        )

        logger.info(f"ClassMeeting individual (ID: {meeting_doc_ref.id}) creada para sección {data.sectionID}.")
        return response_object_for_pydantic

    except Exception as e:
        logger.error(f"Error al crear classMeeting individual para sección {data.sectionID}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error inesperado al crear la reunión: {str(e)}")


class MeetingForListingResponse(BaseModel):
    id: str # meetingID
    meetingDateTime: datetime # Pydantic lo serializará a ISO string
    meetingType: str
    location: Optional[str] = None
    # Puedes añadir sectionIdentifier y courseName si quieres mostrarlo en el dropdown
    # sectionIdentifier: Optional[str] = None 
    # courseName: Optional[str] = None


@app.get("/sections/{section_id}/meetings", response_model=List[MeetingForListingResponse], tags=["ClassMeetings", "Admin"])
async def list_meetings_for_section(
    section_id: str,
    current_user: dict = Depends(get_current_user) 
):
    user_uid = current_user.get("uid")
    user_roles = current_user.get("roles", []) 

    logger.info(f"Usuario {user_uid} (Roles: {user_roles}) solicitando reuniones para la sección ID: {section_id}")
    
    allowed_roles_for_meeting_management = ["admin", "profesor"]
    if not any(role in user_roles for role in allowed_roles_for_meeting_management):
        logger.warning(f"User {current_user.get('uid')} (roles: {user_roles}) no autorizado para esta operación de gestión de reuniones. Se requiere uno de: {allowed_roles_for_meeting_management}.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para gestionar reuniones de clase.")
    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")

    logger.info(f"Admin {current_user.get('uid')} solicitando reuniones para sección: {section_id}")
    
    meetings_list = []
    chile_tz = pytz.timezone('America/Santiago')
    try:
        meetings_query = db.collection('classMeetings').where('sectionID', '==', section_id).order_by("meetingDateTime")
        docs = await asyncio.to_thread(list, meetings_query.stream())

        for doc in docs:
            data = doc.to_dict()
            meeting_dt_from_db = data.get("meetingDateTime") 

            processed_meeting_dt_chile: Optional[datetime] = None

            # --- Manejo robusto de fechas, igual que en creación ---
            if isinstance(meeting_dt_from_db, datetime):
                # Si es naive, asumimos UTC y convertimos a Chile
                if meeting_dt_from_db.tzinfo is None:
                    logger.debug(f"Meeting {doc.id}: datetime naive, asumiendo UTC y convirtiendo a Chile.")
                    utc_dt = pytz.utc.localize(meeting_dt_from_db)
                    processed_meeting_dt_chile = utc_dt.astimezone(chile_tz)
                else:
                    # Si ya es aware, convertimos a Chile
                    processed_meeting_dt_chile = meeting_dt_from_db.astimezone(chile_tz)
            elif hasattr(meeting_dt_from_db, "to_datetime"):
                # Firestore Timestamp (por compatibilidad)
                utc_dt = meeting_dt_from_db.to_datetime(pytz.utc)
                processed_meeting_dt_chile = utc_dt.astimezone(chile_tz)
            elif isinstance(meeting_dt_from_db, str):
                # Si es string ISO, parseamos y convertimos a Chile
                try:
                    dt_obj = datetime.fromisoformat(meeting_dt_from_db.replace("Z", "+00:00"))
                    if dt_obj.tzinfo is None:
                        dt_obj = pytz.utc.localize(dt_obj)
                    processed_meeting_dt_chile = dt_obj.astimezone(chile_tz)
                except Exception as e:
                    logger.warning(f"Meeting {doc.id}: No se pudo parsear string ISO: {meeting_dt_from_db} ({e})")
                    processed_meeting_dt_chile = None
            elif meeting_dt_from_db is None:
                logger.warning(f"Meeting {doc.id}: meetingDateTime es None.")
                processed_meeting_dt_chile = None
            else:
                logger.warning(f"Meeting {doc.id}: meetingDateTime tipo inesperado: {type(meeting_dt_from_db)}")
                processed_meeting_dt_chile = None

            meetings_list.append({
                "id": doc.id,
                "meetingDateTime": processed_meeting_dt_chile,
                "meetingType": data.get("meetingType", "N/A"),
                "location": data.get("location"),
            })
        
        return [MeetingForListingResponse(**meeting) for meeting in meetings_list]
    except Exception as e:
        logger.error(f"Error al listar reuniones para sección {section_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error al obtener la lista de reuniones.")
    
@app.delete("/class-meetings/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["ClassMeetings", "Admin"])
async def delete_single_class_meeting(
    meeting_id: str,
    current_user: dict = Depends(get_current_user)
):
    user_uid = current_user.get("uid")
    user_roles = current_user.get("roles", [])

    logger.info(f"Usuario {user_uid} (Roles: {user_roles}) intentando eliminar classMeeting ID: {meeting_id}")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")

    meeting_ref = db.collection('classMeetings').document(meeting_id)
    
    try:
        meeting_doc = await asyncio.to_thread(meeting_ref.get)
        if not meeting_doc.exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Reunión con ID '{meeting_id}' no encontrada.")
        
        meeting_data = meeting_doc.to_dict()
        organizer_uid_from_meeting = meeting_data.get("organizerUID") # Asumiendo que aún tienes un organizerUID principal en classMeetings
        section_id_of_meeting = meeting_data.get("sectionID")

        # --- INICIO DE LÓGICA DE PERMISOS PARA ELIMINAR REUNIÓN ---
        can_delete = False
        if "admin" in user_roles:
            can_delete = True
            logger.info(f"Admin {user_uid} tiene permiso para eliminar reunión {meeting_id}.")
        elif "profesor" in user_roles:
            # Un profesor puede eliminar si es el organizador de la reunión
            # O si está en la lista de 'professorUIDs' de la sección a la que pertenece la reunión.
            if organizer_uid_from_meeting == user_uid:
                can_delete = True
                logger.info(f"Profesor {user_uid} (organizador directo de la reunión) tiene permiso para eliminar reunión {meeting_id}.")
            elif section_id_of_meeting:
                section_ref_for_check = db.collection('sections').document(section_id_of_meeting)
                section_doc_for_check = await asyncio.to_thread(section_ref_for_check.get)
                if section_doc_for_check.exists:
                    section_data_for_check = section_doc_for_check.to_dict()
                    if user_uid in section_data_for_check.get("professorUIDs", []):
                        can_delete = True
                        logger.info(f"Profesor {user_uid} (asignado a la sección {section_id_of_meeting}) tiene permiso para eliminar reunión {meeting_id}.")
 
        if not can_delete:
            logger.warning(f"Usuario {user_uid} (roles: {user_roles}) NO AUTORIZADO para eliminar reunión {meeting_id}.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para eliminar esta reunión.")

        batch = db.batch()
        attendance_query = db.collection('attendanceRecords').where('meetingID', '==', meeting_id)
        attendance_stream = await asyncio.to_thread(attendance_query.stream)
        for attendance_doc in attendance_stream:
            logger.debug(f"  Marcando para eliminar attendanceRecord: {attendance_doc.id} de meeting {meeting_id}")
            batch.delete(attendance_doc.reference)
        
        batch.delete(meeting_ref)
        logger.info(f"Marcando para eliminar classMeeting: {meeting_id}")

        await asyncio.to_thread(batch.commit)
        logger.info(f"ClassMeeting '{meeting_id}' y sus registros de asistencia eliminados exitosamente por usuario {user_uid}.")

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error al eliminar la classMeeting '{meeting_id}': {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ocurrió un error inesperado al eliminar la reunión: {str(e)}",
        )

class AdminUserCreateUpdateRequest(BaseModel):
    email: str = Field(..., description="Correo institucional del usuario (@mail.udp.cl)")
    nombres: str = Field(..., description="Uno o más nombres de pila del usuario")
    apellidos: str = Field(..., description="Uno o más apellidos del usuario")
    rut: str = Field(..., description="RUT del usuario (ej: NNNNNNNN-D)")
    roles: List[str] = Field(default_factory=list, description="Lista de roles asignados")

class AdminUserResponse(BaseModel): 
    uid: str
    email: str
    displayName: str # El nombre completo construido
    nombres: str
    apellidos: str
    rut: str
    roles: List[str]
    message: str

@app.post("/admin/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED, tags=["Admin", "Users"])
async def admin_create_or_update_user_profile(
    user_data: AdminUserCreateUpdateRequest,
    current_admin_user: dict = Depends(get_current_user)
):
    admin_calling_roles = current_admin_user.get("roles", [])
    if "admin" not in admin_calling_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo administradores pueden gestionar perfiles de usuario.")

    if not user_data.email.lower().endswith("@mail.udp.cl"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El correo debe ser del dominio @mail.udp.cl.")

    # Puedes añadir validación de formato para el RUT aquí si lo deseas
    # Por ejemplo, usando una expresión regular o una librería.
    # if not validar_rut_chileno(user_data.rut): # Necesitarías implementar validar_rut_chileno
    #     raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El formato del RUT no es válido.")


    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    uid_to_process: str
    is_new_auth_user = False
    constructed_displayName = f"{user_data.nombres} {user_data.apellidos}".strip()
    try:
        try:
            auth_user_record = await asyncio.to_thread(auth.get_user_by_email, user_data.email)
            uid_to_process = auth_user_record.uid
            logger.info(f"Usuario {user_data.email} ya existe en Firebase Auth con UID: {uid_to_process}. Se actualizará su perfil en Firestore y Auth si es necesario.")

            if auth_user_record.display_name != constructed_displayName:
                await asyncio.to_thread(auth.update_user, uid_to_process, display_name=constructed_displayName)
                logger.info(f"DisplayName actualizado en Firebase Auth para UID {uid_to_process}.")

        except auth.UserNotFoundError:
            logger.info(f"Usuario {user_data.email} no encontrado en Firebase Auth. Se creará un nuevo usuario en Firebase Auth.")
            new_auth_user = await asyncio.to_thread(
                auth.create_user,
                email=user_data.email,
                email_verified=True,
                display_name=constructed_displayName
            )
            uid_to_process = new_auth_user.uid
            is_new_auth_user = True
            logger.info(f"Nuevo usuario creado en Firebase Auth para {user_data.email} con UID: {uid_to_process}.")

        user_profile_doc_ref = db.collection("users").document(uid_to_process)

        profile_data_to_set = {
            "email": user_data.email.lower(),
            "displayName": constructed_displayName,
            "nombres": user_data.nombres,
            "apellidos": user_data.apellidos,
            "rut": user_data.rut,  # <--- AÑADIDO RUT AQUÍ
            "roles": sorted(list(set(user_data.roles))),
        }

        message: str
        if is_new_auth_user:
            profile_data_to_set["createdAt"] = firestore.SERVER_TIMESTAMP # type: ignore
            profile_data_to_set["createdBy"] = current_admin_user.get("uid")
            await asyncio.to_thread(user_profile_doc_ref.set, profile_data_to_set)
            message = "Usuario creado en Firebase Auth y perfil creado en Firestore."
        else:
            profile_data_to_set["updatedAt"] = firestore.SERVER_TIMESTAMP # type: ignore
            profile_data_to_set["lastUpdatedBy"] = current_admin_user.get("uid")
            await asyncio.to_thread(user_profile_doc_ref.set, profile_data_to_set, merge=True)
            message = "Perfil de usuario en Firestore actualizado."

        logger.info(f"Perfil de Firestore para UID {uid_to_process} ({user_data.email}) establecido con datos: {profile_data_to_set}.")

        return AdminUserResponse(
            uid=uid_to_process,
            email=profile_data_to_set['email'],
            displayName=profile_data_to_set['displayName'],
            nombres=profile_data_to_set['nombres'],
            apellidos=profile_data_to_set['apellidos'],
            rut=profile_data_to_set['rut'], # <--- AÑADIDO RUT A LA RESPUESTA
            roles=profile_data_to_set['roles'],
            message=message
        )

    except ValueError as ve:
         logger.error(f"Error de valor al crear/obtener usuario en Firebase Auth para {user_data.email}: {ve}", exc_info=True)
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Datos de usuario inválidos: {str(ve)}")
    except firebase_admin.FirebaseError as fe:
        logger.error(f"Error de Firebase Auth al procesar usuario {user_data.email}: {fe}", exc_info=True)
        detail_message = str(fe)
        if hasattr(fe, 'code') and fe.code:
             detail_message = f"({fe.code}) {detail_message}"
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error de servicio de autenticación: {detail_message}")
    except Exception as e:
        logger.error(f"Error inesperado al crear/actualizar perfil de usuario para {user_data.email}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Ocurrió un error interno del servidor al procesar el usuario.")
    
class UserImportData(BaseModel):
    apellidos: str
    nombres: str
    rut: str # El frontend ya lo envía limpio y validado (DV incluido)
    correo: str # Renombrado a 'correo' para consistencia con CSV, pero en el backend usarás 'email'
    roles: List[str] = Field(default_factory=lambda: ["estudiante"]) # Rol por defecto

class BatchUserImportResponseItem(BaseModel):
    email: str # O el identificador que usaste para rastrear, como el correo original
    status: str # ej: "success", "error", "skipped"
    message: str
    uid: Optional[str] = None # UID si se creó/actualizó
    original_data: Optional[dict] = None # Para devolver los datos originales en caso de error

@app.post("/admin/users/batch-import", response_model=List[BatchUserImportResponseItem], tags=["Admin", "Users"])
async def admin_batch_import_users(
    users_to_import: List[UserImportData], # Lista de usuarios del CSV
    current_admin_user: dict = Depends(get_current_user)
):
    admin_calling_roles = current_admin_user.get("roles", [])
    if "admin" not in admin_calling_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo administradores pueden importar usuarios.")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    results: List[BatchUserImportResponseItem] = [] # Especificar el tipo aquí

    for user_data_csv in users_to_import:
        email_to_process = user_data_csv.correo.lower() # Usar .correo y luego normalizar a email
        constructed_displayName = f"{user_data_csv.nombres} {user_data_csv.apellidos}".strip()

        # Validación básica del correo (similar a la creación individual)
        if not email_to_process.endswith("@mail.udp.cl"):
            results.append(BatchUserImportResponseItem(
                email=user_data_csv.correo, status="error", 
                message="El correo debe ser del dominio @mail.udp.cl.",
                original_data=user_data_csv.model_dump()
            ))
            continue

        # Aquí reutilizarías la lógica de creación/actualización de Firebase Auth y Firestore
        # similar a la de `admin_create_or_update_user_profile`, pero adaptada para el lote.
        # Por brevedad, es un resumen conceptual.

        uid_processed: Optional[str] = None
        operation_message: str = ""
        operation_status: str = "error" # Default a error

        try:
            # 1. Verificar/Crear en Firebase Auth
            try:
                auth_user_record = await asyncio.to_thread(auth.get_user_by_email, email_to_process)
                uid_processed = auth_user_record.uid
                if auth_user_record.display_name != constructed_displayName:
                    await asyncio.to_thread(auth.update_user, uid_processed, display_name=constructed_displayName)
                # operation_message = "Usuario ya existía en Auth, perfil Firestore actualizado." # Se ajustará después
            except auth.UserNotFoundError:
                new_auth_user = await asyncio.to_thread(
                    auth.create_user,
                    email=email_to_process,
                    email_verified=True,
                    display_name=constructed_displayName
                )
                uid_processed = new_auth_user.uid
                # operation_message = "Usuario creado en Auth y perfil Firestore creado." # Se ajustará después


            # 2. Crear/Actualizar perfil en Firestore
            if uid_processed:
                user_profile_doc_ref = db.collection("users").document(uid_processed)
                existing_profile_doc = await asyncio.to_thread(user_profile_doc_ref.get)

                profile_data_to_set = {
                    "email": email_to_process,
                    "displayName": constructed_displayName,
                    "nombres": user_data_csv.nombres,
                    "apellidos": user_data_csv.apellidos,
                    "rut": user_data_csv.rut, # Asumiendo que el frontend ya lo limpió y validó
                    "roles": sorted(list(set(user_data_csv.roles))), # Usar roles del CSV o por defecto
                }

                if existing_profile_doc.exists:
                    profile_data_to_set["updatedAt"] = firestore.SERVER_TIMESTAMP # type: ignore
                    profile_data_to_set["lastUpdatedBy"] = current_admin_user.get("uid")
                    await asyncio.to_thread(user_profile_doc_ref.set, profile_data_to_set, merge=True)
                    operation_message = "Perfil de usuario existente actualizado en Firestore."
                    operation_status = "success" # O "skipped" si consideras que actualizar no es un nuevo "success"
                else:
                    profile_data_to_set["createdAt"] = firestore.SERVER_TIMESTAMP # type: ignore
                    profile_data_to_set["createdBy"] = current_admin_user.get("uid")
                    await asyncio.to_thread(user_profile_doc_ref.set, profile_data_to_set)
                    operation_message = "Nuevo perfil de usuario creado en Firestore."
                    operation_status = "success"

                results.append(BatchUserImportResponseItem(
                    email=user_data_csv.correo, status=operation_status, 
                    message=operation_message, uid=uid_processed
                ))
            else: # No debería pasar si la lógica de Auth es correcta
                results.append(BatchUserImportResponseItem(
                    email=user_data_csv.correo, status="error", 
                    message="No se pudo obtener UID de Firebase Auth.",
                    original_data=user_data_csv.model_dump()
                ))

        except firebase_admin.FirebaseError as fe:
            logger.error(f"Error de Firebase Auth procesando {email_to_process} en lote: {fe}")
            results.append(BatchUserImportResponseItem(
                email=user_data_csv.correo, status="error", 
                message=f"Error de Firebase Auth: {str(fe)}",
                original_data=user_data_csv.model_dump()
            ))
        except Exception as e:
            logger.error(f"Error inesperado procesando {email_to_process} en lote: {e}", exc_info=True)
            results.append(BatchUserImportResponseItem(
                email=user_data_csv.correo, status="error", 
                message=f"Error interno: {str(e)}",
                original_data=user_data_csv.model_dump()
            ))

    logger.info(f"Importación en lote completada por {current_admin_user.get('uid')}. Resultados: {len(results)}")
    return results

class UserProfileData(BaseModel):
    uid: str
    email: str
    nombres: str
    apellidos: str
    rut: str
    roles: List[str]
    displayName: str

@app.get("/admin/users/by-email", response_model=UserProfileData, tags=["Admin", "Users"])
async def admin_get_user_by_email(
    email: str = Query(..., description="Correo electrónico del usuario a buscar."),
    current_admin_user: dict = Depends(get_current_user) # Tu dependencia de autenticación
):
    admin_calling_roles = current_admin_user.get("roles", [])
    if "admin" not in admin_calling_roles:
        logger.warning(f"Intento no autorizado de buscar usuario por email por {current_admin_user.get('uid')}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo administradores pueden buscar usuarios.")

    if not db: # db es tu cliente de Firestore
        logger.error("Cliente de Firestore (db) no está disponible en admin_get_user_by_email.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    # Loguear el email recibido, encerrándolo en algo para ver espacios si los hubiera
    logger.info(f"DEBUG: Iniciando búsqueda para email='{email}' (largo: {len(email)})")

    try:
        logger.info(f"DEBUG: Intentando llamar a auth.get_user_by_email con: '{email}'")
        # Esta llamada interactúa con el servicio de Firebase Authentication
        auth_user_record = await asyncio.to_thread(auth.get_user_by_email, email)
        
        # Si la línea anterior tiene éxito (no lanza UserNotFoundError), esto se logueará:
        logger.info(f"DEBUG: auth.get_user_by_email EXAMEN EXITOSO. Usuario encontrado en Auth. UID: {auth_user_record.uid}, Email de Auth: {auth_user_record.email}")
        user_uid = auth_user_record.uid

        # Ahora, busca el perfil del usuario en tu colección "users" de Firestore usando el UID
        user_profile_doc_ref = db.collection("users").document(user_uid)
        logger.info(f"DEBUG: Buscando perfil en Firestore con UID: {user_uid}")
        user_profile_doc = await asyncio.to_thread(user_profile_doc_ref.get)

        if not user_profile_doc.exists:
            logger.warning(f"DEBUG: Usuario encontrado en Auth (UID: {user_uid}) pero NO en Firestore. Email original de búsqueda: {email}")
            # Esta es una inconsistencia de datos: el usuario existe en el sistema de autenticación
            # pero no tiene un perfil en tu base de datos de usuarios.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Perfil de usuario no encontrado en Firestore para el correo: {email} (aunque existe en Auth).")

        logger.info(f"DEBUG: Perfil encontrado en Firestore para UID: {user_uid}")
        profile_data = user_profile_doc.to_dict()
        
        # Verificar que los campos esperados existan en el perfil de Firestore,
        # y proveer valores por defecto o manejar el error si faltan.
        # Esto es importante para que la respuesta con UserProfileData no falle.
        nombres = profile_data.get("nombres", "N/A")
        apellidos = profile_data.get("apellidos", "N/A")
        rut = profile_data.get("rut", "N/A")
        roles = profile_data.get("roles", [])
        display_name_from_db = profile_data.get("displayName", f"{nombres} {apellidos}".strip())


        # Construir y devolver la respuesta
        return UserProfileData(
            uid=user_uid,
            email=auth_user_record.email if auth_user_record.email else email, # Priorizar email de Auth
            nombres=nombres,
            apellidos=apellidos,
            rut=rut,
            roles=roles,
            displayName=display_name_from_db
        )

    except auth.UserNotFoundError:
        # Esto se captura si auth.get_user_by_email no encuentra al usuario en Firebase Authentication
        logger.warning(f"DEBUG: auth.UserNotFoundError capturado. Usuario NO encontrado en Firebase Auth con email: '{email}'")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Usuario no encontrado en Firebase Authentication con el correo: {email}")
    except HTTPException as http_exc:
        # Re-lanzar HTTPExceptions que ya generamos (como el 404 de perfil no en Firestore)
        logger.error(f"DEBUG: HTTPException preexistente: {http_exc.status_code} - {http_exc.detail}")
        raise http_exc
    except Exception as e:
        # Capturar cualquier otro error inesperado durante el proceso
        logger.error(f"DEBUG: Error INESPERADO buscando usuario por email '{email}': {type(e).__name__} - {str(e)}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error interno del servidor al buscar el usuario: {str(e)}")

class EnrollStudentsRequest(BaseModel):
    student_uids: List[str] = Field(..., description="Lista de UIDs de estudiantes a inscribir.")

class EnrollmentResult(BaseModel):
    student_uid: str
    status: str # Ej: "enrolled", "already_enrolled", "user_not_found", "not_a_student", "failed"
    message: Optional[str] = None

class BatchEnrollmentResponse(BaseModel):
    section_id: str
    results: List[EnrollmentResult]
    summary: Dict[str, int]

@app.post("/sections/{section_id}/enroll-students", response_model=BatchEnrollmentResponse, tags=["Sections", "Admin", "Enrollment"])
async def enroll_students_to_section(
    section_id: str,
    payload: EnrollStudentsRequest,
    current_user: dict = Depends(get_current_user) # Tu dependencia de autenticación
):
    user_uid = current_user.get("uid")
    user_roles = current_user.get("roles", [])

    logger.info(f"DEBUG: Endpoint /sections/{section_id}/enroll-students HIT. Usuario: {user_uid}, Roles: {user_roles}, Payload UIDs: {payload.student_uids}")

    if "admin" not in user_roles: # O la lógica de permisos que definas
        logger.warning(f"Usuario {user_uid} NO AUTORIZADO para inscribir en sección {section_id}.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para inscribir estudiantes."
        )

    if not db: # db es tu cliente de Firestore
        logger.error("CLIENTE DB NO DISPONIBLE en enroll_students_to_section")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio de base de datos no disponible.")

    section_ref = db.collection('sections').document(section_id)
    section_doc = await asyncio.to_thread(section_ref.get)
    
    if not section_doc.exists:
        logger.warning(f"Intento de inscripción a SECCIÓN NO EXISTENTE: {section_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Sección con ID '{section_id}' no encontrada.")

    results: List[EnrollmentResult] = []
    summary: Dict[str, int] = {"enrolled": 0, "already_enrolled": 0, "user_not_found": 0, "not_a_student": 0, "failed": 0}

    for student_uid_to_enroll in payload.student_uids:
        try:
            logger.debug(f"Procesando inscripción para student_uid: {student_uid_to_enroll} en section_id: {section_id}")
            user_ref = db.collection('users').document(student_uid_to_enroll)
            user_doc = await asyncio.to_thread(user_ref.get)

            if not user_doc.exists:
                logger.warning(f"Estudiante UID {student_uid_to_enroll} no encontrado en la colección 'users'.")
                results.append(EnrollmentResult(student_uid=student_uid_to_enroll, status="user_not_found", message="Usuario no encontrado en la base de datos."))
                summary["user_not_found"] += 1
                continue

            user_data = user_doc.to_dict()
            student_roles = user_data.get("roles", [])
            if "estudiante" not in student_roles: 
                logger.warning(f"Usuario UID {student_uid_to_enroll} ({user_data.get('email')}) no tiene el rol 'estudiante'. Roles: {student_roles}")
                results.append(EnrollmentResult(student_uid=student_uid_to_enroll, status="not_a_student", message="El usuario no tiene el rol de estudiante."))
                summary["not_a_student"] += 1
                continue

            enrollment_ref = section_ref.collection('enrolledUsers').document(student_uid_to_enroll)
            enrollment_doc_check = await asyncio.to_thread(enrollment_ref.get)

            if enrollment_doc_check.exists:
                logger.info(f"Estudiante UID {student_uid_to_enroll} ya estaba inscrito en sección {section_id}.")
                results.append(EnrollmentResult(student_uid=student_uid_to_enroll, status="already_enrolled", message="El estudiante ya está inscrito en esta sección."))
                summary["already_enrolled"] += 1
            else:
                await asyncio.to_thread(enrollment_ref.set, {
                    "enrollmentDate": firestore.SERVER_TIMESTAMP, # type: ignore
                    "enrolledByUID": user_uid 
                })
                logger.info(f"Estudiante UID {student_uid_to_enroll} inscrito exitosamente en sección {section_id} por {user_uid}.")
                results.append(EnrollmentResult(student_uid=student_uid_to_enroll, status="enrolled", message="Estudiante inscrito exitosamente."))
                summary["enrolled"] += 1
        except Exception as e:
            logger.error(f"Error excepcional inscribiendo estudiante {student_uid_to_enroll} a sección {section_id}: {str(e)}", exc_info=True)
            results.append(EnrollmentResult(student_uid=student_uid_to_enroll, status="failed", message=f"Error interno: {str(e)}"))
            summary["failed"] += 1
            
    logger.info(f"Proceso de inscripción para sección {section_id} completado por {user_uid}. Resumen: {summary}")
    return BatchEnrollmentResponse(section_id=section_id, results=results, summary=summary)

class SnapshotInfo(BaseModel):
    id: str
    snapshotName: str
    cutOffDate: str
    createdAt: datetime

class EarlyWarningStudentData(BaseModel):
    studentUid: str
    studentName: str
    courseName: str
    sectionIdentifier: str
    overallAttendancePercentage: int
    sectionID: str
    courseID: str
    percentagesByType: Dict[str, int]

class EarlyWarningReportResponse(BaseModel):
    cutOffDates: Dict[str, Optional[str]]
    students: List[EarlyWarningStudentData]
    availableMeetingTypes: List[str]
    # AÑADE ESTOS DOS CAMPOS NUEVOS
    calculationRange: Dict[str, str]
    existingSnapshots: List[SnapshotInfo]


async def get_section_attendance_matrix_internal(
    section_id_param: str,
    meeting_types: Optional[List[str]] = None,
    end_date_for_calc: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Función auxiliar que ahora calcula tanto el porcentaje general como el desglose por tipo de reunión.
    """
    all_meetings_query = db.collection('classMeetings').where('sectionID', '==', section_id_param).order_by('meetingDateTime')
    all_meetings_docs_list = await asyncio.to_thread(list, all_meetings_query.stream())
    
    all_available_meeting_types: Set[str] = set()
    meetings_for_calculation = []
    for doc_meeting in all_meetings_docs_list:
        meeting_item = doc_meeting.to_dict()
        if not meeting_item: continue

        current_meeting_type = meeting_item.get("meetingType")
        if current_meeting_type:
            all_available_meeting_types.add(current_meeting_type)

        meeting_date = meeting_item.get('meetingDateTime')
        if end_date_for_calc and meeting_date and meeting_date > end_date_for_calc:
            continue
        
        if not meeting_types or (current_meeting_type in meeting_types):
            meetings_for_calculation.append({ "meetingId": doc_meeting.id, **meeting_item })

    enrolled_student_docs_stream = await asyncio.to_thread(db.collection('sections').document(section_id_param).collection('enrolledUsers').stream)
    student_uids_from_enrollment: List[str] = [doc.id for doc in enrolled_student_docs_stream]
    
    students_details_map: Dict[str, str] = {}
    if student_uids_from_enrollment:
        batched_student_uids = [student_uids_from_enrollment[i:i + 30] for i in range(0, len(student_uids_from_enrollment), 30)]
        for batch_uids in batched_student_uids:
            if not batch_uids: continue
            users_query = db.collection('users').where('__name__', 'in', batch_uids)
            user_docs_stream = await asyncio.to_thread(users_query.stream)
            for user_doc_snapshot in user_docs_stream:
                if user_doc_snapshot.exists:
                    user_data_from_db = user_doc_snapshot.to_dict()
                    display_name = user_data_from_db.get("displayName", user_doc_snapshot.id)
                    if not display_name and user_data_from_db.get("nombres") and user_data_from_db.get("apellidos"):
                         display_name = f"{user_data_from_db.get('nombres')} {user_data_from_db.get('apellidos')}".strip()
                    students_details_map[user_doc_snapshot.id] = display_name

    meeting_ids_set = {m['meetingId'] for m in meetings_for_calculation}
    attendance_map: Dict[str, Set[str]] = {mid: set() for mid in meeting_ids_set}
    if meeting_ids_set:
        meeting_ids_list = list(meeting_ids_set)
        for i in range(0, len(meeting_ids_list), 30):
            chunk_meeting_ids = meeting_ids_list[i:i + 30]
            attendance_query = db.collection('attendanceRecords').where('meetingID', 'in', chunk_meeting_ids)
            attendance_docs = await asyncio.to_thread(list, attendance_query.stream())
            for record_doc in attendance_docs:
                record = record_doc.to_dict()
                meeting_id, attendee_uid = record.get("meetingID"), record.get("attendeeUID")
                if meeting_id in attendance_map:
                    attendance_map[meeting_id].add(attendee_uid)

    students_attendance_for_response = []
    active_meetings_for_calc = [m for m in meetings_for_calculation if m.get("isActiveForAttendance", False)]
    
    # --- INICIO: NUEVA LÓGICA DE CÁLCULO POR TIPO ---
    meetings_by_type: Dict[str, list] = {}
    for meeting in active_meetings_for_calc:
        m_type = meeting.get("meetingType", "Sin Tipo")
        if m_type not in meetings_by_type:
            meetings_by_type[m_type] = []
        meetings_by_type[m_type].append(meeting)

    for student_uid in student_uids_from_enrollment:
        percentages_by_type: Dict[str, int] = {}
        total_attended_count = 0
        total_possible_count = 0

        for m_type, meetings_in_type in meetings_by_type.items():
            attended_in_type = 0
            total_in_type = len(meetings_in_type)
            for meeting in meetings_in_type:
                if student_uid in attendance_map.get(meeting["meetingId"], set()):
                    attended_in_type += 1
            
            type_percentage = round((attended_in_type / total_in_type) * 100) if total_in_type > 0 else 0
            percentages_by_type[m_type] = type_percentage
            
            total_attended_count += attended_in_type
            total_possible_count += total_in_type

        overall_percentage = round((total_attended_count / total_possible_count) * 100) if total_possible_count > 0 else 0
        
        students_attendance_for_response.append({
            "studentUid": student_uid,
            "studentName": students_details_map.get(student_uid, student_uid),
            "overallAttendancePercentage": overall_percentage,
            "percentagesByType": percentages_by_type, # <-- Añadir el desglose
        })
    # --- FIN: NUEVA LÓGICA DE CÁLCULO POR TIPO ---

    return {
        "studentsAttendance": students_attendance_for_response,
        "availableMeetingTypes": sorted(list(all_available_meeting_types))
    }

class SnapshotStudentResult(BaseModel):
    studentUid: str
    studentName: str
    sectionId: str
    courseName: str
    sectionIdentifier: str
    attendancePercentage: int
    percentagesByType: Dict[str, int]

# 2. Nuevo modelo Pydantic para la respuesta completa del detalle de un snapshot
class SnapshotDetailResponse(BaseModel):
    id: str
    snapshotName: str
    cutOffDate: str
    createdAt: datetime
    results: List[SnapshotStudentResult]

class SemesterDates(BaseModel):
    primerSemestreStart: Optional[str] = None
    primerSemestreEnd: Optional[str] = None
    segundoSemestreStart: Optional[str] = None
    segundoSemestreEnd: Optional[str] = None

# Modifica el modelo de respuesta de la página
class EarlyWarningPageResponse(BaseModel):
    cutOffDates: Dict[str, Optional[str]]
    existingSnapshots: List[SnapshotInfo]
    latestSnapshot: Optional[SnapshotDetailResponse] = None
    semesterDates: Optional[SemesterDates] = None

@app.get("/reports/early-warning", response_model=EarlyWarningPageResponse, tags=["Reports", "Admin"])
async def get_early_warning_report(current_user: dict = Depends(get_current_user)):
    user_roles = current_user.get("roles", [])
    if not any(role in user_roles for role in ["admin", "profesor"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para acceder a este reporte.")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")

    try:
        # 1. Obtener la configuración completa de una vez
        app_config_ref = db.collection('appConfig').document('reportDates')
        app_config_doc = await asyncio.to_thread(app_config_ref.get)
        config_data = app_config_doc.to_dict() if app_config_doc.exists else {}

        report_cut_off_dates = {
            "firstCutOff": config_data.get("earlyWarningFirstCutOff"),
            "secondCutOff": config_data.get("earlyWarningSecondCutOff"),
            "thirdCutOff": config_data.get("earlyWarningThirdCutOff"),
        }

        # --- INICIO DE LA CORRECCIÓN ---
        # Aquí es donde creamos la variable 'semester_dates' que faltaba
        semester_dates = SemesterDates(
            primerSemestreStart=config_data.get("primerSemestreStart"),
            primerSemestreEnd=config_data.get("primerSemestreEnd"),
            segundoSemestreStart=config_data.get("segundoSemestreStart"),
            segundoSemestreEnd=config_data.get("segundoSemestreEnd"),
        )
        # --- FIN DE LA CORRECCIÓN ---

        # 2. Obtener la lista de snapshots existentes
        snapshots_query = db.collection('attendanceSnapshots').order_by("createdAt", direction=firestore.Query.DESCENDING)
        snapshots_docs = await asyncio.to_thread(list, snapshots_query.stream())
        
        existing_snapshots = []
        for doc in snapshots_docs:
            data = doc.to_dict()
            created_at = data.get("createdAt")
            if isinstance(created_at, Timestamp): created_at = created_at.to_datetime()
            existing_snapshots.append(SnapshotInfo(
                id=doc.id,
                snapshotName=data.get("snapshotName", "N/A"),
                cutOffDate=data.get("cutOffDate", "N/A"),
                createdAt=created_at or datetime.now()
            ))

        # 3. Cargar los detalles del snapshot más reciente
        latest_snapshot_details: Optional[SnapshotDetailResponse] = None
        if snapshots_docs:
            latest_snapshot_doc = snapshots_docs[0]
            latest_snapshot_data = latest_snapshot_doc.to_dict()
            
            results_query = latest_snapshot_doc.reference.collection('results').order_by("studentName")
            results_docs = await asyncio.to_thread(list, results_query.stream())
            student_results = [SnapshotStudentResult(**doc.to_dict()) for doc in results_docs]

            created_at_val = latest_snapshot_data.get("createdAt")
            if isinstance(created_at_val, Timestamp): created_at_val = created_at_val.to_datetime()

            latest_snapshot_details = SnapshotDetailResponse(
                id=latest_snapshot_doc.id,
                snapshotName=latest_snapshot_data.get("snapshotName", "N/A"),
                cutOffDate=latest_snapshot_data.get("cutOffDate", "N/A"),
                createdAt=created_at_val or datetime.now(),
                results=student_results
            )

        # 4. Construir la respuesta final, ahora usando la variable 'semester_dates' que sí existe
        return EarlyWarningPageResponse(
            cutOffDates=report_cut_off_dates,
            existingSnapshots=existing_snapshots,
            latestSnapshot=latest_snapshot_details,
            semesterDates=semester_dates 
        )

    except Exception as e:
        logger.error(f"Error al generar la página de alerta temprana: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al generar la página de reporte.")

class GenerateSnapshotRequest(BaseModel):
    cut_off_name: str # ej. "firstCutOff", "secondCutOff"
    snapshot_display_name: str # ej. "Primer Corte Semestre 2025-1"

@app.post("/admin/reports/snapshots", status_code=201, tags=["Admin", "Reports"])
async def generate_attendance_snapshot(
    request: GenerateSnapshotRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Genera un snapshot de asistencia y envía una notificación por email.
    Puede ser llamado manualmente por un admin o automáticamente por el scheduler.
    """
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=403, detail="No tienes permiso para generar snapshots.")

    app_config_ref = db.collection('appConfig').document('reportDates')
    config_doc = await asyncio.to_thread(app_config_ref.get)
    if not config_doc.exists:
        raise HTTPException(status_code=404, detail="Documento de configuración de fechas no encontrado.")
    
    config_data = config_doc.to_dict()
    cut_off_date_str = config_data.get(request.cut_off_name)
    threshold = config_data.get("earlyWarningThreshold", 70)
    
    if not cut_off_date_str:
        raise HTTPException(status_code=404, detail=f"Fecha de corte '{request.cut_off_name}' no encontrada en la configuración.")

    end_date_for_calc = datetime.combine(datetime.strptime(cut_off_date_str, "%Y-%m-%d").date(), py_time.max, tzinfo=chile_tz)
    all_sections_docs = await asyncio.to_thread(list, db.collection('sections').stream())
    
    snapshot_batch = db.batch()
    snapshot_doc_ref = db.collection('attendanceSnapshots').document()
    
    # Se inicializa el diccionario de resumen sin el contador de riesgo.
    snapshot_summary = {"sections_processed": 0, "total_students_processed": 0}
    
    # --- CAMBIO 1: Se crea un set para guardar UIDs únicos de estudiantes en riesgo. ---
    unique_students_at_risk = set()

    for section_doc in all_sections_docs:
        snapshot_summary["sections_processed"] += 1
        matrix_result = await get_section_attendance_matrix_internal(section_doc.id, end_date_for_calc=end_date_for_calc)
        snapshot_summary["total_students_processed"] += len(matrix_result["studentsAttendance"])
        for student_data in matrix_result["studentsAttendance"]:
            percentages_by_type = student_data.get("percentagesByType", {})
            at_risk_percentages = { m_type: percentage for m_type, percentage in percentages_by_type.items() if percentage < threshold }
            if at_risk_percentages:
                # --- CAMBIO 2: Ya no se incrementa un contador. Se añade el UID del estudiante al set. ---
                # Si el estudiante ya está en el set, no pasará nada.
                unique_students_at_risk.add(student_data['studentUid'])

                result_doc_ref = snapshot_doc_ref.collection('results').document(f"{student_data['studentUid']}_{section_doc.id}")
                snapshot_batch.set(result_doc_ref, {
                    "studentUid": student_data['studentUid'], "studentName": student_data['studentName'],
                    "sectionId": section_doc.id, "courseName": section_doc.to_dict().get("courseName", "N/A"),
                    "sectionIdentifier": section_doc.to_dict().get("sectionIdentifier", "N/A"),
                    "attendancePercentage": student_data['overallAttendancePercentage'],
                    "percentagesByType": at_risk_percentages,
                })

    # --- CAMBIO 3: Se calcula el número de estudiantes en riesgo contando los elementos únicos del set. ---
    snapshot_summary["students_at_risk_found"] = len(unique_students_at_risk)

    snapshot_batch.set(snapshot_doc_ref, {
        "snapshotName": request.snapshot_display_name, "cutOffDate": cut_off_date_str,
        "createdAt": firestore.SERVER_TIMESTAMP, "generatedBy": current_user.get("uid"),
        "summary": snapshot_summary # El resumen ahora contiene el conteo correcto.
    })

    await asyncio.to_thread(snapshot_batch.commit)
    
    if current_user.get("uid") != "system_scheduler":
        try:
            recipients = config_data.get("emailReports", [])
            if recipients:
                subject = f"Reporte de Alerta Temprana Generado Manualmente: {request.snapshot_display_name}"
                body_html = f"""
                <h1>Se ha generado un nuevo Reporte de Alerta Temprana</h1>
                <p>Este es un resumen del snapshot generado por el usuario {current_user.get('email', 'N/A')}.</p>
                <ul>
                    <li><strong>Nombre del Reporte:</strong> {request.snapshot_display_name}</li>
                    <li><strong>Fecha de Corte:</strong> {cut_off_date_str}</li>
                    <li><strong>Secciones Procesadas:</strong> {snapshot_summary.get('sections_processed', 'N/A')}</li>
                    <li><strong>Total de Estudiantes Analizados:</strong> {snapshot_summary.get('total_students_processed', 'N/A')}</li>
                    <li><strong>Estudiantes Únicos en Riesgo:</strong> {snapshot_summary.get('students_at_risk_found', 'N/A')}</li>
                </ul>
                <p>Para ver el detalle completo, por favor, visita el panel de administración.</p>
                """
                await send_summary_email(subject, body_html, recipients)
        except Exception as email_error:
            logger.error(f"[ManualSnapshot] Error al intentar enviar el email de resumen: {email_error}", exc_info=True)

    return {"status": "success", "message": f"Snapshot '{request.snapshot_display_name}' generado exitosamente.", "details": snapshot_summary}

# 2. Nuevo endpoint para listar todos los snapshots disponibles
@app.get("/reports/snapshots", response_model=List[SnapshotInfo], tags=["Reports", "Admin", "Snapshots"])
async def list_attendance_snapshots(current_user: dict = Depends(get_current_user)):
    """
    Endpoint para que un administrador obtenga la lista de todos los
    snapshots de asistencia históricos que se han generado.
    """
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para ver los snapshots de reportes."
        )

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")

    try:
        snapshots_query = db.collection('attendanceSnapshots').order_by("createdAt", direction=firestore.Query.DESCENDING)
        snapshots_docs = await asyncio.to_thread(list, snapshots_query.stream())

        snapshots_list = []
        for doc in snapshots_docs:
            data = doc.to_dict()
            # Asegurarse de que createdAt es un objeto datetime para Pydantic
            created_at_val = data.get("createdAt")
            if isinstance(created_at_val, Timestamp):
                created_at_val = created_at_val.to_datetime()
            
            snapshots_list.append(SnapshotInfo(
                id=doc.id,
                snapshotName=data.get("snapshotName", "Snapshot sin nombre"),
                cutOffDate=data.get("cutOffDate", "Fecha desconocida"),
                createdAt=created_at_val or datetime.now() # Fallback por si acaso
            ))
        
        logger.info(f"Admin {current_user.get('uid')} listó {len(snapshots_list)} snapshots.")
        return snapshots_list

    except Exception as e:
        logger.error(f"Error al listar snapshots de asistencia: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener la lista de snapshots.")
    


# 3. Nuevo endpoint para obtener los detalles de un snapshot específico por su ID
@app.get("/reports/snapshots/{snapshot_id}", response_model=SnapshotDetailResponse, tags=["Reports", "Admin", "Snapshots"])
async def get_snapshot_details(snapshot_id: str, current_user: dict = Depends(get_current_user)):
    """
    Obtiene los resultados detallados de un snapshot de asistencia específico.
    """
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para ver los detalles de snapshots."
        )

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")

    try:
        # Primero, obtener el documento principal del snapshot
        snapshot_doc_ref = db.collection('attendanceSnapshots').document(snapshot_id)
        snapshot_doc = await asyncio.to_thread(snapshot_doc_ref.get)

        if not snapshot_doc.exists:
            raise HTTPException(status_code=404, detail=f"Snapshot con ID '{snapshot_id}' no encontrado.")
        
        snapshot_data = snapshot_doc.to_dict()

        # Luego, obtener todos los documentos de la subcolección 'results'
        results_query = snapshot_doc_ref.collection('results').order_by("studentName")
        results_docs = await asyncio.to_thread(list, results_query.stream())

        student_results = [SnapshotStudentResult(**doc.to_dict()) for doc in results_docs]

        # Formatear la fecha de creación para la respuesta
        created_at_val = snapshot_data.get("createdAt")
        if isinstance(created_at_val, Timestamp):
            created_at_val = created_at_val.to_datetime()

        # Construir la respuesta final
        response = SnapshotDetailResponse(
            id=snapshot_doc.id,
            snapshotName=snapshot_data.get("snapshotName", "Snapshot sin nombre"),
            cutOffDate=snapshot_data.get("cutOffDate", "Fecha desconocida"),
            createdAt=created_at_val or datetime.now(),
            results=student_results
        )
        
        logger.info(f"Admin {current_user.get('uid')} obtuvo detalles para snapshot {snapshot_id}.")
        return response

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error al obtener detalles del snapshot {snapshot_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener los detalles del snapshot.")


class CurrentSemesterResponse(BaseModel):
    start: str
    end: str
    semester_name: str # ej. "Primer Semestre 2025"

@app.get("/config/semester-dates", response_model=CurrentSemesterResponse, tags=["Configuration"])
async def get_current_semester_dates(current_user: dict = Depends(get_current_user)):
    """
    Determina el semestre actual y devuelve sus fechas de inicio y fin.
    """
    if not db:
        raise HTTPException(status_code=503, detail="Servicio no disponible.")
    
    try:
        config_doc = await asyncio.to_thread(db.collection('appConfig').document('reportDates').get)
        if not config_doc.exists:
            raise HTTPException(status_code=404, detail="Documento de configuración de fechas no encontrado.")
        
        config_data = config_doc.to_dict()
        today = datetime.now(chile_tz).date()

        def to_date(date_str: Optional[str]) -> Optional[date]:
            return datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else None

        p1_start = to_date(config_data.get("primerSemestreStart"))
        p1_end = to_date(config_data.get("primerSemestreEnd"))
        p2_start = to_date(config_data.get("segundoSemestreStart"))
        p2_end = to_date(config_data.get("segundoSemestreEnd"))

        if p1_start and p1_end and p1_start <= today <= p1_end:
            return CurrentSemesterResponse(start=str(p1_start), end=str(p1_end), semester_name=f"Primer Semestre {p1_start.year}")
        elif p2_start and p2_end and p2_start <= today <= p2_end:
            return CurrentSemesterResponse(start=str(p2_start), end=str(p2_end), semester_name=f"Segundo Semestre {p2_start.year}")
        else:
            # Fallback si estamos fuera de cualquier semestre definido (ej. en vacaciones)
            # Podrías devolver el semestre más cercano o un error. Devolver el primero es una opción segura.
            if p1_start and p1_end:
                 return CurrentSemesterResponse(start=str(p1_start), end=str(p1_end), semester_name=f"Primer Semestre {p1_start.year} (Fuera de Rango)")
            raise HTTPException(status_code=404, detail="No se pudo determinar un semestre activo para la fecha actual.")

    except Exception as e:
        logger.error(f"Error al obtener fechas del semestre: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener fechas del semestre.")

async def generate_daily_activity_report():
    """
    Tarea programada que genera un reporte de actividad diario y envía una
    notificación por email a los administradores.
    """
    if not db:
        logger.error("[DailyReport] Error: Cliente de Firestore no disponible.")
        return

    today_str = datetime.now(chile_tz).strftime('%Y-%m-%d')
    logger.info(f"--- Iniciando generación de reporte diario para fecha: {today_str} ---")
    
    start_of_day = datetime.now(chile_tz).replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    report_data = {
        "reportDate": today_str,
        "generatedAt": firestore.SERVER_TIMESTAMP,
        "summary": {},
        "notActivatedMeetings": [],
        "allManualAttendanceMeetings": []
    }

    try:
        meetings_query = db.collection('classMeetings').where('meetingDateTime', '>=', start_of_day).where('meetingDateTime', '<', end_of_day)
        meetings_today_docs = await asyncio.to_thread(list, meetings_query.stream())
        
        total_meetings_today = len(meetings_today_docs)
        activated_meetings_count = sum(1 for m in meetings_today_docs if m.to_dict().get("isActiveForAttendance", False))
        report_data["summary"] = {
            "totalMeetings": total_meetings_today,
            "activatedMeetings": activated_meetings_count,
            "notActivatedMeetings": total_meetings_today - activated_meetings_count
        }

        sections_cache = {}
        for meeting_doc in meetings_today_docs:
            meeting_data = meeting_doc.to_dict()
            section_id = meeting_data.get("sectionID")
            section_details = sections_cache.get(section_id)
            if not section_details and section_id:
                section_ref = db.collection('sections').document(section_id)
                section_info_doc = await asyncio.to_thread(section_ref.get)
                if section_info_doc.exists:
                    section_details = section_info_doc.to_dict()
                    sections_cache[section_id] = section_details
            
            meeting_datetime_from_db = meeting_data.get("meetingDateTime")
            meeting_time_str = meeting_datetime_from_db.astimezone(chile_tz).strftime('%H:%M') if meeting_datetime_from_db else "N/A"
            meeting_info_for_report = {
                "meetingId": meeting_doc.id, "sectionId": section_id,
                "courseName": section_details.get("courseName", "N/A") if section_details else "N/A",
                "sectionIdentifier": section_details.get("sectionIdentifier", "N/A") if section_details else "N/A",
                "meetingType": meeting_data.get("meetingType", "N/A"), "meetingTime": meeting_time_str
            }
            if not meeting_data.get("isActiveForAttendance", False):
                report_data["notActivatedMeetings"].append(meeting_info_for_report)
            else:
                attendance_query = db.collection('attendanceRecords').where('meetingID', '==', meeting_doc.id)
                attendance_docs = await asyncio.to_thread(list, attendance_query.stream())
                if attendance_docs and not any(rec.to_dict().get("method") == "qr_scan" for rec in attendance_docs):
                    report_data["allManualAttendanceMeetings"].append(meeting_info_for_report)

        report_doc_ref = db.collection('dailyReports').document(today_str)
        await asyncio.to_thread(report_doc_ref.set, report_data)
        
        logger.info(f"--- Reporte diario para {today_str} generado y guardado exitosamente. ---")
        
        # --- NUEVO: Enviar notificación por email ---
        try:
            config_ref = db.collection('appConfig').document('reportDates')
            config_doc = await asyncio.to_thread(config_ref.get)
            if config_doc.exists:
                recipients = config_doc.to_dict().get("emailReports", [])
                if recipients:
                    summary = report_data['summary']
                    subject = f"Resumen Diario de Actividad - {today_str}"
                    body_html = f"""
                    <h1>Resumen de Actividad del {today_str}</h1>
                    <p>Este es un resumen automático de la actividad en la plataforma de asistencia.</p>
                    <ul>
                        <li><strong>Total de Clases Programadas:</strong> {summary.get('totalMeetings', 0)}</li>
                        <li><strong>Clases Activadas:</strong> {summary.get('activatedMeetings', 0)}</li>
                        <li><strong>Clases No Activadas:</strong> {summary.get('notActivatedMeetings', 0)}</li>
                        <li><strong>Secciones con Asistencia 100% Manual:</strong> {len(report_data.get('allManualAttendanceMeetings', []))}</li>
                    </ul>
                    <p>Para más detalles, por favor, visita el panel de administración.</p>
                    """
                    await send_summary_email(subject, body_html, recipients)
        except Exception as email_error:
            logger.error(f"[DailyReport] Error al intentar enviar el email de resumen: {email_error}", exc_info=True)
        # --- FIN: Enviar notificación por email ---

    except Exception as e:
        logger.error(f"Error CRÍTICO durante la generación del reporte diario: {e}", exc_info=True)
        traceback.print_exc()



# --- SCHEDULER ACTUALIZADO ---
async def run_daily_tasks():
    """
    Función que agrupa las tareas que se ejecutan CADA DÍA.
    La generación de snapshots ya no se llama desde aquí.
    """
    logger.info("--- Ejecutando tareas diarias programadas (Reporte de Actividad y Analíticas) ---")
    await generate_daily_activity_report()
    await generate_analytics_summary() 
    logger.info("--- Tareas diarias finalizadas ---")

# Configuración y arranque del scheduler cuando la app de FastAPI inicia
@app.on_event("startup")
async def startup_event():
    """
    Al iniciar la aplicación, lee la configuración y programa las tareas.
    - El reporte diario se programa para ejecutarse todos los días.
    - Los snapshots de alerta temprana se programan para ejecutarse SÓLO en las fechas de corte específicas.
    """
    scheduler = AsyncIOScheduler(timezone=chile_tz)
    
    if not db:
        logger.error("[Scheduler] No se pueden programar tareas porque el cliente de Firestore no está disponible.")
        return

    try:
        logger.info("[Scheduler] Leyendo configuración de tareas desde Firestore...")
        config_ref = db.collection('appConfig').document('reportDates')
        config_doc = await asyncio.to_thread(config_ref.get)
        
        if config_doc.exists:
            config_data = config_doc.to_dict()

            # --- TAREA 1: Programar las tareas diarias (Reporte y Analíticas) ---
            daily_time_str = config_data.get("dailyReportCutoffTime", "18:24")
            daily_hour, daily_minute = map(int, daily_time_str.split(':'))
            
            # --- INICIO DE LA CORRECCIÓN ---
            # Ahora llamamos a la función que agrupa ambas tareas diarias.
            scheduler.add_job(
                run_daily_tasks, # <-- ESTA ES LA LÍNEA CORREGIDA
                CronTrigger(hour=daily_hour, minute=daily_minute),
                id="daily_tasks_job", # Cambiado para reflejar que hace más de una cosa
                name="Generador de Reportes Diarios y Analíticas",
                replace_existing=True
            )
            # --- FIN DE LA CORRECCIÓN ---

            logger.info(f"[Scheduler] Tareas diarias programadas para las {daily_hour:02d}:{daily_minute:02d} todos los días.")

            # --- TAREA 2: Programar los snapshots (esta parte ya estaba bien) ---
            snapshot_time_str = config_data.get("earlyWarningCutoffTime", "04:30")
            snapshot_hour, snapshot_minute = map(int, snapshot_time_str.split(':'))
            
            cut_off_dates_config = {
                "earlyWarningFirstCutOff": config_data.get("earlyWarningFirstCutOff"),
                "earlyWarningSecondCutOff": config_data.get("earlyWarningSecondCutOff"),
                "earlyWarningThirdCutOff": config_data.get("earlyWarningThirdCutOff"),
            }

            for key, date_str in cut_off_dates_config.items():
                if not date_str:
                    continue
                
                try:
                    cut_off_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                    
                    if cut_off_date >= datetime.now(chile_tz).date():
                        scheduler.add_job(
                            generate_snapshot_for_cutoff,
                            trigger=CronTrigger(
                                year=cut_off_date.year,
                                month=cut_off_date.month,
                                day=cut_off_date.day,
                                hour=snapshot_hour,
                                minute=snapshot_minute
                            ),
                            args=[key, date_str],
                            id=f"snapshot_job_{date_str}",
                            name=f"Snapshot para el corte de {date_str}",
                            replace_existing=True
                        )
                        logger.info(f"[Scheduler] Snapshot programado para el {date_str} a las {snapshot_hour:02d}:{snapshot_minute:02d}.")
                    else:
                        logger.info(f"[Scheduler] La fecha de corte {date_str} ya pasó, no se programará el job.")

                except (ValueError, TypeError) as e:
                    logger.error(f"[Scheduler] No se pudo programar el snapshot para la fecha '{date_str}' debido a un error: {e}")

        else:
            logger.warning("[Scheduler] Documento 'reportDates' no encontrado. No se programaron tareas automáticas.")

    except Exception as e:
        logger.error(f"[Scheduler] Error al configurar las tareas programadas: {e}", exc_info=True)

    scheduler.start()
    logger.info("[Scheduler] Scheduler iniciado y tareas programadas.")

class ActivatedMeetingSummary(BaseModel):
    meetingId: str
    courseName: str
    sectionIdentifier: str
    professorName: str
    attendeeCount: int
    absenteeCount: int

# Añade este nuevo endpoint al final del archivo
@app.get("/reports/daily/{report_date}/activated-summary", response_model=List[ActivatedMeetingSummary], tags=["Reports", "Admin"])
async def get_activated_sections_summary(report_date: str, current_user: dict = Depends(get_current_user)):
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=403, detail="Acceso denegado.")

    if not db:
        raise HTTPException(status_code=503, detail="Servicio no disponible.")

    try:
        report_date_obj = datetime.strptime(report_date, '%Y-%m-%d')
        start_of_day = chile_tz.localize(report_date_obj.replace(hour=0, minute=0, second=0, microsecond=0))
        end_of_day = start_of_day + timedelta(days=1)

        # 1. Buscar todas las reuniones activadas para la fecha
        meetings_query = db.collection('classMeetings') \
                           .where('meetingDateTime', '>=', start_of_day) \
                           .where('meetingDateTime', '<', end_of_day) \
                           .where('isActiveForAttendance', '==', True)
        
        activated_meetings_docs = await asyncio.to_thread(list, meetings_query.stream())
        
        summaries = []
        for meeting_doc in activated_meetings_docs:
            meeting_data = meeting_doc.to_dict()
            section_id = meeting_data.get("sectionID")

            if not section_id:
                continue

            # 2. Obtener la sección y los inscritos
            section_ref = db.collection('sections').document(section_id)
            enrolled_users_ref = section_ref.collection('enrolledUsers')
            
            section_doc_task = asyncio.to_thread(section_ref.get)
            enrolled_users_docs_task = asyncio.to_thread(list, enrolled_users_ref.stream())

            section_doc, enrolled_users_docs = await asyncio.gather(section_doc_task, enrolled_users_docs_task)

            if not section_doc.exists:
                continue
            
            section_data = section_doc.to_dict()
            total_enrolled = len(enrolled_users_docs)
            
            # 3. Contar los asistentes para esa reunión
            attendance_query = db.collection('attendanceRecords').where('meetingID', '==', meeting_doc.id)
            attendance_docs = await asyncio.to_thread(list, attendance_query.stream())
            attendee_count = len(attendance_docs)

            # 4. Construir el resumen para esta reunión
            professors_info = section_data.get("professorsInfo", [])
            professor_name = professors_info[0].get("displayName", "N/A") if professors_info else "N/A"

            summaries.append(ActivatedMeetingSummary(
                meetingId=meeting_doc.id,
                courseName=section_data.get("courseName", "N/A"),
                sectionIdentifier=section_data.get("sectionIdentifier", "N/A"),
                professorName=professor_name,
                attendeeCount=attendee_count,
                absenteeCount=total_enrolled - attendee_count,
            ))
            
        return sorted(summaries, key=lambda x: x.courseName)

    except Exception as e:
        logger.error(f"Error al generar resumen de secciones activadas para {report_date}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error al generar el resumen.")
    
@app.get("/lms/sync/initiate", tags=["LMS Integration"])
async def initiate_sync(current_user: dict = Depends(get_current_user)):
    """
    Paso 1: Obtiene la lista de cursos de Canvas para que el frontend los procese.
    """
    # ... (código de validación de permisos de admin) ...
    try:
        canvas_courses = await call_canvas_api("/courses", params={"per_page": 100})
        # Devolvemos solo los datos que el frontend necesita para el bucle
        courses_to_process = [
            {
                "canvas_course_id": c.get("id"),
                "name": c.get("name"),
                "course_code": c.get("course_code")
            }
            for c in canvas_courses if c.get("name") and c.get("course_code")
        ]
        return courses_to_process
    except Exception as e:
        logger.error(f"Error al iniciar la sincronización: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --- Define el modelo de datos que esperas del frontend ---
class CanvasCourseData(BaseModel):
    canvas_course_id: int
    name: str
    course_code: str

# --- Función auxiliar para crear el ID del curso ---
def create_firestore_id_from_name(name: str) -> str:
    """Convierte un nombre como 'Cálculo II' a 'CALCULO_II'."""
    # Convertir a mayúsculas
    s = name.upper()
    # Reemplazar caracteres especiales y tildes por sus equivalentes sin tilde
    s = s.replace('Á', 'A').replace('É', 'E').replace('Í', 'I').replace('Ó', 'O').replace('Ú', 'U')
    # Reemplazar espacios con guiones bajos
    s = s.replace(' ', '_')
    # Eliminar cualquier caracter que no sea letra, número o guion bajo
    s = re.sub(r'[^A-Z0-9_]', '', s)
    return s

class MeetingsCreationRequest(BaseModel):
    startDate: str
    endDate: str

# Reemplaza la función process_single_canvas_course en tu archivo
@app.post("/lms/sync/process-course", tags=["LMS Integration"])
async def process_single_canvas_course(
    course_data: CanvasCourseData,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=403, detail="Solo los administradores pueden ejecutar la sincronización.")

    canvas_course_id = course_data.canvas_course_id
    course_name_from_canvas = course_data.name
    section_identifier_from_canvas = course_data.course_code
    
    logger.info(f"--- Procesando curso de Canvas: '{course_name_from_canvas}' ({canvas_course_id}) ---")

    try:
        # --- 1. OBTENER FECHAS DEL SEMESTRE ---
        config_ref = db.collection('appConfig').document('reportDates')
        config_doc = await asyncio.to_thread(config_ref.get)
        
        if not config_doc.exists:
            raise HTTPException(status_code=404, detail="Configuración de fechas del semestre no encontrada en Firestore.")
        
        config_data = config_doc.to_dict()
        today = datetime.now(pytz.timezone('America/Santiago')).date()

        def to_date(date_str: str | None) -> date | None:
            return datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else None

        p1_start, p1_end = to_date(config_data.get("primerSemestreStart")), to_date(config_data.get("primerSemestreEnd"))
        p2_start, p2_end = to_date(config_data.get("segundoSemestreStart")), to_date(config_data.get("segundoSemestreEnd"))
        
        semester_start_date, semester_end_date = None, None
        
        if p1_start and p1_end and p1_start <= today <= p1_end: semester_start_date, semester_end_date = p1_start, p1_end
        elif p2_start and p2_end and p2_start <= today <= p2_end: semester_start_date, semester_end_date = p2_start, p2_end
        else:
            if p1_start and p1_start > today: semester_start_date, semester_end_date = p1_start, p1_end
            elif p2_start and p2_start > today: semester_start_date, semester_end_date = p2_start, p2_end
            else: semester_start_date, semester_end_date = p2_start, p2_end
        
        if not semester_start_date or not semester_end_date:
            raise HTTPException(status_code=404, detail="No se pudieron determinar las fechas del semestre actual.")
        
        # --- 2. OBTENER Y PROCESAR PERSONAS DEL CURSO ---
        # (Esta sección no necesita cambios, se mantiene igual)
        enrollments = await call_canvas_api(f"/courses/{canvas_course_id}/enrollments", params={"per_page": 200})
        professors_in_section, assistants_in_section, students_to_enroll_uids = [], [], []

        for enrollment in enrollments:
            user_info, canvas_role = enrollment.get("user"), enrollment.get("type")
            if not user_info or not user_info.get("login_id") or not user_info.get("id"): continue

            canvas_user_id = str(user_info.get("id"))
            user_email, full_name, sortable_name = user_info.get("login_id").lower(), user_info.get("name"), user_info.get("sortable_name")
            nombres, apellidos = "", ""
            if sortable_name and "," in sortable_name:
                parts = sortable_name.split(',', 1); apellidos, nombres = parts[0].strip(), parts[1].strip()
            else:
                name_parts = (full_name or "").split()
                if len(name_parts) > 2: apellidos, nombres = " ".join(name_parts[-2:]), " ".join(name_parts[:-2])
                elif len(name_parts) == 2: nombres, apellidos = name_parts[0], name_parts[1]
                else: nombres = full_name

            our_roles, is_student_role = [], False
            if canvas_role == "TeacherEnrollment": our_roles = ["profesor"]
            elif canvas_role == "TaEnrollment": our_roles = ["ayudante", "estudiante"]
            elif canvas_role == "StudentEnrollment": our_roles = ["estudiante"]; is_student_role = True
            else: continue

            profile_data = {"email": user_email, "displayName": full_name, "nombres": nombres, "apellidos": apellidos, "roles": our_roles, "lmsUserId": int(canvas_user_id)}
            try:
                await asyncio.to_thread(auth.get_user, canvas_user_id)
                profile_data["lastUpdatedFromLMS"] = firestore.SERVER_TIMESTAMP
                await asyncio.to_thread(db.collection('users').document(canvas_user_id).set, profile_data, merge=True)
            except auth.UserNotFoundError:
                try:
                    await asyncio.to_thread(auth.create_user, uid=canvas_user_id, email=user_email, display_name=full_name)
                    profile_data["createdAt"] = firestore.SERVER_TIMESTAMP
                    await asyncio.to_thread(db.collection('users').document(canvas_user_id).set, profile_data)
                except Exception as e:
                    logger.error(f"Error CRÍTICO al crear usuario {user_email} con UID {canvas_user_id}: {e}"); continue

            user_data_for_section = {"uid": canvas_user_id, "displayName": full_name}
            if "profesor" in our_roles: professors_in_section.append(user_data_for_section)
            if "ayudante" in our_roles: assistants_in_section.append(user_data_for_section)
            if is_student_role: students_to_enroll_uids.append(canvas_user_id)

        # --- 3. OBTENER Y PROCESAR HORARIO DEL CALENDARIO ---
        # (Esta sección no necesita cambios, se mantiene igual)
        valid_meeting_types = ["Cátedra", "Ayudantía", "Laboratorio"]
        weekly_schedule_from_canvas, schedule_keys = [], set()
        chile_tz, days_map = pytz.timezone('America/Santiago'), {0: "LUNES", 1: "MARTES", 2: "MIÉRCOLES", 3: "JUEVES", 4: "VIERNES", 5: "SÁBADO", 6: "DOMINGO"}
        
        try:
            params = {"context_codes[]": f"course_{canvas_course_id}", "start_date": semester_start_date.isoformat(), "end_date": semester_end_date.isoformat(), "per_page": 200}
            calendar_events = await call_canvas_api("/calendar_events", params=params)
            for event in calendar_events:
                title, type_found = event.get("title", ""), None
                for v_type in valid_meeting_types:
                    if title.strip().startswith(v_type): type_found = v_type; break
                if type_found and event.get("start_at") and event.get("end_at"):
                    start = datetime.fromisoformat(event.get("start_at").replace("Z", "+00:00")).astimezone(chile_tz)
                    end = datetime.fromisoformat(event.get("end_at").replace("Z", "+00:00")).astimezone(chile_tz)
                    key = f"{days_map[start.weekday()]}-{start.strftime('%H:%M')}"
                    if key not in schedule_keys:
                        weekly_schedule_from_canvas.append({"dayOfWeek": days_map[start.weekday()], "startTime": start.strftime('%H:%M'), "endTime": end.strftime('%H:%M'), "location": event.get("location_name", ""),"meetingType": type_found})
                        schedule_keys.add(key)
        except Exception as e: logger.error(f"Error al obtener horario de Canvas: {e}")

        # --- 4. CREAR/ACTUALIZAR CURSO Y SECCIÓN ---
        # (Esta sección no necesita cambios, se mantiene igual)
        course_id_in_firestore = create_firestore_id_from_name(course_name_from_canvas)
        course_ref = db.collection('courses').document(course_id_in_firestore)
        course_doc = await asyncio.to_thread(course_ref.get)
        if not course_doc.exists:
            await asyncio.to_thread(course_ref.set, {"courseName": course_name_from_canvas, "createdAt": firestore.SERVER_TIMESTAMP, "createdByUID": "canvas"})
        
        section_id_in_firestore = str(canvas_course_id)
        section_ref = db.collection('sections').document(section_id_in_firestore)
        section_data_to_save = {"courseID": course_id_in_firestore, "courseName": course_name_from_canvas, "sectionIdentifier": section_identifier_from_canvas, "lmsCourseId": canvas_course_id, "professorsInfo": professors_in_section, "professorUIDs": [p['uid'] for p in professors_in_section], "assistantsInfo": assistants_in_section, "assistantUIDs": [a['uid'] for a in assistants_in_section], "lastSyncedFromLMS": firestore.SERVER_TIMESTAMP}
        if weekly_schedule_from_canvas:
            section_data_to_save["weeklySchedule"] = weekly_schedule_from_canvas
        await asyncio.to_thread(section_ref.set, section_data_to_save, merge=True)

        # --- 5. MATRICULAR ESTUDIANTES ---
        # (Esta sección no necesita cambios, se mantiene igual)
        if students_to_enroll_uids:
            batch = db.batch()
            for uid in students_to_enroll_uids:
                enrollment_doc_ref = section_ref.collection('enrolledUsers').document(uid)
                batch.set(enrollment_doc_ref, {"enrollmentDate": firestore.SERVER_TIMESTAMP, "source": "canvas_sync"})
            await asyncio.to_thread(batch.commit)

        # --- 6. DEVOLVER PROPUESTA O SOLICITUD DE HORARIO ---
        # --- INICIO DE LA CORRECCIÓN ---
        if not weekly_schedule_from_canvas:
            # Si no hay horario, se devuelve un estado que el frontend entenderá para abrir el modal manual.
            # Se incluye el objeto 'proposal' con las fechas del semestre para que el modal las muestre.
            return {
                "status": "requires_manual_schedule",
                "sectionId": section_ref.id,
                "message": f"La sección '{section_identifier_from_canvas}' fue sincronizada, pero no se encontró un horario en Canvas. Por favor, configúralo manualmente.",
                "proposal": {
                    "meetingCount": 0, # El conteo inicial es 0
                    "startDate": semester_start_date.isoformat(),
                    "endDate": semester_end_date.isoformat(),
                    "weeklySchedule": [] # Se envía un horario vacío
                }
            }
        # --- FIN DE LA CORRECCIÓN ---

        # Si se encontró horario, se procede con la propuesta
        meeting_count = 0
        days_map_reverse = {v: k for k, v in days_map.items()}
        current_date = semester_start_date
        while current_date <= semester_end_date:
            day_of_week_num = current_date.weekday()
            for item in weekly_schedule_from_canvas:
                if days_map_reverse.get(item['dayOfWeek']) == day_of_week_num:
                    meeting_count += 1
            current_date += timedelta(days=1)

        return {
            "status": "proposal_ready",
            "sectionId": section_ref.id,
            "message": f"Sección '{section_identifier_from_canvas}' sincronizada. Se propone crear {meeting_count} reuniones.",
            "proposal": {
                "meetingCount": meeting_count,
                "startDate": semester_start_date.isoformat(),
                "endDate": semester_end_date.isoformat(),
                "weeklySchedule": weekly_schedule_from_canvas
            }
        }

    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error procesando el curso de Canvas {canvas_course_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {str(e)}")
    
class ScheduleUpdateRequest(BaseModel):
    weeklySchedule: List[WeeklyScheduleItem] # Reutiliza el Pydantic model que ya tenías

@app.put("/sections/{section_id}/schedule", status_code=200, tags=["Sections", "Admin"])
async def update_section_schedule(
    section_id: str,
    payload: ScheduleUpdateRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Actualiza únicamente el horario semanal de una sección existente.
    Usado por el modal de sincronización con el LMS.
    """
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=403, detail="No tienes permiso para modificar secciones.")
    
    section_ref = db.collection('sections').document(section_id)
    
    try:
        # Usamos update para no sobreescribir el resto de los datos de la sección
        await asyncio.to_thread(section_ref.update, {
            "weeklySchedule": [item.model_dump() for item in payload.weeklySchedule]
        })
        logger.info(f"Horario actualizado para la sección {section_id} por el admin {current_user.get('uid')}.")
        return {"status": "success", "message": "Horario actualizado correctamente."}
    except Exception as e:
        logger.error(f"Error actualizando horario para la sección {section_id}: {e}", exc_info=True)
        # Si la sección no existe, .update() lanzará un error que podemos capturar
        raise HTTPException(status_code=500, detail=f"No se pudo actualizar el horario: {str(e)}")

class MeetingsCreationRequest(BaseModel):
    startDate: str = Field(..., description="Fecha de inicio en formato YYYY-MM-DD")
    endDate: str = Field(..., description="Fecha de fin en formato YYYY-MM-DD")

@app.post("/sections/{section_id}/create-meetings-from-schedule", tags=["Sections", "Admin"])
async def create_meetings_from_section_schedule(
    section_id: str,
    request_data: MeetingsCreationRequest, # <-- Acepta el rango de fechas del body
    current_user: dict = Depends(get_current_user)
):
    """
    Crea reuniones de clase en lote para una sección específica basándose en su
    horario semanal guardado y un rango de fechas proporcionado en la solicitud.
    """
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para realizar esta acción.")

    logger.info(f"--- INICIANDO CREACIÓN DE REUNIONES PARA SECCIÓN: {section_id} ---")

    # 1. Obtener los datos de la sección desde Firestore
    section_ref = db.collection('sections').document(section_id)
    section_doc = await asyncio.to_thread(section_ref.get)
    if not section_doc.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="La sección especificada no fue encontrada.")

    section_data = section_doc.to_dict()
    weekly_schedule = section_data.get("weeklySchedule")
    
    if not weekly_schedule:
        raise HTTPException(status_code=400, detail="La sección no tiene un horario semanal configurado.")
    
    logger.info(f"DEBUG: Horario semanal encontrado para la sección: {weekly_schedule}")

    # --- INICIO DE LA CORRECCIÓN ---
    # 2. Validar y usar las fechas del request, en lugar de buscar las del semestre.
    try:
        start_date_from_request = datetime.strptime(request_data.startDate, "%Y-%m-%d").date()
        end_date_from_request = datetime.strptime(request_data.endDate, "%Y-%m-%d").date()
        logger.info(f"DEBUG: Usando rango de fechas del request: {start_date_from_request} a {end_date_from_request}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Usar YYYY-MM-DD.")
    # --- FIN DE LA CORRECCIÓN ---

    # 3. Preparar el proceso por lotes (batch) para Firestore
    batch = db.batch()
    meetings_created_count = 0
    chile_tz = pytz.timezone('America/Santiago')
    days_map = {0: "LUNES", 1: "MARTES", 2: "MIÉRCOLES", 3: "JUEVES", 4: "VIERNES", 5: "SÁBADO", 6: "DOMINGO"}
    prof_uids, asst_uids = section_data.get("professorUIDs", []), section_data.get("assistantUIDs", [])

    # 4. Iterar sobre el rango de fechas proporcionado por el usuario
    current_date = start_date_from_request
    logger.info("DEBUG: Iniciando bucle de fechas...")
    while current_date <= end_date_from_request:
        day_of_week_num = current_date.weekday()
        day_of_week_str = days_map.get(day_of_week_num)
        
        logger.info(f"  -> Revisando fecha: {current_date} (Día de la semana: {day_of_week_str})")
        
        if day_of_week_str:
            for item in weekly_schedule:
                if item.get("dayOfWeek") == day_of_week_str:
                    logger.info(f"      ✅ ¡COINCIDENCIA ENCONTRADA! Para el día {day_of_week_str}. Creando reunión.")
                    try:
                        start_h, start_m = map(int, item["startTime"].split(':'))
                        end_h, end_m = map(int, item["endTime"].split(':'))
                        
                        meeting_start_dt = chile_tz.localize(datetime.combine(current_date, py_time(hour=start_h, minute=start_m)))
                        meeting_end_dt = chile_tz.localize(datetime.combine(current_date, py_time(hour=end_h, minute=end_m)))

                        responsible_uids = set(prof_uids)
                        if item.get("meetingType", "").upper() == "AYUDANTÍA":
                            responsible_uids.update(asst_uids)

                        meeting_payload = {
                            "sectionID": section_id, 
                            "courseID": section_data.get("courseID"),
                            "meetingDateTime": meeting_start_dt, 
                            "endTime": meeting_end_dt,
                            "location": item.get("location", ""), 
                            "meetingType": item.get("meetingType"),
                            "isActiveForAttendance": False, 
                            "responsibleUIDs": list(responsible_uids),
                            "createdAt": firestore.SERVER_TIMESTAMP
                        }
                        
                        new_meeting_ref = db.collection('classMeetings').document()
                        batch.set(new_meeting_ref, meeting_payload)
                        meetings_created_count += 1
                    except (ValueError, KeyError) as e:
                        logger.warning(f"Omitiendo creación de reunión por datos de horario inválidos: {item}. Error: {e}")

        current_date += timedelta(days=1)
    
    # 5. Ejecutar el lote y devolver el resultado
    if meetings_created_count > 0:
        await asyncio.to_thread(batch.commit)
        logger.info(f"Se crearon {meetings_created_count} reuniones para la sección {section_id}.")
        return {"status": "success", "message": f"Se crearon exitosamente {meetings_created_count} reuniones."}
    else:
        logger.warning(f"No se crearon reuniones para la sección {section_id} con el horario y rango de fechas proporcionado.")
        return {"status": "success", "message": "No se crearon nuevas reuniones para el intervalo seleccionado."}

class GradeSyncRequest(BaseModel):
    assignment_name: str = Field(default="Asistencia Plataforma", description="Nombre de la tarea a crear en Canvas")

# --- Endpoint Simplificado y Corregido ---
# La ruta ahora espera el ID del documento de la sección directamente
@app.post("/lms/canvas/sections/{section_id}/sync-attendance-grades", tags=["LMS Integration"])
async def sync_attendance_grades_to_canvas(
    section_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Sincroniza los porcentajes de asistencia de una sección con Canvas,
    creando una tarea separada para cada tipo de reunión (Cátedra, Ayudantía, etc.).
    """
    user_roles = current_user.get("roles", [])
    if not any(role in user_roles for role in ["admin", "profesor"]):
        raise HTTPException(status_code=403, detail="No tienes permiso para realizar esta acción.")

    try:
        section_ref = db.collection('sections').document(section_id)
        section_doc = await asyncio.to_thread(section_ref.get)
        if not section_doc.exists:
            raise HTTPException(status_code=404, detail=f"No se encontró ninguna sección con el ID '{section_id}'.")
        section_data = section_doc.to_dict()
    except Exception as e:
        logger.error(f"Error buscando la sección con ID '{section_id}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error al buscar la sección en la base de datos.")

    canvas_course_id = section_data.get("lmsCourseId")
    if not canvas_course_id:
        raise HTTPException(status_code=400, detail="La sección no está vinculada a un curso de Canvas (falta lmsCourseId).")

    logger.info(f"Iniciando sincronización de notas para la sección {section_id} (Curso Canvas: {canvas_course_id}).")

    matrix_data = await get_section_attendance_matrix_internal(section_id)
    students_with_grades = matrix_data.get("studentsAttendance", [])
    if not students_with_grades:
        return {"status": "success", "message": "No hay estudiantes con calificaciones para sincronizar."}

    available_types = matrix_data.get('availableMeetingTypes', [])
    if not available_types:
        return {"status": "success", "message": "La sección no tiene reuniones con tipos definidos."}
        
    logger.info(f"Tipos de reunión encontrados: {available_types}")

    try:
        existing_assignments = await call_canvas_api(f"/courses/{canvas_course_id}/assignments", params={"per_page": 100})
        existing_assignment_names = {a['name']: a['id'] for a in existing_assignments}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener tareas de Canvas: {e}")

    total_grades_synced = 0
    processed_tasks = []

    for meeting_type in available_types:
        assignment_name = f"Asistencia {meeting_type}"
        assignment_id = existing_assignment_names.get(assignment_name)

        if not assignment_id:
            logger.info(f"Creando nueva tarea: '{assignment_name}'...")
            assignment_payload = {"assignment": {"name": assignment_name, "submission_types": ["none"], "points_possible": 100, "published": True}}
            try:
                new_assignment = await call_canvas_api(f"/courses/{canvas_course_id}/assignments", method="POST", data=assignment_payload)
                assignment_id = new_assignment.get("id")
                logger.info(f"Tarea '{assignment_name}' creada con ID: {assignment_id}")
            except Exception as e:
                logger.error(f"Error al crear tarea '{assignment_name}': {e}")
                continue

        if not assignment_id:
            continue

        # --- INICIO DE LA CORRECCIÓN CLAVE ---
        # El payload debe ser un diccionario anidado, no plano.
        grades_for_type = {}
        for student in students_with_grades:
            student_uid = student.get('studentUid')
            percentage = student.get('percentagesByType', {}).get(meeting_type)
            if student_uid and percentage is not None:
                grades_for_type[student_uid] = {"posted_grade": f"{percentage:.2f}"}
        
        if not grades_for_type:
            logger.info(f"No hay calificaciones que enviar para '{meeting_type}'.")
            continue
            
        # El payload final que se enviará a la API
        submissions_payload = {"grade_data": grades_for_type}
        # --- FIN DE LA CORRECCIÓN CLAVE ---
            
        try:
            endpoint = f"/courses/{canvas_course_id}/assignments/{assignment_id}/submissions/update_grades"
            await call_canvas_api(endpoint, method="POST", data=submissions_payload)
            logger.info(f"Se enviaron {len(grades_for_type)} calificaciones para la tarea '{assignment_name}'.")
            total_grades_synced += len(grades_for_type)
            processed_tasks.append(assignment_name)
        except Exception as e:
            logger.error(f"Error al enviar calificaciones para '{assignment_name}': {e}")

    return {
        "status": "success",
        "message": f"Sincronización completada. Se procesaron {total_grades_synced} calificaciones en las tareas: {', '.join(processed_tasks) if processed_tasks else 'ninguna'}."
    }

@app.get("/export/section/{section_id}/attendance", tags=["Export"])
async def export_section_attendance_csv(
    section_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Recopila los datos de asistencia detallados de una sección, incluyendo
    perfiles de estudiantes, y los devuelve como JSON para exportación en el frontend.
    """
    # 1. Obtener datos de la matriz de asistencia (reutiliza la lógica interna)
    matrix_data = await get_section_attendance_matrix_internal(section_id)
    students_attendance = matrix_data.get("studentsAttendance", [])
    available_meeting_types = matrix_data.get("availableMeetingTypes", [])

    if not students_attendance:
        # Devuelve una estructura vacía si no hay estudiantes
        return {"students_data": [], "meeting_types": []}

    student_uids = [student.get("studentUid") for student in students_attendance if student.get("studentUid")]

    # 2. Obtener los perfiles completos de los estudiantes desde la colección 'users'
    student_profiles: Dict[str, Dict[str, Any]] = {}
    if student_uids:
        # Dividir en lotes para cumplir con el límite de Firestore en consultas 'in'
        batched_uids = [student_uids[i:i + 30] for i in range(0, len(student_uids), 30)]
        for batch in batched_uids:
            if not batch: continue
            users_query = db.collection('users').where('__name__', 'in', batch)
            user_docs = await asyncio.to_thread(list, users_query.stream())
            for doc in user_docs:
                user_data = doc.to_dict()
                student_profiles[doc.id] = {
                    "nombres": user_data.get("nombres", ""),
                    "apellidos": user_data.get("apellidos", ""),
                    "correo": user_data.get("email", ""),
                    "rut": user_data.get("rut", "")
                }

    # 3. Combinar los datos del perfil con los datos de asistencia
    export_data = []
    for student_att in students_attendance:
        uid = student_att.get("studentUid")
        if not uid: continue
        
        profile = student_profiles.get(uid, {})
        
        combined_data = {
            "apellidos": profile.get("apellidos", ""),
            "nombres": profile.get("nombres", ""),
            "correo": profile.get("correo", ""),
            "rut": profile.get("rut", ""),
            "porcentaje_general": student_att.get("overallAttendancePercentage", 0),
            "porcentajes_por_tipo": student_att.get("percentagesByType", {}) # Se pasa el desglose completo
        }
        export_data.append(combined_data)

    # 4. Devolver el payload JSON final
    return {
        "students_data": export_data,
        "meeting_types": sorted(available_meeting_types) # Ordenado para consistencia
    }

@app.get("/export/snapshot/{snapshot_id}", tags=["Export"])
async def export_snapshot_csv(
    snapshot_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Recopila los resultados de un snapshot, enriquece los datos de los
    estudiantes y devuelve un JSON con un formato de columnas específico
    para la exportación a XLSX.
    """
    # 1. Obtener los detalles del snapshot
    snapshot_details = await get_snapshot_details(snapshot_id, current_user)
    results = snapshot_details.results

    if not results:
        return {"snapshotName": snapshot_details.snapshotName, "headers": [], "rows": []}

    student_uids = list(set([res.studentUid for res in results]))

    # 2. Obtener perfiles completos de los estudiantes
    student_profiles: Dict[str, Dict[str, Any]] = {}
    if student_uids:
        batched_uids = [student_uids[i:i + 30] for i in range(0, len(student_uids), 30)]
        for batch in batched_uids:
            if not batch: continue
            users_query = db.collection('users').where('__name__', 'in', batch)
            user_docs = await asyncio.to_thread(list, users_query.stream())
            for doc in user_docs:
                user_data = doc.to_dict()
                student_profiles[doc.id] = {
                    "apellidos": user_data.get("apellidos", ""),
                    "nombres": user_data.get("nombres", ""),
                    "correo": user_data.get("email", ""),
                    "rut": user_data.get("rut", "")
                }
    
    # 3. Construir cabeceras y filas con el formato solicitado
    # Columnas de tipo de reunión fijas
    fixed_meeting_types = ["Ayudantía", "Cátedra", "Laboratorio"]
    headers = ["Apellidos", "Nombres", "Correo", "RUT", "Curso", "Sección"] + [f"Asistencia {mtype} (%)" for mtype in fixed_meeting_types]
    
    rows = []
    for student_result in results:
        profile = student_profiles.get(student_result.studentUid, {})
        row_data = [
            profile.get("apellidos", ""),
            profile.get("nombres", ""),
            profile.get("correo", ""),
            profile.get("rut", ""),
            student_result.courseName,
            student_result.sectionIdentifier
        ]
        # Añadir el porcentaje para cada tipo de reunión fijo
        for mtype in fixed_meeting_types:
            row_data.append(student_result.percentagesByType.get(mtype, "N/A"))
        
        rows.append(row_data)

    # 4. Devolver el payload JSON
    return {
        "snapshotName": snapshot_details.snapshotName,
        "headers": headers,
        "rows": rows
    }

@app.get("/export/daily-report-excel/{report_date}", tags=["Export", "Admin"])
async def export_daily_report_for_excel(
    report_date: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Recopila todos los datos necesarios para un reporte diario detallado en formato Excel.
    Devuelve un objeto JSON con una hoja de resumen y hojas de detalle para cada sección activada.
    """
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=403, detail="No tienes permiso para generar este reporte.")

    # 1. Obtener el reporte diario principal (sin cambios)
    try:
        main_report_data = await get_daily_report(report_date, current_user)
    except HTTPException as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail=f"No existe un reporte para la fecha {report_date}.")
        raise e

    # 2. Preparar la hoja de resumen (sin cambios)
    summary_sheet_data = []
    summary_sheet_data.append(["Reporte Diario de Actividad"])
    summary_sheet_data.append(["Fecha:", report_date])
    summary_sheet_data.append([])
    summary = main_report_data.get('summary', {})
    summary_sheet_data.append(["Resumen General"])
    summary_sheet_data.append(["Total Clases Programadas", summary.get("totalMeetings", "N/A")])
    summary_sheet_data.append(["Clases Activadas", summary.get("activatedMeetings", "N/A")])
    summary_sheet_data.append(["Clases No Activadas", summary.get("notActivatedMeetings", "N/A")])
    summary_sheet_data.append([])
    summary_sheet_data.append(["Detalle de Secciones No Activadas"])
    summary_sheet_data.append(["Curso", "Sección", "Tipo de Reunión", "Hora Programada"])
    for meeting in main_report_data.get('notActivatedMeetings', []):
        summary_sheet_data.append([
            meeting.get("courseName"), meeting.get("sectionIdentifier"),
            meeting.get("meetingType"), meeting.get("meetingTime")
        ])
    summary_sheet_data.append([])
    summary_sheet_data.append(["Detalle de Secciones con Asistencia 100% Manual"])
    summary_sheet_data.append(["Curso", "Sección", "Tipo de Reunión", "Hora Programada"])
    for meeting in main_report_data.get('allManualAttendanceMeetings', []):
        summary_sheet_data.append([
            meeting.get("courseName"), meeting.get("sectionIdentifier"),
            meeting.get("meetingType"), meeting.get("meetingTime")
        ])

    # 3. Obtener todas las reuniones activadas para esa fecha (sin cambios)
    report_date_obj = datetime.strptime(report_date, '%Y-%m-%d')
    start_of_day = chile_tz.localize(report_date_obj.replace(hour=0, minute=0, second=0, microsecond=0))
    end_of_day = start_of_day + timedelta(days=1)
    meetings_query = db.collection('classMeetings').where('meetingDateTime', '>=', start_of_day).where('meetingDateTime', '<', end_of_day).where('isActiveForAttendance', '==', True)
    activated_meetings_docs = await asyncio.to_thread(list, meetings_query.stream())

    detail_sheets = []

    # 4. Para cada reunión activada, obtener su detalle de asistencia y perfiles de usuario
    for meeting_doc in activated_meetings_docs:
        meeting_id = meeting_doc.id
        try:
            attendance_details = await get_meeting_attendance_details(meeting_id, current_user)
            
            students_in_meeting = attendance_details.get('students', [])
            student_uids = [s.get("uid") for s in students_in_meeting if s.get("uid")]

            student_profiles: Dict[str, Dict[str, Any]] = {}
            if student_uids:
                batched_uids = [student_uids[i:i + 30] for i in range(0, len(student_uids), 30)]
                for batch in batched_uids:
                    if not batch: continue
                    users_query = db.collection('users').where('__name__', 'in', batch)
                    user_docs = await asyncio.to_thread(list, users_query.stream())
                    for doc in user_docs:
                        user_data = doc.to_dict()
                        student_profiles[doc.id] = {
                            "apellidos": user_data.get("apellidos", ""),
                            "nombres": user_data.get("nombres", ""),
                            "correo": user_data.get("email", ""),
                            "rut": user_data.get("rut", "")
                        }

            meeting_info = attendance_details.get('meetingDetails', {})
            
            # --- INICIO DE LA CORRECCIÓN ---
            # Se genera el nombre de la hoja con el nuevo formato
            course_id = meeting_info.get('courseID', 'CursoID')
            section_identifier = meeting_info.get('sectionIdentifier', 'Seccion')
            
            # Extrae el último fragmento después del espacio (ej., "1" o "12")
            section_number = section_identifier.split(' ')[-1]
            
            # Combina el ID del curso y el número de la sección
            sheet_title = f"{course_id}-{section_number}"
            # --- FIN DE LA CORRECCIÓN ---
            
            sheet_data = []
            sheet_data.append(["Apellidos", "Nombres", "Correo", "RUT", "Asistió", "Registrado Por", "Hora de Registro"])
            
            students_in_meeting.sort(key=lambda s: student_profiles.get(s.get("uid", ""), {}).get("apellidos", ""))

            for student in students_in_meeting:
                uid = student.get("uid")
                profile = student_profiles.get(uid, {})
                sheet_data.append([
                    profile.get("apellidos", ""),
                    profile.get("nombres", ""),
                    profile.get("correo", ""),
                    profile.get("rut", ""),
                    "Sí" if student.get("attended") else "No",
                    student.get("validatedBy", "-"),
                    student.get("validationTimestamp", "-")
                ])

            detail_sheets.append({"title": sheet_title, "data": sheet_data})

        except Exception as e:
            logger.error(f"Error obteniendo detalle para meeting {meeting_id} en reporte excel: {e}")
            detail_sheets.append({"title": f"Error-{meeting_id[:8]}", "data": [["Error al cargar datos para esta sección."]]})

    # 5. Construir y devolver la respuesta JSON completa (sin cambios)
    return {
        "summarySheet": {
            "title": "Resumen General",
            "data": summary_sheet_data
        },
        "detailSheets": detail_sheets
    }

class AttendanceBreakdownItem(BaseModel):
    type: str
    asistencia: float

class CourseAttendanceBreakdown(BaseModel):
    courseName: str
    attendance_breakdown: List[AttendanceBreakdownItem]

class AnalyticsChartDataItem(BaseModel):
    name: str
    id: Optional[str] = None
    class Config:
        extra = "allow"

class CourseDetailAnalytics(BaseModel):
    course_name: str
    attendance_chart_data: List[AnalyticsChartDataItem]
    meeting_types: List[str]

class CriticalRiskByType(BaseModel):
    type: str
    at_risk_count: int
    total_students_in_type: int

# --- MODIFICA EL MODELO AnalyticsSummary ---
class AnalyticsSummary(BaseModel):
    total_students: int
    total_sections: int
    avg_attendance: float
    critical_risk_by_type: List[CriticalRiskByType] # <-- MODIFICADO
    attendance_chart_data: List[AnalyticsChartDataItem]
    meeting_types: List[str]
    students_at_risk: List[Dict[str, Any]]
    generatedAt: datetime
    course_details: Dict[str, CourseDetailAnalytics]

# Nuevo modelo para la respuesta del detalle del curso
class CourseDetailAnalytics(BaseModel):
    course_name: str
    attendance_chart_data: List[AnalyticsChartDataItem]
    meeting_types: List[str]

async def generate_analytics_summary():
    """
    Calcula el resumen completo de analíticas y lo guarda en Firestore.
    """
    logger.info("--- Iniciando generación de resumen de analíticas diario ---")
    
    try:
        # 1. Obtener conteos básicos
        students_query = db.collection('users').where('roles', 'array_contains', 'estudiante').stream()
        sections_query = db.collection('sections').stream()
        total_students = len(list(await asyncio.to_thread(list, students_query)))
        all_sections_docs = await asyncio.to_thread(list, sections_query)
        total_sections = len(all_sections_docs)

        # 2. Calcular asistencia y recopilar datos de riesgo
        all_attendance_percentages = []
        all_student_attendances_by_type: Dict[str, Dict[str, int]] = {}
        students_per_type: Dict[str, Set[str]] = {}

        for section_doc in all_sections_docs:
            section_id = section_doc.id
            matrix_data = await get_section_attendance_matrix_internal(section_id)
            
            section_student_averages = [s['overallAttendancePercentage'] for s in matrix_data.get('studentsAttendance', [])]
            if section_student_averages:
                all_attendance_percentages.append(sum(section_student_averages) / len(section_student_averages))

            for student in matrix_data.get('studentsAttendance', []):
                student_uid = student['studentUid']
                if student_uid not in all_student_attendances_by_type:
                    all_student_attendances_by_type[student_uid] = {}
                
                for m_type, percentage in student.get('percentagesByType', {}).items():
                    if m_type not in all_student_attendances_by_type[student_uid] or percentage < all_student_attendances_by_type[student_uid][m_type]:
                        all_student_attendances_by_type[student_uid][m_type] = percentage
                    if m_type not in students_per_type:
                        students_per_type[m_type] = set()
                    students_per_type[m_type].add(student_uid)

        # 3. Calcular el KPI de riesgo crítico por tipo
        critical_risk_by_type_list: List[dict] = []
        critical_risk_threshold = 50 
        all_meeting_types_found = sorted(list(students_per_type.keys()))

        for m_type in all_meeting_types_found:
            at_risk_count = 0
            for student_uid in students_per_type[m_type]:
                student_percentages = all_student_attendances_by_type.get(student_uid, {})
                if student_percentages.get(m_type, 100) < critical_risk_threshold:
                    at_risk_count += 1
            
            critical_risk_by_type_list.append({
                "type": m_type,
                "at_risk_count": at_risk_count,
                "total_students_in_type": len(students_per_type[m_type])
            })
        
        # 4. Lógica para pivotar datos del gráfico y course_details (sin cambios)
        course_type_percentages: Dict[str, Dict[str, List[float]]] = {}
        section_type_percentages: Dict[str, Dict[str, List[float]]] = {} 
        sections_by_course: Dict[str, List[Dict]] = {}
        for section_doc in all_sections_docs:
            section_id = section_doc.id; section_data = section_doc.to_dict(); course_name = section_data.get("courseName", "Desconocido"); section_identifier = section_data.get("sectionIdentifier", section_id)
            if course_name not in sections_by_course: sections_by_course[course_name] = []
            sections_by_course[course_name].append({"id": section_id, "identifier": section_identifier})
            matrix_data = await get_section_attendance_matrix_internal(section_id)
            for student in matrix_data.get('studentsAttendance', []):
                if course_name not in course_type_percentages: course_type_percentages[course_name] = {}
                if section_id not in section_type_percentages: section_type_percentages[section_id] = {}
                for meeting_type, percentage in student.get('percentagesByType', {}).items():
                    if meeting_type not in course_type_percentages[course_name]: course_type_percentages[course_name][meeting_type] = []
                    if meeting_type not in section_type_percentages[section_id]: section_type_percentages[section_id][meeting_type] = []
                    course_type_percentages[course_name][meeting_type].append(percentage); section_type_percentages[section_id][meeting_type].append(percentage)
        all_meeting_types_global = sorted(list(set(mtype for course in course_type_percentages.values() for mtype in course.keys())))
        pivoted_data_courses = []
        for course_name, types_data in sorted(course_type_percentages.items()):
            row = {"name": course_name}
            for m_type in all_meeting_types_global: avg = sum(types_data.get(m_type, [0])) / len(types_data.get(m_type, [1])); row[m_type] = round(avg, 2)
            pivoted_data_courses.append(row)
        course_details_to_save: Dict[str, Any] = {}
        for course_name, sections in sections_by_course.items():
            all_meeting_types_course = sorted(list(set(mtype for section in sections for mtype in section_type_percentages.get(section['id'], {}).keys())))
            pivoted_data_sections = []
            for section in sorted(sections, key=lambda x: x['identifier']):
                section_identifier = section['identifier']; section_id_key = section['id']; row = {"name": section_identifier, "id": section_id_key}; types_data = section_type_percentages.get(section_id_key, {})
                for m_type in all_meeting_types_course: avg = sum(types_data.get(m_type, [0])) / len(types_data.get(m_type, [1])); row[m_type] = round(avg, 2)
                pivoted_data_sections.append(row)
            course_details_to_save[course_name] = CourseDetailAnalytics(course_name=course_name, attendance_chart_data=[AnalyticsChartDataItem(**d) for d in pivoted_data_sections], meeting_types=all_meeting_types_course).model_dump()
        
        avg_attendance = sum(all_attendance_percentages) / len(all_attendance_percentages) if all_attendance_percentages else 0

        # 5. Obtener estudiantes en riesgo del último snapshot (sin cambios)
        students_at_risk = []
        try:
            admin_user_dummy = {"roles": ["admin"]}
            early_warning_data = await get_early_warning_report(admin_user_dummy)
            if early_warning_data.latestSnapshot:
                top_risk_students = sorted(early_warning_data.latestSnapshot.results, key=lambda x: x.attendancePercentage)[:5]
                for student in top_risk_students:
                    students_at_risk.append({"name": student.studentName, "course": student.courseName, "percentage": student.attendancePercentage})
        except Exception:
            pass
        
        # 6. Construir y guardar el objeto final (CORREGIDO)
        summary_to_save = AnalyticsSummary(
            total_students=total_students,
            total_sections=total_sections,
            avg_attendance=round(avg_attendance, 2),
            critical_risk_by_type=critical_risk_by_type_list,
            # La línea que causaba el error ha sido eliminada
            attendance_chart_data=[AnalyticsChartDataItem(**d) for d in pivoted_data_courses],
            meeting_types=all_meeting_types_global,
            students_at_risk=students_at_risk,
            generatedAt=datetime.now(pytz.utc),
            course_details=course_details_to_save
        ).model_dump()
        
        report_id = datetime.now(chile_tz).strftime('%Y-%m-%d_%H-%M-%S')
        db.collection('analyticsSummaries').document(report_id).set(summary_to_save)
        
        logger.info(f"✅ Resumen de analíticas (con detalles de curso) generado y guardado con ID: {report_id}")

    except Exception as e:
        logger.error(f"❌ Error CRÍTICO durante la generación del resumen de analíticas: {e}", exc_info=True)

@app.get("/analytics/dashboard-summary", response_model=AnalyticsSummary, tags=["Analytics"])
async def get_dashboard_analytics_summary(current_user: dict = Depends(get_current_user)):
    """
    Obtiene el último resumen de analíticas guardado desde Firestore.
    """
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=403, detail="No tienes permiso para acceder a estas analíticas.")

    try:
        # --- INICIO DE LA CORRECCIÓN ---
        # Se reemplaza la constante incorrecta por la cadena especial '__name__'
        query = db.collection('analyticsSummaries').order_by('__name__', direction=firestore.Query.DESCENDING).limit(1)
        # --- FIN DE LA CORRECCIÓN ---
        
        docs = await asyncio.to_thread(list, query.stream())
        
        if not docs:
            raise HTTPException(status_code=404, detail="Aún no se ha generado ningún resumen de analíticas.")
        
        latest_summary = docs[0].to_dict()
        return AnalyticsSummary(**latest_summary)

    except Exception as e:
        logger.error(f"Error al obtener el último resumen de analíticas: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener los datos de analíticas.")


# --- INICIO: NUEVO ENDPOINT PARA DETALLE POR SECCIONES ---
@app.get("/analytics/course-detail/{course_name}", response_model=CourseDetailAnalytics, tags=["Analytics"])
async def get_course_detail_analytics(course_name: str, current_user: dict = Depends(get_current_user)):
    """
    Obtiene el desglose de asistencia por tipo de reunión para cada sección
    de un curso específico.
    """
    # 1. Encontrar todas las secciones para el curso dado
    sections_query = db.collection('sections').where('courseName', '==', course_name).stream()
    sections_docs = await asyncio.to_thread(list, sections_query)

    if not sections_docs:
        raise HTTPException(status_code=404, detail=f"No se encontraron secciones para el curso '{course_name}'.")

    # 2. Calcular la asistencia para cada sección
    section_type_percentages: Dict[str, Dict[str, List[float]]] = {}

    for section_doc in sections_docs:
        section_id = section_doc.id
        section_identifier = section_doc.to_dict().get("sectionIdentifier", section_id)
        
        matrix_data = await get_section_attendance_matrix_internal(section_id)

        for student in matrix_data.get('studentsAttendance', []):
            if section_identifier not in section_type_percentages:
                section_type_percentages[section_identifier] = {}
            
            for meeting_type, percentage in student.get('percentagesByType', {}).items():
                if meeting_type not in section_type_percentages[section_identifier]:
                    section_type_percentages[section_identifier][meeting_type] = []
                section_type_percentages[section_identifier][meeting_type].append(percentage)

    # 3. Pivotar los datos para el gráfico de secciones
    all_meeting_types = sorted(list(set(mtype for section in section_type_percentages.values() for mtype in section.keys())))
    
    pivoted_data = []
    for section_identifier, types_data in sorted(section_type_percentages.items()):
        row = {"name": section_identifier}
        for m_type in all_meeting_types:
            percentages_list = types_data.get(m_type)
            if percentages_list:
                avg = sum(percentages_list) / len(percentages_list)
                row[m_type] = round(avg, 2)
        pivoted_data.append(AnalyticsChartDataItem(**row))

    return CourseDetailAnalytics(
        course_name=course_name,
        attendance_chart_data=pivoted_data,
        meeting_types=all_meeting_types
    )

class DailyReportData(BaseModel):
    summary: Dict[str, int]
    notActivatedMeetings: List[Dict[str, Any]]
    allManualAttendanceMeetings: List[Dict[str, Any]]

class UnifiedAnalyticsResponse(BaseModel):
    analytics_summary: AnalyticsSummary
    daily_report: Optional[DailyReportData] = None

@app.get("/reports/daily/latest", response_model=DailyReportData, tags=["Reports", "Admin"])
async def get_latest_daily_report(current_user: dict = Depends(get_current_user)):
    # --- INICIO: PRUEBA DE DEPURACIÓN CON PRINT ---
    print("\n\n--- DEBUG: ¡LA FUNCIÓN get_latest_daily_report SÍ SE ESTÁ EJECUTANDO! ---\n")
    
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para ver este reporte.")

    try:
        print("--- DEBUG: Bloque try iniciado. Realizando consulta a Firestore...")
        
        query = db.collection('dailyReports').order_by('reportDate', direction=firestore.Query.DESCENDING).limit(1)
        docs = await asyncio.to_thread(list, query.stream())
        
        print(f"--- DEBUG: La consulta a Firestore encontró {len(docs)} documento(s).")

        if not docs:
            print("--- DEBUG: No se encontraron documentos. Lanzando error 404.")
            raise HTTPException(status_code=404, detail="No se ha generado ningún reporte diario todavía.")
        
        print(f"--- DEBUG: Se encontró el documento con ID: {docs[0].id}. Devolviendo datos.")
        return docs[0].to_dict()
        
    except Exception as e:
        print(f"--- DEBUG: Ocurrió una excepción en el bloque try: {e}")
        logger.error(f"Error al obtener el último reporte diario: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener el último reporte.")

# Endpoint para que el frontend pueda obtener el reporte de una fecha específica
@app.get("/reports/daily/{report_date}", tags=["Reports", "Admin"])
async def get_daily_report(report_date: str, current_user: dict = Depends(get_current_user)):
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para ver este reporte.")

    if not db:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Servicio no disponible.")
    
    try:
        report_doc_ref = db.collection('dailyReports').document(report_date)
        report_doc = await asyncio.to_thread(report_doc_ref.get)
        if not report_doc.exists:
            # Ahora, esta excepción llegará correctamente al frontend como un 404.
            raise HTTPException(status_code=404, detail=f"No se encontró un reporte para la fecha {report_date}.")
        
        return report_doc.to_dict()

    # --- INICIO DE LA CORRECCIÓN ---
    except HTTPException as http_exc:
        # Re-lanza la excepción HTTP para que FastAPI la maneje como corresponde.
        raise http_exc
    except Exception as e:
        # Captura cualquier otro error inesperado y lo convierte en un 500.
        logger.error(f"Error al obtener el reporte diario para la fecha {report_date}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener el reporte diario.")
    # --- FIN DE LA CORRECCIÓN ---

@app.get("/analytics/course-detail/{course_name}", response_model=CourseDetailAnalytics, tags=["Analytics"])
async def get_course_detail_analytics(course_name: str, current_user: dict = Depends(get_current_user)):
    """
    Obtiene el desglose de asistencia por tipo de reunión para cada sección
    de un curso específico.
    """
    user_roles = current_user.get("roles", [])
    if "admin" not in user_roles:
        raise HTTPException(status_code=403, detail="No tienes permiso para acceder a estas analíticas.")

    # 1. Encontrar todas las secciones para el curso dado
    sections_query = db.collection('sections').where('courseName', '==', course_name).stream()
    sections_docs = await asyncio.to_thread(list, sections_query)

    if not sections_docs:
        raise HTTPException(status_code=404, detail=f"No se encontraron secciones para el curso '{course_name}'.")

    # 2. Calcular la asistencia para cada sección
    section_type_percentages: Dict[str, Dict[str, List[float]]] = {}
    section_id_map: Dict[str, str] = {} # Para mapear identificador de sección a su ID de documento

    for section_doc in sections_docs:
        section_id = section_doc.id
        section_data = section_doc.to_dict()
        section_identifier = section_data.get("sectionIdentifier", section_id)
        section_id_map[section_identifier] = section_id
        
        matrix_data = await get_section_attendance_matrix_internal(section_id)

        for student in matrix_data.get('studentsAttendance', []):
            if section_identifier not in section_type_percentages:
                section_type_percentages[section_identifier] = {}
            
            for meeting_type, percentage in student.get('percentagesByType', {}).items():
                if meeting_type not in section_type_percentages[section_identifier]:
                    section_type_percentages[section_identifier][meeting_type] = []
                section_type_percentages[section_identifier][meeting_type].append(percentage)

    # 3. Pivotar los datos para el gráfico de secciones
    all_meeting_types = sorted(list(set(mtype for section in section_type_percentages.values() for mtype in section.keys())))
    
    pivoted_data = []
    for section_identifier, types_data in sorted(section_type_percentages.items()):
        row = {
            "name": section_identifier,
            "id": section_id_map.get(section_identifier) # Añadir el ID para la navegación
        }
        for m_type in all_meeting_types:
            percentages_list = types_data.get(m_type)
            if percentages_list:
                avg = sum(percentages_list) / len(percentages_list)
                row[m_type] = round(avg, 2)
        pivoted_data.append(AnalyticsChartDataItem(**row))

    return CourseDetailAnalytics(
        course_name=course_name,
        attendance_chart_data=pivoted_data,
        meeting_types=all_meeting_types
    )

# --- INICIO: NUEVO ENDPOINT UNIFICADO PARA EL DASHBOARD ---
@app.get("/analytics/unified-dashboard", response_model=UnifiedAnalyticsResponse, tags=["Analytics"])
async def get_unified_dashboard_data(current_user: dict = Depends(get_current_user)):
    """
    Obtiene el último resumen de analíticas guardado, que ahora incluye
    el desglose por secciones para cada curso.
    """
    try:
        # --- INICIO DE LA CORRECCIÓN ---
        # Se reemplaza la constante incorrecta por la cadena especial '__name__'
        query = db.collection('analyticsSummaries').order_by('__name__', direction=firestore.Query.DESCENDING).limit(1)
        # --- FIN DE LA CORRECCIÓN ---
        docs = await asyncio.to_thread(list, query.stream())
        
        if not docs:
            raise HTTPException(status_code=404, detail="Aún no se ha generado ningún resumen de analíticas.")
        
        analytics_summary_raw = docs[0].to_dict()
        analytics_summary = AnalyticsSummary(**analytics_summary_raw)

    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail=f"Error al cargar analíticas: {e.detail}")
    except Exception as e:
        logger.error(f"Error al obtener o validar el último resumen de analíticas: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al obtener los datos de analíticas.")

    daily_report_data = None
    today_str = datetime.now(chile_tz).strftime('%Y-%m-%d')
    try:
        daily_report_data_raw = await get_daily_report(today_str, current_user)
        daily_report_data = DailyReportData(**daily_report_data_raw)
    except HTTPException:
        pass

    return UnifiedAnalyticsResponse(
        analytics_summary=analytics_summary,
        daily_report=daily_report_data
    )

async def generate_snapshot_for_cutoff(cut_off_key: str, cut_off_date: str):
    """
    Llamada por el scheduler para generar un snapshot y enviar una notificación por email.
    """
    if not db:
        logger.error(f"[SnapshotJob:{cut_off_date}] Error: Cliente de Firestore no disponible.")
        return

    logger.info(f"--- [SnapshotJob:{cut_off_date}] INICIANDO tarea programada. ---")

    try:
        existing_snapshot_query = db.collection('attendanceSnapshots').where('cutOffDate', '==', cut_off_date).limit(1)
        existing_docs = await asyncio.to_thread(list, existing_snapshot_query.stream())

        if existing_docs:
            logger.info(f"--- [SnapshotJob:{cut_off_date}] El snapshot ya existe (ID: {existing_docs[0].id}). No se requiere acción. ---")
            return

        logger.info(f"--- [SnapshotJob:{cut_off_date}] No existe un snapshot para {cut_off_date}. Procediendo con la generación automática. ---")
        
        app_config_ref = db.collection('appConfig').document('reportDates')
        config_doc = await asyncio.to_thread(app_config_ref.get)
        config_data = config_doc.to_dict() if config_doc.exists else {}

        snapshot_name_prefix = ""
        if cut_off_key == "earlyWarningFirstCutOff": snapshot_name_prefix = "Primer Corte"
        elif cut_off_key == "earlyWarningSecondCutOff": snapshot_name_prefix = "Segundo Corte"
        elif cut_off_key == "earlyWarningThirdCutOff": snapshot_name_prefix = "Tercer Corte"
        
        date_of_cut = datetime.strptime(cut_off_date, "%Y-%m-%d")
        year = date_of_cut.year
        semester = "Semestre Indefinido"
        p1_start, p1_end = to_date(config_data.get("primerSemestreStart")), to_date(config_data.get("primerSemestreEnd"))
        p2_start, p2_end = to_date(config_data.get("segundoSemestreStart")), to_date(config_data.get("segundoSemestreEnd"))
        if p1_start and p1_end and p1_start <= date_of_cut.date() <= p1_end: semester = "Primer Semestre"
        if p2_start and p2_end and p2_start <= date_of_cut.date() <= p2_end: semester = "Segundo Semestre"
        snapshot_display_name = f"{snapshot_name_prefix} {semester} {year}"

        admin_user_dummy = {"uid": "system_scheduler", "roles": ["admin"]}
        request_payload = GenerateSnapshotRequest(cut_off_name=cut_off_key, snapshot_display_name=snapshot_display_name)
        
        snapshot_result = await generate_attendance_snapshot(request_payload, admin_user_dummy)
        
        logger.info(f"--- [SnapshotJob:{cut_off_date}] Snapshot '{snapshot_display_name}' generado exitosamente. ---")

        # --- NUEVO: Enviar notificación por email ---
        try:
            if config_data:
                recipients = config_data.get("emailReports", [])
                if recipients:
                    snapshot_summary = snapshot_result.get("details", {})
                    subject = f"Reporte de Alerta Temprana Generado: {snapshot_display_name}"
                    body_html = f"""
                    <h1>Se ha generado un nuevo Reporte de Alerta Temprana</h1>
                    <p>Este es un resumen del snapshot generado automáticamente.</p>
                    <ul>
                        <li><strong>Nombre del Reporte:</strong> {snapshot_display_name}</li>
                        <li><strong>Fecha de Corte:</strong> {cut_off_date}</li>
                        <li><strong>Secciones Procesadas:</strong> {snapshot_summary.get('sections_processed', 'N/A')}</li>
                        <li><strong>Total de Estudiantes Analizados:</strong> {snapshot_summary.get('total_students_processed', 'N/A')}</li>
                        <li><strong>Estudiantes en Riesgo Encontrados:</strong> {snapshot_summary.get('students_at_risk_found', 'N/A')}</li>
                    </ul>
                    <p>Para ver el detalle completo, por favor, visita el panel de administración en la sección de Alertas Tempranas.</p>
                    """
                    await send_summary_email(subject, body_html, recipients)
        except Exception as email_error:
            logger.error(f"[SnapshotJob:{cut_off_date}] Error al intentar enviar el email de resumen: {email_error}", exc_info=True)
        # --- FIN: Enviar notificación por email ---

    except Exception as e:
        logger.error(f"--- [SnapshotJob:{cut_off_date}] Error CRÍTICO durante la generación automática: {e} ---", exc_info=True)

# Helper function (si no la tienes ya)
def to_date(date_str: Optional[str]) -> Optional[date]:
    return datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else None

async def send_summary_email(subject: str, body_html: str, recipients: List[str]):
    """
    Envía un correo electrónico usando la API de SendGrid.
    Esta versión incluye la solución para el error de verificación SSL.
    """
    api_key = os.environ.get('SENDGRID_API_KEY')
    from_email = os.environ.get('SENDGRID_FROM_EMAIL')

    if not api_key:
        logger.error("[SendGrid] La variable de entorno SENDGRID_API_KEY no está configurada.")
        return
    if not from_email:
        logger.error("[SendGrid] La variable de entorno SENDGRID_FROM_EMAIL no está configurada.")
        return
    if not recipients:
        logger.warning("[SendGrid] No hay destinatarios, se omite el envío.")
        return

    message = Mail(
        from_email=from_email,
        to_emails=recipients,
        subject=subject,
        html_content=body_html
    )

    try:
        # 1. Se crea el cliente de SendGrid de la forma estándar.
        sg = SendGridAPIClient(api_key)

        # 2. Se accede al cliente HTTP interno (sg.client) y se deshabilita
        #    la verificación SSL. Esto soluciona el error.
        sg.client.ssl_verification = False

        logger.info(f"[SendGrid] Enviando email a {recipients} con asunto: {subject}")

        # La llamada a sg.send ahora usará la configuración modificada.
        response = await asyncio.to_thread(sg.send, message)

        logger.info(f"[SendGrid] Email enviado exitosamente. Status Code: {response.status_code}")

    except Exception as e:
        logger.error(f"[SendGrid] Falló el envío del email: {e}", exc_info=True)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("main:app", host='0.0.0.0', port=8000, reload=True, log_level="info")