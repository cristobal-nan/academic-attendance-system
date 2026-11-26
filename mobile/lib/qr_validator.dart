import 'dart:async';
import 'dart:convert';
import 'dart:io'; // Necesario para HttpException y Platform (si se usara)
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:intl/intl.dart'; // Para formateo de fecha
import 'main.dart'; // Para baseUrl

class ValidateTokenPage extends StatefulWidget {
  const ValidateTokenPage({super.key});
  @override
  State<ValidateTokenPage> createState() => _ValidateTokenPageState();
}

class _ValidateTokenPageState extends State<ValidateTokenPage> {
  List<Map<String, dynamic>> _activeMeetings = [];
  String? _selectedMeetingId;
  bool _isLoadingMeetings = true;
  String? _meetingSelectionError;

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final MobileScannerController _scannerController = MobileScannerController();

  bool _isProcessing = false;
  bool _isLoadingHttp = false;
  String? _errorMessage;
  String? _scannedTokenValue;

  bool _isCurrentMeetingMarkedAsActive = false;
  bool _isActivatingMeeting = false;
  Map<String, dynamic>? _selectedMeetingFullData;
  List<String> _currentUserRoles = [];

  @override
  void initState() {
    super.initState();
    _fetchCurrentUserRolesAndThenMeetings();
  }

  Future<void> _fetchCurrentUserRolesAndThenMeetings() async {
    if (!mounted) return;
    setState(() {
      _isLoadingMeetings = true;
      _meetingSelectionError = null;
    });
    final currentUser = _auth.currentUser;
    if (currentUser == null) {
      if (mounted) {
        setState(() {
          _isLoadingMeetings = false;
          _meetingSelectionError = "Error: Usuario no autenticado.";
        });
      }
      return;
    }
    try {
      DocumentSnapshot userDoc = await _firestore
          .collection('users')
          .doc(currentUser.uid)
          .get();

      if (userDoc.exists && userDoc.data() != null) {
        var rolesData = userDoc.get('roles');
        if (rolesData is List) {
          _currentUserRoles = rolesData.map((role) => role.toString()).toList();
        } else if (rolesData is String) {
           _currentUserRoles = [rolesData];
        } else {
          _currentUserRoles = [];
        }
      } else {
         _currentUserRoles = [];
      }
      debugPrint("✅ [DEBUG] Roles del usuario actual en qr_validator: $_currentUserRoles");
      await _fetchActiveMeetings();

    } catch (e) {
      debugPrint("🔴 [DEBUG] Error fetching user roles in qr_validator: $e");
      if (mounted) {
        setState(() {
          _isLoadingMeetings = false;
          _meetingSelectionError = "Error al obtener roles: ${e.toString()}";
        });
      }
    }
  }

