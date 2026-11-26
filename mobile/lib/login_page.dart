import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  bool _isLoading = false;
  String? _errorMessage;

  final FirebaseAuth _auth = FirebaseAuth.instance;
  // --- INICIO DE CAMBIO ---
  // Especifica el hostedDomain al instanciar GoogleSignIn
  final GoogleSignIn _googleSignIn = GoogleSignIn(
    hostedDomain: "mail.udp.cl",
  );

  // --- Función para iniciar sesión con Google ---
  Future<void> _signInWithGoogle() async {
    if (_isLoading) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();

      if (googleUser == null) {
        if (mounted) setState(() => _isLoading = false);
        return; // El usuario canceló
      }
      // --- INICIO DE VERIFICACIÓN DE DOMINIO ADICIONAL (OPCIONAL PERO RECOMENDADO) ---
      if (googleUser.email.toLowerCase().endsWith('@mail.udp.cl') == false) {
        debugPrint("Intento de inicio de sesión con correo no permitido (Flutter): ${googleUser.email}");
        await _googleSignIn.signOut(); // Desconectar de Google para que pueda elegir otra cuenta
        if (mounted) {
          setState(() {
            _errorMessage = 'Solo se permiten cuentas @mail.udp.cl.';
            _isLoading = false;
          });
        }
        return; // No proceder con la autenticación de Firebase
      }

      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
      final AuthCredential credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      await _auth.signInWithCredential(credential);

      if (mounted) {
        setState(() => _isLoading = false);
      }
    } on FirebaseAuthException catch (e) {
      debugPrint("Error de Firebase Auth: ${e.code} - ${e.message}");
      String message = 'Ocurrió un error durante el inicio de sesión.';
      if (e.code == 'account-exists-with-different-credential') {
        message = 'Ya existe una cuenta con este email usando otro método.';
      } else if (e.code == 'network-request-failed') {
        message = 'Error de red. Verifica tu conexión.';
      }
      // Manejar otros errores específicos si es necesario
      if (mounted) {
        setState(() {
          _errorMessage = message;
          _isLoading = false;
        });
      }
    } catch (e) {
      // Esto podría capturar el error customizado si lo lanzamos desde el chequeo de dominio,
      // pero ya lo manejamos con setState arriba.
      debugPrint("Error inesperado en Google Sign-In: $e");
      if (mounted) {
        setState(() {
          // Si el error es nuestro mensaje personalizado, ya está establecido.
          // Si es otro error, establecer un mensaje genérico.
          _errorMessage ??= 'Ocurrió un error inesperado.';
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Iniciar Sesión'),
        backgroundColor: Colors.red,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const Text(
                'Bienvenido',
                style: TextStyle(fontSize: 24.0, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 30),

              // Muestra el indicador de carga o el botón
              _isLoading
                  ? const CircularProgressIndicator()
                  : ElevatedButton.icon(
                    icon: const Icon(Icons.login),
                    label: const Text('Iniciar sesión con Google'),
                    onPressed: _signInWithGoogle,
                    style: ElevatedButton.styleFrom(
                      foregroundColor: Colors.black,
                      backgroundColor:
                          Colors.white, // Texto negro, fondo blanco
                      minimumSize: const Size(
                        double.infinity,
                        50,
                      ), // Botón ancho
                    ),
                  ),

              const SizedBox(height: 20),

              // Muestra mensajes de error si existen
              if (_errorMessage != null)
                Padding(
                  padding: const EdgeInsets.only(top: 15.0),
                  child: Text(
                    _errorMessage!,
                    style: const TextStyle(color: Colors.red),
                    textAlign: TextAlign.center,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
