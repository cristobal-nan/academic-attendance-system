export const validateAndCleanRut = (
    rutCompleto: string
): { isValid: boolean; cleanedRut?: string; error?: string } => {
    if (!rutCompleto || typeof rutCompleto !== 'string') {
        return { isValid: false, error: 'RUT no puede estar vacío.' };
    }

    // Limpiar el RUT de puntos y guion, y convertir DV a mayúscula
    const rutPreparado = rutCompleto.replace(/[\.\-]/g, '').toUpperCase();

    if (!/^[0-9]+[0-9K]$/.test(rutPreparado)) {
        if (rutPreparado.length === 1 && /^[0-9K]$/.test(rutPreparado)) {
             // Permitir que se siga escribiendo si solo hay un caracter (el posible DV)
        } else if (rutPreparado.length > 1 && !/^[0-9]+$/.test(rutPreparado.slice(0,-1))) {
            return { isValid: false, error: 'Formato de RUT inválido (solo números antes del DV).' };
        } else if (rutPreparado.length > 0 && !/^[0-9K]$/.test(rutPreparado.slice(-1))) {
             return { isValid: false, error: 'Dígito verificador debe ser número o K.' };
        }
        // No retornar error inmediatamente si solo se está empezando a escribir
    }


    if (rutPreparado.length < 2) { // Un RUT válido tiene al menos 2 caracteres (ej. 1-9)
        // No consideramos esto un error si el usuario aún está escribiendo.
        // La validación final se hará al enviar.
        return { isValid: false, error: 'RUT demasiado corto para validar.'}; // Error suave
    }

    const cuerpo = rutPreparado.slice(0, -1);
    const dvIngresado = rutPreparado.slice(-1);

    if (!/^\d+$/.test(cuerpo)) {
      // Si el cuerpo no es puramente numérico (ya cubierto arriba, pero como doble check)
      return { isValid: false, error: 'Cuerpo del RUT debe ser numérico.' };
    }


    let suma = 0;
    let multiplo = 2;

    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += parseInt(cuerpo.charAt(i), 10) * multiplo;
        multiplo = multiplo === 7 ? 2 : multiplo + 1;
    }

    const dvCalculadoRaw = 11 - (suma % 11);
    let dvCalculado: string;

    if (dvCalculadoRaw === 11) {
        dvCalculado = '0';
    } else if (dvCalculadoRaw === 10) {
        dvCalculado = 'K';
    } else {
        dvCalculado = dvCalculadoRaw.toString();
    }

    if (dvCalculado === dvIngresado) {
        return { isValid: true, cleanedRut: rutPreparado }; // rutPreparado ya está limpio y con DV en mayúscula
    } else {
        return { isValid: false, error: 'Dígito verificador incorrecto.' };
    }
};