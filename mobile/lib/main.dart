import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'firebase_options.dart';
import 'home_page.dart.dart';
import 'login_page.dart';
import 'package:no_screenshot/no_screenshot.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:firebase_messaging/firebase_messaging.dart';


const _configuredApiUrl = String.fromEnvironment('API_BASE_URL');
final String baseUrl = _configuredApiUrl.trim().replaceFirst(RegExp(r'/+$'), '');

void main() async { // Convertir a async
  WidgetsFlutterBinding.ensureInitialized();
  final uri = Uri.tryParse(baseUrl);
  if (uri == null || !{'http', 'https'}.contains(uri.scheme) ||
      uri.host.isEmpty || uri.userInfo.isNotEmpty || uri.hasQuery || uri.hasFragment) {
    runApp(const MaterialApp(home: Scaffold(body: Center(
      child: Text('Configura API_BASE_URL con --dart-define antes de continuar.'),
    ))));
    return;
  }
  await initializeDateFormatting('es_CL', null); // Para español de Chile
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await setupFCM();
  runApp(const MyApp());
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  final _noScreenshot = NoScreenshot.instance;

  @override
  void initState() {
    super.initState();
    //_preventScreenshots();
  }

  Future<void> _preventScreenshots() async {
    try {
      // Deshabilita las capturas de pantalla
      await _noScreenshot.screenshotOff();
      debugPrint('Capturas de pantalla deshabilitadas.');
    } catch (e) {
      debugPrint('Error al deshabilitar capturas de pantalla: $e');
    }
  }

  @override
  void dispose() {
    // Opcional: Si quisieras permitir capturas al cerrar la app,
    // aunque si la política es "nunca", esto no sería necesario.
    // _noScreenshot.screenshotOn();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Validación Asistencia', // O el título de tu app
      theme: ThemeData(primarySwatch: Colors.red, useMaterial3: true),
      home: const AuthWrapper(),
    );
  }
}

class AuthWrapper extends StatelessWidget {
  const AuthWrapper({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasData && snapshot.data != null) {
          return HomePage(user: snapshot.data!);
        }
        return const LoginPage();
      },
    );
  }
}
Future<void> setupFCM() async {
  final messaging = FirebaseMessaging.instance;

  // Pide permiso al usuario en iOS y web
  await messaging.requestPermission(
    alert: true,
    announcement: false,
    badge: true,
    carPlay: false,
    criticalAlert: false,
    provisional: false,
    sound: true,
  );

  // Escucha los mensajes mientras la app está en primer plano
  FirebaseMessaging.onMessage.listen((RemoteMessage message) {
    debugPrint('Got a message whilst in the foreground!');
    debugPrint('Message data: ${message.data}');

    if (message.notification != null) {
      debugPrint('Message also contained a notification: ${message.notification}');
      // Aquí podrías usar un paquete como 'flutter_local_notifications'
      // para mostrar una notificación visible si la app está abierta.
    }
  });
}

