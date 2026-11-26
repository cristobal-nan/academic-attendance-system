# lms_canvas_client.py

import os
import httpx
from dotenv import load_dotenv

# Carga las variables de entorno del archivo .env
load_dotenv()

CANVAS_API_URL = os.getenv("CANVAS_API_URL")
CANVAS_ACCESS_TOKEN = os.getenv("CANVAS_ACCESS_TOKEN")

async def call_canvas_api(endpoint: str, method: str = "GET", params: dict = None, data: dict = None) -> list | dict:
    """
    Función genérica y reutilizable para hacer llamadas a la API REST de Canvas.
    """
    if not CANVAS_API_URL or not CANVAS_ACCESS_TOKEN:
        raise ValueError("La URL y el Token de Acceso de Canvas no están configurados en .env")

    # Preparamos las cabeceras con el token de autorización
    headers = {
        "Authorization": f"Bearer {CANVAS_ACCESS_TOKEN}"
    }
    
    # Construimos la URL completa para la llamada
    url = f"{CANVAS_API_URL}/api/v1{endpoint}"

    # Usamos httpx para hacer la llamada asíncrona
    async with httpx.AsyncClient() as client:
        # Hacemos la petición según el método HTTP especificado
        if method.upper() == "GET":
            response = await client.get(url, headers=headers, params=params)
        elif method.upper() == "POST":
            response = await client.post(url, headers=headers, json=data)
        elif method.upper() == "PUT":
            response = await client.put(url, headers=headers, json=data)
        else:
            raise ValueError(f"Método HTTP no soportado: {method}")

        # Si la respuesta de Canvas es un error (ej. 404, 500), lanzará una excepción
        response.raise_for_status()
        
        # Devolvemos la respuesta en formato JSON
        return response.json()