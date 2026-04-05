import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/constants/app_constants.dart';

class ThemeProvider extends StatefulWidget {
  final Widget Function(BuildContext context, ThemeMode themeMode) builder;

  const ThemeProvider({super.key, required this.builder});

  static ThemeProviderState of(BuildContext context) {
    return context.findAncestorStateOfType<ThemeProviderState>()!;
  }

  @override
  State<ThemeProvider> createState() => ThemeProviderState();
}

class ThemeProviderState extends State<ThemeProvider> {
  ThemeMode _themeMode = ThemeMode.light;
  bool _isLoading = true;

  ThemeMode get themeMode => _themeMode;
  bool get isDarkMode => _themeMode == ThemeMode.dark;

  @override
  void initState() {
    super.initState();
    _loadTheme();
  }

  Future<void> _loadTheme() async {
    final prefs = await SharedPreferences.getInstance();
    final themeString = prefs.getString(AppConstants.cacheKeyTheme);

    setState(() {
      if (themeString == 'dark') {
        _themeMode = ThemeMode.dark;
      } else if (themeString == 'light') {
        _themeMode = ThemeMode.light;
      } else {
        _themeMode = ThemeMode.system;
      }
      _isLoading = false;
    });
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    String themeString;
    switch (mode) {
      case ThemeMode.dark:
        themeString = 'dark';
        break;
      case ThemeMode.light:
        themeString = 'light';
        break;
      case ThemeMode.system:
        themeString = 'system';
        break;
    }

    await prefs.setString(AppConstants.cacheKeyTheme, themeString);

    setState(() {
      _themeMode = mode;
    });
  }

  Future<void> toggleTheme() async {
    final newMode = _themeMode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
    await setThemeMode(newMode);
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const MaterialApp(
        home: Scaffold(
          body: Center(
            child: CircularProgressIndicator(),
          ),
        ),
      );
    }

    return widget.builder(context, _themeMode);
  }
}
