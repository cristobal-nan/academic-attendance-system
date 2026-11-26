import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http; // Importa el paquete http
import 'package:qr_flutter/qr_flutter.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/io.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'main.dart';

// --- Pantalla QrTab (Sin cambios respecto a la versión anterior) ---
class QrTab extends StatefulWidget {
  // CAMBIO: userId ahora es String
  final String userId;
  const QrTab({super.key, required this.userId});

  @override
  State<QrTab> createState() => _QrCodePageState();
}

class _QrCodePageState extends State<QrTab> {
  Timer? _refreshTimer;
  Timer? _countdownTimer;
  bool _isLoading = true;
  String? _errorMessage;
  String _qrDataToken = '';
  int _remainingSeconds = 0;
  WebSocketChannel? _channel;
  StreamSubscription? _webSocketSubscription;

  @override
  void initState() {
    super.initState();
    _fetchTokenAndStartTimers();
    _connectWebSocket();
  }

  Future<void> _fetchTokenAndStartTimers() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _qrDataToken = '';
      _remainingSeconds = 0;
    });
    _cancelTimers();

    String? idToken;
    try {
      User? currentUser = FirebaseAuth.instance.currentUser;
      if (currentUser == null) {
        // Si no hay usuario, no podemos continuar. Cierra sesión por si acaso.
        _handleError(
          "Usuario no autenticado. Por favor, inicia sesión de nuevo.",
        );
        // Llama a signOut para asegurar que el estado se limpie
        await FirebaseAuth.instance.signOut();
        // Podrías también navegar a la pantalla de login aquí
        return;
      }
      // Obtiene el token actual. No forzamos refresco aquí (getIdToken(false))
      // a menos que sospeches que puede estar expirado.
      // Si quieres forzar validación contra backend aquí, usa getIdToken(true).
      idToken = await currentUser.getIdToken(false);
      if (idToken == null) {
        throw Exception("No se pudo obtener el token de ID de Firebase.");
      }
      debugPrint("Firebase ID Token obtenido para la solicitud.");
    } on FirebaseAuthException catch (e) {
      _handleError("Error de autenticación al obtener token: ${e.message}");
      // Podrías forzar cierre de sesión aquí también si el error es grave
      // await FirebaseAuth.instance.signOut();
      return;
    } catch (e) {
      _handleError("Error inesperado al obtener token de Firebase: $e");
      return;
    }
    // --------------------------------------

    try {
      // CAMBIO: La URL ya NO incluye el user_id
      final url = Uri.parse('$baseUrl/token');
      debugPrint('Fetching token QR from: $url (con Auth Header)');

      // CAMBIO: Añade el header 'Authorization'
      final response = await http
          .get(
            url,
            headers: {
              'Authorization': 'Bearer $idToken', // Envía el token de Firebase
              'Content-Type': 'application/json', // Buena práctica añadirlo
            },
          )
          .timeout(const Duration(seconds: 15));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data case {
          'token': String token, // Este es el token QR
          'expires_in_seconds': int expiresIn,
          'user_id': String userIdResponse, // El backend devuelve el UID
        }) {
          // Verificación opcional extra: ¿el UID devuelto coincide con el nuestro?
          if (userIdResponse == widget.userId) {
            debugPrint('Token QR received: $token, Expires in: $expiresIn');
            setState(() {
              _qrDataToken = token;
              _remainingSeconds = expiresIn;
              _isLoading = false;
            });
            _startRefreshTimer(expiresIn);
            _startCountdownTimer();
          } else {
            // Esto indicaría un problema serio en el backend o la lógica
            throw FormatException(
              'El user_id devuelto por el backend no coincide con el esperado.',
            );
          }
        } else {
          throw const FormatException(
            'Respuesta inesperada del servidor (formato JSON).',
          );
        }
      } else if (response.statusCode == 401) {
        // ¡IMPORTANTE! Manejar el caso específico de no autorizado
        debugPrint(
          "Error 401: No autorizado. El token de Firebase puede ser inválido o el usuario eliminado.",
        );
        _handleError(
          "Tu sesión ha expirado o es inválida. Por favor, inicia sesión de nuevo.",
        );
        // Forzar cierre de sesión local
        await FirebaseAuth.instance.signOut();
        // Opcional: Navegar a la pantalla de login
        // Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => LoginPage()), (route) => false);
        return; // Detiene la ejecución aquí
      } else {
        String serverMessage = response.reasonPhrase ?? 'Error desconocido';
        try {
          final errorData = jsonDecode(response.body);
          if (errorData is Map<String, dynamic> &&
              errorData.containsKey('message')) {
            serverMessage = errorData['message'];
          } else if (errorData is Map<String, dynamic> &&
              errorData.containsKey('detail')) {
            serverMessage =
                errorData['detail'] is List
                    ? (errorData['detail'] as List).first['msg']
                    : errorData['detail'];
          }
        } catch (_) {}
        throw HttpException(
          'Error del servidor (${response.statusCode}): $serverMessage',
        );
      }
    } on TimeoutException catch (_) {
      _handleError('Timeout: No se pudo conectar al servidor ($baseUrl).');
    } on SocketException catch (_) {
      _handleError(
        'Error de red: Verifica tu conexión y la dirección del servidor ($baseUrl).',
      );
    } on HttpException catch (e) {
      _handleError(e.message);
    } on FormatException catch (e) {
      _handleError('Error de formato: ${e.message}');
    } catch (e) {
      _handleError('Ocurrió un error inesperado: $e');
    }
  }

  void _handleError(String message) {
    debugPrint('Error fetching token: $message');
    if (!mounted) return;
    setState(() {
      _errorMessage = message;
      _isLoading = false;
      _qrDataToken = '';
      _remainingSeconds = 0;
    });
    _cancelTimers();
    // Considera si quieres desconectar o intentar reconectar el WS en caso de error
    // _disconnectWebSocket();
  }

  void _startRefreshTimer(int intervalSeconds) {
    _refreshTimer?.cancel();
    final duration = Duration(
      seconds: intervalSeconds > 0 ? intervalSeconds : 1,
    );
    _refreshTimer = Timer(duration, () {
      if (mounted) {
        debugPrint('Refresh timer fired. Fetching new token...');
        _fetchTokenAndStartTimers(); // Esto refrescará el token y reiniciará timers
      }
    });
    debugPrint('Refresh timer started for $intervalSeconds seconds.');
  }

  void _startCountdownTimer() {
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (Timer t) {
      if (mounted) {
        _updateCountdown();
      } else {
        t.cancel();
      }
    });
    debugPrint('Countdown timer started.');
  }

  void _updateCountdown() {
    if (_remainingSeconds > 0) {
      setState(() {
        _remainingSeconds--;
      });
    }
  }

  void _cancelTimers() {
    _refreshTimer?.cancel();
    _countdownTimer?.cancel();
    debugPrint('Timers cancelled.');
  }

  // --- NUEVAS Funciones WebSocket ---

  void _connectWebSocket() {
    // Asegúrate de cerrar cualquier conexión anterior antes de crear una nueva
    _disconnectWebSocket();

    final api = Uri.parse(baseUrl);
    final wsUrl = api.replace(
      scheme: api.scheme == 'https' ? 'wss' : 'ws',
      pathSegments: [...api.pathSegments.where((p) => p.isNotEmpty), 'ws', widget.userId],
    );

    try {
      _channel = IOWebSocketChannel.connect(wsUrl);

      _webSocketSubscription = _channel!.stream.listen(
        (message) {
          debugPrint('WebSocket message received: $message');
          if (message == "VALIDATED_NEWLY" || message == "VALIDATED_ALREADY") {
            _showValidationNotificationDialog(); // Mostrar el mismo pop-up para ambos casos de éxito
          }
        },
        onDone: () {
          debugPrint('WebSocket connection closed by server (onDone).');
          if (mounted) {
            // Considera lógica de reconexión si la conexión se cierra inesperadamente
            // y quieres que se mantenga activa. Por ejemplo, después de un delay:
            // Future.delayed(const Duration(seconds: 5), () {
            //   if (mounted && (_channel == null || _channel?.closeCode != null)) {
            //     debugPrint("Attempting to reconnect WebSocket...");
            //     _connectWebSocket();
            //   }
            // });
          }
        },
        onError: (error) {
          debugPrint('WebSocket error: $error');
          if (mounted) {
            // Aquí podrías querer mostrar un feedback visual discreto al usuario
            // de que hay problemas con la conexión de notificaciones en tiempo real.
            // Por ejemplo, un pequeño icono en la AppBar o un Toast/Snackbar temporal.
            // setState(() {
            //   _errorMessage = (_errorMessage ?? '') + "\nError en notificaciones: $error";
            // });
          }
          // No necesariamente desconectes aquí (`_disconnectWebSocket()`) si quieres
          // que intente reconectar en `onDone` o con un reintento manual.
          // Pero si el error es tal que la conexión no puede continuar, entonces sí.
        },
        cancelOnError: false, // Cambiar a false si quieres que la escucha continúe
                            // intentando procesar mensajes incluso después de un error,
                            // y manejar la reconexión en onDone o onError.
                            // Si es true, cualquier error detendrá la suscripción.
      );
      debugPrint('WebSocket connection initiated.');
    } catch (e) {
      debugPrint('Error establishing WebSocket connection: $e');
      // Actualizar UI para indicar fallo en conexión WS
      if (mounted) {
        setState(() {
          _errorMessage =
              "${_errorMessage ?? ''}\nError conectando a notificaciones.";
        });
      }
    }
  }

  void _disconnectWebSocket() {
    // Cancela la suscripción para dejar de escuchar
    _webSocketSubscription?.cancel();
    _webSocketSubscription = null; // Limpia la referencia

    // Cierra el Sink del canal WebSocket
    if (_channel != null) {
      _channel!.sink.close();
      _channel = null; // Limpia la referencia
      debugPrint('WebSocket connection closed.');
    }
  }

  // --- NUEVO Diálogo de Notificación ---
  Future<void> _showValidationNotificationDialog() async {
    // Asegúrate de que el widget esté montado antes de mostrar el diálogo
    if (!mounted) return;

    return showDialog<void>(
      context: context,
      barrierDismissible: true, // Permitir cerrar tocando fuera
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Row(
            children: [
              Icon(Icons.check_circle_outline, color: Colors.green),
              SizedBox(width: 10),
              Text('¡Validado!'),
            ],
          ),
          content: const SingleChildScrollView(
            child: ListBody(
              children: <Widget>[
                Text(
                  'Tu token QR ha sido validado exitosamente por un tercero.',
                ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              child: const Text('OK'),
              onPressed: () {
                Navigator.of(context).pop();
              },
            ),
          ],
        );
      },
    );
  }

  // --- Modifica dispose para cerrar el WebSocket ---
  @override
  void dispose() {
    _cancelTimers();
    _disconnectWebSocket(); // ¡Asegúrate de desconectar!
    super.dispose();
  }

  // --- Build y _buildBody (sin cambios significativos en la UI) ---
  @override
  Widget build(BuildContext context) {
    // ... (igual que antes)
    return Scaffold(
      appBar: AppBar(
        title: const Text('Token QR Dinámico'),
        backgroundColor: Colors.red,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: _buildBody(),
        ),
      ),
    );
  }

  Widget _buildBody() {
    // ... (igual que antes: _isLoading, _errorMessage, y la vista principal)
    if (_isLoading) {
      // ... (código de loading)
      return const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text('Obteniendo token...'),
        ],
      );
    }

    if (_errorMessage != null) {
      // ... (código de error)
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, color: Colors.red, size: 60),
          const SizedBox(height: 16),
          Text(
            'Error al obtener el token:',
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            _errorMessage!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.red),
          ),
          const SizedBox(height: 20),
          ElevatedButton.icon(
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
            onPressed: () {
              _fetchTokenAndStartTimers();
              // También intenta reconectar WS al reintentar
              _connectWebSocket();
            },
          ),
        ],
      );
    }

    // Vista principal con el QR
    return SingleChildScrollView(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            'Escanea el token QR',
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 30),
          if (_qrDataToken.isNotEmpty)
            QrImageView(
              data: _qrDataToken,
              version: QrVersions.auto,
              size: 250.0,
              gapless: false,
              errorStateBuilder: (cxt, err) {
                return const Center(
                  child: Text(
                    'Error al generar QR.',
                    textAlign: TextAlign.center,
                  ),
                );
              },
            )
          else
            const SizedBox(
              height: 250.0,
              width: 250.0,
              child: Center(child: Text('No hay token para mostrar.')),
            ),
          const SizedBox(height: 10),
          Text('Válido por:', style: Theme.of(context).textTheme.titleSmall),
          Text(
            '$_remainingSeconds',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.bold,
              color:
                  _remainingSeconds <= 10 ? Colors.redAccent : Colors.black87,
            ),
          ),
          Text(
            _remainingSeconds == 1 ? 'segundo' : 'segundos',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 15),
          OutlinedButton.icon(
            icon: const Icon(Icons.sync, size: 18),
            label: const Text('Refrescar ahora'),
            onPressed: () {
              _fetchTokenAndStartTimers();
              _connectWebSocket(); // Reconectar al refrescar manualmente
            },
            style: OutlinedButton.styleFrom(
              side: BorderSide(color: Theme.of(context).colorScheme.primary),
            ),
          ),
          // Opcional: Añadir un indicador de estado de WebSocket
          // const SizedBox(height: 10),
          // StreamBuilder(
          //   stream: _channel?.stream,
          //   builder: (context, snapshot) {
          //     String statusText = 'WS: Desconectado';
          //     Color statusColor = Colors.grey;
          //     if (snapshot.connectionState == ConnectionState.waiting) {
          //       statusText = 'WS: Conectando...';
          //       statusColor = Colors.orange;
          //     } else if (snapshot.connectionState == ConnectionState.active) {
          //       statusText = 'WS: Conectado';
          //       statusColor = Colors.green;
          //     } else if (snapshot.hasError) {
          //       statusText = 'WS: Error';
          //       statusColor = Colors.red;
          //     }
          //     return Text(statusText, style: TextStyle(color: statusColor, fontSize: 12));
          //   },
          // ),
        ],
      ),
    );
  }
}