  Future<void> _fetchActiveMeetings() async {
    if (mounted) {
      setState(() {
        _meetingSelectionError = null;
        _activeMeetings = [];
        _selectedMeetingId = null;
        _isCurrentMeetingMarkedAsActive = false;
        _selectedMeetingFullData = null;
      });
    }

    final currentUser = _auth.currentUser;
    if (currentUser == null) {
        if (mounted) {
            setState(() {
              _isLoadingMeetings = false;
              _meetingSelectionError = "Error: Sesión de usuario perdida.";
            });
        }
        return;
    }
    final userUid = currentUser.uid;
    final DateTime now = DateTime.now();
    final startOfDay = DateTime(now.year, now.month, now.day, 0, 0, 0);
    final endOfDay = DateTime(now.year, now.month, now.day, 23, 59, 59);
    final Timestamp startOfDayTimestamp = Timestamp.fromDate(startOfDay);
    final Timestamp endOfDayTimestamp = Timestamp.fromDate(endOfDay);

    List<Map<String, dynamic>> fetchedMeetingsDataFromDb = [];

    try {
      debugPrint("🟡 [DEBUG] Buscando reuniones para el usuario: $userUid basadas en 'responsibleUIDs'");

      Query meetingsQuery = _firestore
          .collection('classMeetings')
          .where('responsibleUIDs', arrayContains: userUid)
          .where('meetingDateTime', isGreaterThanOrEqualTo: startOfDayTimestamp)
          .where('meetingDateTime', isLessThanOrEqualTo: endOfDayTimestamp)
          .orderBy('meetingDateTime');
      
      QuerySnapshot querySnapshot = await meetingsQuery.get();

      for (var doc in querySnapshot.docs) {
        Map<String, dynamic> meetingDataWithId = doc.data() as Map<String, dynamic>;
        meetingDataWithId['id'] = doc.id;
        fetchedMeetingsDataFromDb.add(meetingDataWithId);
      }
      
      if (!mounted) return;

      final List<Map<String, dynamic>> processedMeetingsList = [];
      for (var meetingData in fetchedMeetingsDataFromDb) {
        if (_currentUserRoles.contains('ayudante') &&
            !_currentUserRoles.contains('admin') && 
            !_currentUserRoles.contains('profesor') && 
            (meetingData['meetingType'] as String? ?? '').toUpperCase() != 'AYUDANTÍA') {
          debugPrint("🟡 [DEBUG] Ayudante $userUid: Omitiendo reunión ${meetingData['id']} (tipo: ${meetingData['meetingType']}) porque no es 'Ayudantía'.");
          continue; 
        }

        final Timestamp? meetingStartTimestamp = meetingData['meetingDateTime'] as Timestamp?;
        final Timestamp? meetingEndTimestamp = meetingData['endTime'] as Timestamp?;

        if (meetingStartTimestamp != null && meetingEndTimestamp != null) {
          String courseName = 'Curso desc.';
          String sectionIdentifier = 'Sección desc.';
          String? fetchedCourseID = meetingData['courseID'] as String?;
          String? fetchedSectionID = meetingData['sectionID'] as String?;

          if (fetchedCourseID != null && fetchedCourseID.isNotEmpty) {
            try {
              final courseDocSnapshot = await _firestore.collection('courses').doc(fetchedCourseID).get();
              if (courseDocSnapshot.exists) {
                courseName = courseDocSnapshot.data()?['courseName'] as String? ?? courseName;
              }
            } catch (e) { debugPrint("🔴 [DEBUG] Error buscando curso $fetchedCourseID: $e"); }
          }
          if (fetchedSectionID != null && fetchedSectionID.isNotEmpty) {
            try {
              final sectionDocSnapshot = await _firestore.collection('sections').doc(fetchedSectionID).get();
              if (sectionDocSnapshot.exists) {
                sectionIdentifier = sectionDocSnapshot.data()?['sectionIdentifier'] as String? ?? sectionIdentifier;
              }
            } catch (e) { debugPrint("🔴 [DEBUG] Error buscando sección $fetchedSectionID: $e"); }
          }
          
          processedMeetingsList.add({
            'id': meetingData['id'],
            'courseName': courseName,
            'sectionIdentifier': sectionIdentifier,
            'meetingStartDateTime': meetingStartTimestamp.toDate(),
            'meetingEndDateTime': meetingEndTimestamp.toDate(),
            'isActiveForAttendance': meetingData['isActiveForAttendance'] as bool? ?? false,
            'meetingType': meetingData['meetingType'] as String? ?? 'N/A',
          });
        }
      }
      
      final List<Map<String, dynamic>> timeVigenteMeetings = processedMeetingsList.where((meeting) {
        final DateTime meetingStart = meeting['meetingStartDateTime'] as DateTime;
        final DateTime meetingEnd = meeting['meetingEndDateTime'] as DateTime;
        final DateTime nowLocal = DateTime.now(); 
        bool isStartedOrNow = nowLocal.isAfter(meetingStart) || nowLocal.isAtSameMomentAs(meetingStart);
        bool isBeforeEnd = nowLocal.isBefore(meetingEnd);
        return isStartedOrNow && isBeforeEnd;
      }).toList();

      if (mounted) {
        // --- INICIO DEBUG PRINT ---
        debugPrint("✅ [DEBUG] Se encontraron ${timeVigenteMeetings.length} reuniones vigentes para el usuario.");
        for (var meeting in timeVigenteMeetings) {
          debugPrint("  -> ID: ${meeting['id']}, Curso: ${meeting['courseName']}, Activa: ${meeting['isActiveForAttendance']}");
        }
        // --- FIN DEBUG PRINT ---

        setState(() {
          _activeMeetings = timeVigenteMeetings.map((meeting) {
            return {
              'id': meeting['id'],
              'courseName': meeting['courseName'],
              'sectionIdentifier': meeting['sectionIdentifier'],
              'meetingTime': meeting['meetingStartDateTime'],
              'isActiveForAttendance': meeting['isActiveForAttendance'],
              'meetingType': meeting['meetingType'],
            };
          }).toList();
          _isLoadingMeetings = false;
        });
      }

    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoadingMeetings = false;
        _meetingSelectionError = "Error al cargar reuniones: ${e.toString()}";
      });
      debugPrint("🔴 [DEBUG] Error buscando reuniones: $e");
    }
  }

  Future<void> _activateSelectedMeeting() async {
    if (_selectedMeetingId == null) {
      if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Error: No hay reunión seleccionada.')),
      );
      }
      return;
    }

    if(mounted) {
      setState(() { _isActivatingMeeting = true; _errorMessage = null; });
    }

    try {
      final currentUser = _auth.currentUser;
      if (currentUser == null) throw Exception("Usuario no autenticado.");
      final idToken = await currentUser.getIdToken();

      // --- INICIO DEBUG PRINT ---
      final url = Uri.parse('$baseUrl/meetings/$_selectedMeetingId/activate');
      debugPrint("🟡 [DEBUG] Intentando activar reunión...");
      debugPrint("  -> Endpoint URL: $url");
      debugPrint("  -> Meeting ID seleccionado: $_selectedMeetingId");
      // --- CORRECCIÓN DE NULABILIDAD ---
      if (idToken != null && idToken.length > 15) {
        debugPrint("  -> Auth Token (primeros 15 chars): ${idToken.substring(0, 15)}...");
      } else {
        debugPrint("  -> Auth Token: $idToken");
      }
      // --- FIN DEBUG PRINT ---

      final response = await http.post(
        url,
        headers: {
          'Authorization': 'Bearer $idToken',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 20));

      // --- INICIO DEBUG PRINT ---
      debugPrint("🔵 [DEBUG] Respuesta recibida del servidor:");
      debugPrint("  -> Status Code: ${response.statusCode}");
      debugPrint("  -> Response Body: ${response.body}");
      // --- FIN DEBUG PRINT ---

      if (!mounted) return;

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        debugPrint("✅ [DEBUG] ¡Activación exitosa según Status Code 200!");
        setState(() {
          _isCurrentMeetingMarkedAsActive = true;
          final index = _activeMeetings.indexWhere((m) => m['id'] == _selectedMeetingId);
          if (index != -1) _activeMeetings[index]['isActiveForAttendance'] = true;
        });
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(data['message']), backgroundColor: Colors.green),
        );
      } else {
        debugPrint("🔴 [DEBUG] La activación falló (Status Code no es 200).");
        final errorData = jsonDecode(response.body);
        // Usamos 'detail' que es lo que FastAPI suele enviar.
        throw Exception(errorData['detail'] ?? 'Error del servidor. Status: ${response.statusCode}');
      }
    } catch (e) {
      if (!mounted) return;
      // --- INICIO DEBUG PRINT ---
      debugPrint("🔴 [DEBUG] Se capturó una excepción en el bloque try/catch de activateMeeting.");
      debugPrint("  -> Tipo de error: ${e.runtimeType}");
      debugPrint("  -> Mensaje de error: ${e.toString()}");
      // --- FIN DEBUG PRINT ---
      setState(() {
        _errorMessage = "Error al activar la clase: ${e.toString()}";
      });
    } finally {
        if(mounted) setState(() => _isActivatingMeeting = false);
    }
}
    @override
  void dispose() {
    debugPrint('Disposing ValidateTokenPage...');
    _scannerController.dispose();
    super.dispose();
  }

  void _handleDetection(BarcodeCapture capture) {
    if (_selectedMeetingId == null) {
      debugPrint("Intento de escanear sin reunión seleccionada.");
      return;
    }
    if (_isProcessing || _isLoadingHttp) {
      return;
    }
    
    final List<Barcode> barcodes = capture.barcodes;
    if (barcodes.isNotEmpty) {
      final String? scannedValue = barcodes.first.rawValue;
      if (scannedValue != null && scannedValue.isNotEmpty) {
        debugPrint('Código QR detectado: $scannedValue para MeetingID: $_selectedMeetingId');

        if (mounted) {
          try {
            _scannerController.stop(); 
            debugPrint("Scanner detenido para validación.");
          } catch(e) {
            debugPrint("Error al intentar detener scanner en _handleDetection: $e");
          }
          setState(() {
            _isProcessing = true; 
            _scannedTokenValue = scannedValue;
          });
          _validateToken(scannedValue, _selectedMeetingId!);
        }
      } else {
        debugPrint('Código QR detectado pero el valor es nulo o vacío.');
      }
    }
  }
  
  Future<void> _validateToken(String tokenToValidate, String meetingId) async {
    if (!mounted) return;
    setState(() {
      _isLoadingHttp = true;
      _errorMessage = null; 
    });

    bool validationSuccess = false;
    String? connectionErrorMsg;
    String serverResponseMessage = 'Error desconocido durante la validación.';

    try {
      final currentUser = FirebaseAuth.instance.currentUser;
      if (currentUser == null) {
        throw Exception("No hay un usuario validador autenticado.");
      }
      final idToken = await currentUser.getIdToken();

      final url = Uri.parse('$baseUrl/validate/$tokenToValidate?meetingId=$meetingId');
      debugPrint('Validando token escaneado en: $url con Auth Header');

      final response = await http.get(
        url,
        headers: {
          'Authorization': 'Bearer $idToken',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 15));

      final responseBody = utf8.decode(response.bodyBytes);

      if (response.statusCode == 200) {
        final data = jsonDecode(responseBody);
        final String serverStatus = data['status']?.toString().toLowerCase() ?? "";
        
        if (serverStatus == 'asistencia_registrada_por_qr' || serverStatus == 'ya_registrado') {
          validationSuccess = true;
          final studentName = data['attendeeName'] as String? ?? 'un estudiante';
          // --- CORRECCIÓN AQUÍ ---
          // Ahora usamos el mensaje que ya viene del backend para el caso de "ya registrado"
          if (serverStatus == 'ya_registrado') {
            serverResponseMessage = data['message'] as String? ?? 'Asistencia ya registrada.';
          } else {
            serverResponseMessage = 'Asistencia registrada para:\n$studentName';
          }
        } else {
          serverResponseMessage = data['message'] as String? ?? 'Respuesta del servidor no contiene mensaje.';
          connectionErrorMsg = serverResponseMessage;
        }
      } else {
        debugPrint('Validación falló con estado HTTP: ${response.statusCode}');
        try {
          final errorData = jsonDecode(response.body);
          if (response.statusCode == 401) {
             connectionErrorMsg = "Sesión del validador inválida o expirada. Por favor, reinicia sesión.";
          } else {
             connectionErrorMsg = errorData['detail'] as String? ?? 'Error del servidor (${response.statusCode}).';
          }
        } catch (_) {
          connectionErrorMsg = 'Error del servidor (${response.statusCode}). Reintentar.';
        }
        serverResponseMessage = connectionErrorMsg;
      }
    } on TimeoutException catch (_) {
      connectionErrorMsg = 'Timeout: No se pudo conectar al servidor.';
      serverResponseMessage = connectionErrorMsg;
    } on SocketException catch (_) {
      connectionErrorMsg = 'Error de red. Verifica la conexión y la URL.';
      serverResponseMessage = connectionErrorMsg;
    } on HttpException catch (e) { 
        connectionErrorMsg = 'Error HTTP: ${e.message}';
        serverResponseMessage = connectionErrorMsg;
    } catch (e) {
      connectionErrorMsg = 'Ocurrió un error inesperado: ${e.toString()}';
      serverResponseMessage = connectionErrorMsg;
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingHttp = false;
          _errorMessage = validationSuccess ? null : (connectionErrorMsg ?? serverResponseMessage);
        });
        _showValidationResultDialog(validationSuccess, serverResponseMessage);
      }
    }
  }

    Future<void> _showValidationResultDialog(bool isValid, String dialogMessage) async {
    if (!mounted) return;

    // Se utiliza un Completer para asegurar que la lógica post-cierre se ejecute después de que el diálogo se haya ido.
    final completer = Completer();

    showDialog<void>(
      context: context,
      barrierDismissible: false, // El usuario no puede cerrar el diálogo manualmente
      builder: (BuildContext context) {
        return StatefulBuilder(
          builder: (context, setState) {
            // Inicia un temporizador cuando el diálogo se construye
            Timer(const Duration(seconds: 1), () {
              if (mounted) {
                Navigator.of(context).pop(); // Cierra el diálogo
                completer.complete();      // Resuelve la promesa para ejecutar el código de abajo
              }
            });

            return AlertDialog(
              title: Row(
                children: [
                  Icon(
                    isValid ? Icons.check_circle_outline : Icons.error_outline,
                    color: isValid ? Colors.green : Colors.red,
                    size: 28,
                  ),
                  const SizedBox(width: 10),
                  Text(isValid ? 'Validación Exitosa' : 'Validación Fallida'),
                ],
              ),
              content: SingleChildScrollView(
                child: ListBody(
                  children: <Widget>[
                    Text(dialogMessage),
                    const SizedBox(height: 20),
                    // Animación del círculo de progreso que se completa en 1 segundo
                    TweenAnimationBuilder<double>(
                      tween: Tween<double>(begin: 0.0, end: 1.0),
                      duration: const Duration(seconds: 1),
                      builder: (context, value, child) {
                        return LinearProgressIndicator(
                          value: value,
                          backgroundColor: Colors.grey[300],
                          valueColor: AlwaysStoppedAnimation<Color>(
                            isValid ? Colors.green : Colors.red,
                          ),
                        );
                      },
                    ),
                  ],
                ),
              ),
              // Se elimina la sección de 'actions' (el botón de OK)
            );
          },
        );
      },
    );

    // Espera a que el diálogo se cierre para ejecutar la lógica de reinicio del scanner
    await completer.future;

    if (mounted) {
      setState(() {
        _isProcessing = false;
        _scannedTokenValue = null;
      });
      if (_selectedMeetingId != null && _isCurrentMeetingMarkedAsActive) {
        try {
          _scannerController.start();
          debugPrint('Scanner reiniciado automáticamente después del diálogo.');
        } catch (e) {
          debugPrint('Error al intentar reiniciar el scanner tras diálogo: $e');
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Escanear Asistencia'),
        backgroundColor: Colors.red,
        actions: [
          IconButton(
            icon: ValueListenableBuilder<MobileScannerState?>(
              valueListenable: _scannerController,
              builder: (context, state, child) {
                final currentTorchState = state?.torchState ?? TorchState.unavailable;
                switch (currentTorchState) {
                  case TorchState.off: return const Icon(Icons.flash_off, color: Colors.white70);
                  case TorchState.on: return const Icon(Icons.flash_on, color: Colors.amber);
                  default: return const Icon(Icons.no_flash, color: Colors.white24);
                }
              },
            ),
            tooltip: 'Linterna',
            onPressed: () => _scannerController.toggleTorch(),
          ),
        ],
      ),
      body: _buildScannerBody(),
    );
  }

  Widget _buildScannerBody() {
    if (_isLoadingMeetings) {
      return const Center(child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [CircularProgressIndicator(), SizedBox(height:10), Text("Cargando reuniones...")],
        ));
    }

    if (_meetingSelectionError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, color: Colors.red.shade300, size: 48),
              const SizedBox(height: 10),
              Text('Error al cargar reuniones:', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 5),
              Text(_meetingSelectionError!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
              const SizedBox(height: 20),
              ElevatedButton.icon(
                icon: const Icon(Icons.refresh),
                label: const Text("Reintentar"),
                onPressed: _fetchCurrentUserRolesAndThenMeetings,
              ),
            ],
          ),
        ),
      );
    }

    if (_activeMeetings.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.info_outline, color: Colors.blue.shade300, size: 48),
              const SizedBox(height: 10),
              const Text('No hay clases disponibles para gestionar asistencia en este momento.', textAlign: TextAlign.center),
              const SizedBox(height: 20),
              ElevatedButton.icon(
                icon: const Icon(Icons.refresh),
                label: const Text("Refrescar Lista"),
                onPressed: _fetchCurrentUserRolesAndThenMeetings,
              ),
            ],
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(8.0, 16.0, 8.0, 8.0),
      child: Column(
        children: [
          DropdownButtonFormField<String>(
            value: _selectedMeetingId,
            decoration: InputDecoration(
              labelText: "Selecciona la Clase/Reunión",
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8.0)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 8.0),
            ),
            hint: const Text("Elige una clase para continuar"),
            isExpanded: true,
            items: _activeMeetings.map((meeting) {
                  final meetingTime = meeting['meetingTime'] as DateTime;
                  final dateFormat = DateFormat('HH:mm', 'es_CL'); 
                  final dateStr = DateFormat('dd/MM', 'es_CL').format(meetingTime);
                  final meetingTimeStr = dateFormat.format(meetingTime);
                  final isActiveText = (meeting['isActiveForAttendance'] as bool? ?? false) ? "(Activada)" : "";
                  final meetingTypeStr = meeting['meetingType'] as String? ?? 'N/A';
                  
                  String courseNameDisplay = meeting['courseName'] as String;
                  String sectionIdentifierDisplay = meeting['sectionIdentifier'] as String;

                  if (courseNameDisplay.length > 20) courseNameDisplay = "${courseNameDisplay.substring(0,17)}...";
                  if (sectionIdentifierDisplay.length > 15) sectionIdentifierDisplay = "${sectionIdentifierDisplay.substring(0,12)}...";

                  final displayText = "$courseNameDisplay - $sectionIdentifierDisplay ($meetingTypeStr) [$dateStr $meetingTimeStr] $isActiveText";

                  return DropdownMenuItem<String>(
                    value: meeting['id'] as String,
                    child: Text(displayText, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14)),
                  );
                }).toList(),
            onChanged: (String? newValue) {
              if(mounted){
                setState(() {
                  _selectedMeetingId = newValue;
                  _isProcessing = false; 
                  _errorMessage = null;   

                  if (newValue == null) {
                    _isCurrentMeetingMarkedAsActive = false;
                    _selectedMeetingFullData = null;
                    try {
                      if (mounted) _scannerController.stop(); 
                    } catch (e) {
                      debugPrint("Error deteniendo scanner al deseleccionar: $e");
                    }
                  } else {
                    _selectedMeetingFullData = _activeMeetings.firstWhere(
                      (m) => m['id'] == newValue,
                    ); 

                    if (_selectedMeetingFullData != null) {
                      _isCurrentMeetingMarkedAsActive = _selectedMeetingFullData!['isActiveForAttendance'] as bool? ?? false;
                    } else {
                      _isCurrentMeetingMarkedAsActive = false; 
                    }
                    
                    if (_isCurrentMeetingMarkedAsActive) {
                      try {
                        _scannerController.start(); 
                        debugPrint("Solicitud de inicio de scanner para reunión activa seleccionada.");
                      } catch (e) {
                        debugPrint("Error al intentar iniciar scanner en onChanged del dropdown: $e");
                      }
                    } else {
                      try {
                        _scannerController.stop();
                        debugPrint("Scanner detenido (onChanged), reunión seleccionada no activa.");
                      } catch (e) {
                        debugPrint("Error al intentar detener scanner en onChanged del dropdown: $e");
                      }
                    }
                  }
                });
              }
            },
          ),
          const SizedBox(height: 12),

          Expanded(
            child: _selectedMeetingId == null
              ? const Center(child: Padding(
                  padding: EdgeInsets.all(16.0),
                  child: Text("Por favor, selecciona una clase de la lista para continuar.", textAlign: TextAlign.center, style: TextStyle(fontSize: 16)),
                ))
              : _isCurrentMeetingMarkedAsActive
                  ? _buildQrScannerView() 
                  : _buildActivateMeetingView(), 
          ),
        ],
      ),
    );
  }

  Widget _buildQrScannerView() {
    return Stack(
      alignment: Alignment.center,
      children: [
        MobileScanner(
          controller: _scannerController,
          onDetect: _handleDetection,
          errorBuilder: (context, error, child) {
            debugPrint('Error del MobileScanner: $error');
            String errorMessageToShow = 'Error con la cámara.';
            if (error.errorCode == MobileScannerErrorCode.permissionDenied) {
              errorMessageToShow = 'Permiso de cámara denegado. Habilítalo en la configuración de la app.';
            } else if (error.errorCode == MobileScannerErrorCode.unsupported) {
              errorMessageToShow = 'La funcionalidad de scanner no es soportada en este dispositivo.';
            }
            return Container(
              padding: const EdgeInsets.all(16),
              color: Colors.black87,
              child: Center(
                  child: Text(
                errorMessageToShow,
                style: const TextStyle(color: Colors.white, fontSize: 16),
                textAlign: TextAlign.center,
              )),
            );
          },
        ),
        Container(
          width: MediaQuery.of(context).size.width * 0.7,
          height: MediaQuery.of(context).size.width * 0.7,
          decoration: BoxDecoration(
            border: Border.all(
              color: (_isLoadingHttp || _isProcessing)
                  ? Colors.orange.withOpacity(0.8)
                  : Colors.green.withOpacity(0.8),
              width: 3,
            ),
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        if (_isLoadingHttp)
          Container(
            color: Colors.black.withOpacity(0.5),
            child: const Center(
                child: CircularProgressIndicator(
              valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
            )),
          ),
      ],
    );
  }

  Widget _buildActivateMeetingView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.power_settings_new, color: Colors.blue.shade300, size: 52),
            const SizedBox(height: 16),
            const Text(
              "Esta clase no está activa para tomar asistencia.",
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 24),
            _isActivatingMeeting
                ? const CircularProgressIndicator()
                : ElevatedButton.icon(
                    icon: const Icon(Icons.play_circle_fill_outlined),
                    label: const Text("Activar Asistencia Ahora"),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green.shade600,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                      textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.0)
                      )
                    ),
                    onPressed: _activateSelectedMeeting,
                  ),
            if (_errorMessage != null && !_isActivatingMeeting && !_isLoadingHttp) ...[
              const SizedBox(height: 15),
              Text(
                _errorMessage!,
                style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
