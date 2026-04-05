import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/theme/app_theme.dart';
import 'core/constants/app_constants.dart';
import 'core/services/service_locator.dart';
import 'presentation/providers/auth_provider.dart';
import 'presentation/providers/theme_provider.dart';
import 'presentation/pages/auth/auth_page.dart';
import 'presentation/pages/home/home_page.dart';
import 'presentation/pages/transactions/transactions_page.dart';
import 'presentation/pages/transactions/add_transaction_page.dart';
import 'presentation/pages/debts/debts_page.dart';
import 'presentation/pages/goals/goals_page.dart';
import 'presentation/pages/health/health_page.dart';
import 'presentation/pages/car_checks/car_checks_page.dart';
import 'presentation/pages/notes/notes_page.dart';
import 'presentation/pages/reminders/reminders_page.dart';
import 'presentation/pages/sos/sos_page.dart';
import 'presentation/pages/more/more_page.dart';
import 'presentation/pages/settings/settings_page.dart';
import 'presentation/widgets/app_layout.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Set preferred orientations
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Initialize Supabase
  await Supabase.initialize(
    url: AppConstants.supabaseUrl,
    anonKey: AppConstants.supabaseAnonKey,
    debug: false,
  );

  // Initialize service locator
  await ServiceLocator.init();

  runApp(const DriverSaathiApp());
}

class DriverSaathiApp extends StatelessWidget {
  const DriverSaathiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return AuthProvider(
      child: ThemeProvider(
        builder: (context, themeMode) {
          return MaterialApp(
            title: 'Driver Saathi',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: themeMode,
            localizationsDelegates: const [
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            supportedLocales: const [
              Locale('en'),
              Locale('hi'),
              Locale('mr'),
              Locale('te'),
              Locale('kn'),
            ],
            initialRoute: '/',
            routes: {
              '/': (context) => const AuthWrapper(),
              '/auth': (context) => const AuthPage(),
              '/settings': (context) => const SettingsPage(),
              '/transactions': (context) => const TransactionsPage(),
              '/debts': (context) => const DebtsPage(),
              '/goals': (context) => const GoalsPage(),
              '/health': (context) => const HealthPage(),
              '/car-checks': (context) => const CarChecksPage(),
              '/notes': (context) => const NotesPage(),
              '/reminders': (context) => const RemindersPage(),
              '/sos': (context) => const SOSPage(),
            },
            onGenerateRoute: (settings) {
              // Handle routes with arguments
              if (settings.name == '/transactions/add') {
                final args = settings.arguments as Map<String, dynamic>?;
                return MaterialPageRoute(
                  builder: (context) => AddTransactionPage(
                    initialType: args?['type'] as String?,
                  ),
                );
              }
              return null;
            },
          );
        },
      ),
    );
  }
}

class AuthWrapper extends StatelessWidget {
  const AuthWrapper({super.key});

  @override
  Widget build(BuildContext context) {
    final authState = AuthProvider.of(context);

    if (authState.isLoading) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (authState.user == null) {
      return const AuthPage();
    }

    return const AppLayout();
  }
}
