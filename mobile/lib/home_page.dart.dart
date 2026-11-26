import 'dart:async'; // Importa 'dart:async' para usar StreamSubscription
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'qr_generator.dart';
import 'qr_validator.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

class HomePage extends StatefulWidget {
  final User user; // Recibe el usuario autenticado
  const HomePage({super.key, required this.user});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List<String> _userRoles = [];
  bool _isLoadingRoles = true;
  // Variable para manejar la suscripción a los datos en tiempo real
  StreamSubscription<DocumentSnapshot>? _userRolesSubscription;

  @override
  void initState() {
    super.initState();
    // Cambiamos la función que se llama para escuchar en tiempo real
    _listenForUserRoles();
    saveUserFCMToken();
  }

  // ✅ NUEVA FUNCIÓN: Escucha los cambios en el documento del usuario en tiempo real
  void _listenForUserRoles() {
    setState(() {
      _isLoadingRoles = true;
    });

    // Cancelamos cualquier suscripción anterior para evitar fugas de memoria
    _userRolesSubscription?.cancel();

    // Nos suscribimos a los cambios del documento del usuario
    _userRolesSubscription = FirebaseFirestore.instance
        .collection('users')
        .doc(widget.user.uid)
        .snapshots() // Usamos .snapshots() en lugar de .get() para escuchar
        .listen((DocumentSnapshot userDoc) {
      if (!mounted) return; // Comprobamos si el widget sigue "vivo"

      try {
        if (userDoc.exists && userDoc.data() != null) {
          final data = userDoc.data() as Map<String, dynamic>;

          if (data.containsKey('roles')) {
            var rolesData = data['roles'];
            if (rolesData is List) {
              // Usamos .cast<String>() para asegurar el tipo
              _userRoles = rolesData.cast<String>().toList();
            } else if (rolesData is String) {
              _userRoles = [rolesData];
            } else {
              _userRoles = [];
            }
            debugPrint("¡Roles actualizados en tiempo real!: $_userRoles");
          } else {
            debugPrint("Documento de usuario existe, pero aún no tiene el campo 'roles'. Esperando...");
            _userRoles = [];
          }
        } else {
          debugPrint("Documento de usuario aún no existe. Esperando...");
          _userRoles = [];
        }
      } catch (e) {
        debugPrint("Error procesando los datos de roles: $e");
        _userRoles = [];
      } finally {
        // Actualizamos el estado para que la UI se reconstruya
        setState(() {
          _isLoadingRoles = false;
        });
      }
    }, onError: (error) {
      // Manejo de errores de la escucha
      debugPrint("Error en la escucha de roles: $error");
      if(mounted) {
        setState(() {
          _userRoles = [];
          _isLoadingRoles = false;
        });
      }
    });
  }

  // ✅ NUEVA FUNCIÓN: Detiene la escucha cuando la pantalla se destruye
  @override
  void dispose() {
    _userRolesSubscription?.cancel(); // Muy importante: cancela la suscripción
    super.dispose();
  }

  Future<void> saveUserFCMToken() async {
    final user = widget.user;
    try {
      final fcmToken = await FirebaseMessaging.instance.getToken();
      if (fcmToken != null) {
        final userDocRef =
            FirebaseFirestore.instance.collection('users').doc(user.uid);
        await userDocRef.set({
          'fcmToken': fcmToken,
          'lastTokenUpdate': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
        debugPrint("FCM Token for user ${user.uid} saved: $fcmToken");
      }
    } catch (e) {
      debugPrint("Error saving FCM token: $e");
    }
  }

  Future<void> _signOut() async {
    try {
      if (await GoogleSignIn().isSignedIn()) {
        await GoogleSignIn().signOut();
        debugPrint("Google signOut exitoso");
      }
      await FirebaseAuth.instance.signOut();
      debugPrint("FirebaseAuth signOut exitoso");
    } catch (e) {
      debugPrint("Error al cerrar sesión: $e");
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Error al cerrar sesión.')));
      }
    }
  }

  bool get canGenerateQR {
    return _userRoles.contains('estudiante') || _userRoles.contains('admin');
  }

  bool get canScanQR {
    return _userRoles.contains('profesor') ||
        _userRoles.contains('ayudante') ||
        _userRoles.contains('admin');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Hola, ${widget.user.displayName ?? widget.user.email ?? 'Usuario'}',
        ),
        backgroundColor: Colors.red,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Cerrar sesión',
            onPressed: _signOut,
          ),
        ],
      ),
      body: Center(
        child: _isLoadingRoles
            ? const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 10),
                  Text("Cargando datos de usuario..."),
                ],
              )
            : Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    if (_userRoles.isNotEmpty)
                      Text(
                        'Mis Roles: ${_userRoles.join(", ")}',
                        style: const TextStyle(
                            fontSize: 14, color: Colors.black54),
                        textAlign: TextAlign.center,
                      )
                    else
                      const Text(
                        'Roles no definidos.',
                        style: TextStyle(
                            fontSize: 14, color: Colors.black54),
                      ),
                    const SizedBox(height: 20),
                    const Text(
                      'Funciones disponibles:',
                      style: TextStyle(
                          fontSize: 22.0, fontWeight: FontWeight.bold),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 30),
                    if (canGenerateQR)
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          icon: const Icon(Icons.qr_code_2),
                          label: const Text('Generar mi QR de Asistencia'),
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) =>
                                    QrTab(userId: widget.user.uid),
                              ),
                            );
                          },
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                    if (canGenerateQR && canScanQR) const SizedBox(height: 20),
                    if (canScanQR)
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          icon: const Icon(Icons.qr_code_scanner),
                          label: const Text('Escanear y Validar QR'),
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) => const ValidateTokenPage(),
                              ),
                            );
                          },
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                    if (!canGenerateQR && !canScanQR && !_isLoadingRoles)
                      Padding(
                        padding: const EdgeInsets.only(top: 20.0),
                        child: Text(
                          "No tienes funciones asignadas en la aplicación móvil en este momento. Contacta a un administrador si crees que esto es un error.",
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.grey[700]),
                        ),
                      ),
                  ],
                ),
              ),
      ),
    );
  }
}
