import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../domain/entities/profile.dart';

class AuthProvider extends StatefulWidget {
  final Widget child;

  const AuthProvider({super.key, required this.child});

  static AuthProviderState of(BuildContext context) {
    return context.findAncestorStateOfType<AuthProviderState>()!;
  }

  @override
  State<AuthProvider> createState() => AuthProviderState();
}

class AuthProviderState extends State<AuthProvider> {
  User? _user;
  Profile? _profile;
  bool _isLoading = true;
  String? _error;

  User? get user => _user;
  Profile? get profile => _profile;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isAuthenticated => _user != null;

  final supabase = Supabase.instance.client;

  @override
  void initState() {
    super.initState();
    _initAuth();
  }

  Future<void> _initAuth() async {
    try {
      // Check current session
      final session = supabase.auth.currentSession;
      if (session != null) {
        _user = session.user;
        await _fetchProfile();
      }

      // Listen to auth changes
      supabase.auth.onAuthStateChange.listen((data) {
        final AuthChangeEvent event = data.event;
        final Session? session = data.session;

        setState(() {
          _user = session?.user;
          _isLoading = false;
        });

        if (event == AuthChangeEvent.signedIn && _user != null) {
          _fetchProfile();
        } else if (event == AuthChangeEvent.signedOut) {
          setState(() {
            _profile = null;
          });
        }
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  Future<void> _fetchProfile() async {
    if (_user == null) return;

    try {
      final response = await supabase
          .from('profiles')
          .select()
          .eq('user_id', _user!.id)
          .single();

      setState(() {
        _profile = Profile.fromMap(response);
      });
    } catch (e) {
      debugPrint('Error fetching profile: $e');
    }
  }

  Future<void> signInWithPassword(String email, String password) async {
    try {
      setState(() {
        _isLoading = true;
        _error = null;
      });

      final response = await supabase.auth.signInWithPassword(
        email: email,
        password: password,
      );

      setState(() {
        _user = response.user;
      });

      await _fetchProfile();
    } on AuthException catch (e) {
      setState(() {
        _error = e.message;
      });
      rethrow;
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  Future<void> signUpWithPassword(
    String email,
    String password,
    String fullName,
  ) async {
    try {
      setState(() {
        _isLoading = true;
        _error = null;
      });

      final response = await supabase.auth.signUp(
        email: email,
        password: password,
        data: {'full_name': fullName},
      );

      setState(() {
        _user = response.user;
      });
    } on AuthException catch (e) {
      setState(() {
        _error = e.message;
      });
      rethrow;
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  Future<void> signInWithGoogle() async {
    try {
      setState(() {
        _isLoading = true;
        _error = null;
      });

      await supabase.auth.signInWithOAuth(
        OAuthProvider.google,
        redirectTo: 'io.supabase.driversaathi://login-callback/',
      );
    } on AuthException catch (e) {
      setState(() {
        _error = e.message;
      });
      rethrow;
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  Future<void> signOut() async {
    try {
      setState(() {
        _isLoading = true;
      });

      await supabase.auth.signOut();

      setState(() {
        _user = null;
        _profile = null;
      });
    } catch (e) {
      debugPrint('Error signing out: $e');
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  Future<void> updateProfile(Profile updatedProfile) async {
    try {
      await supabase
          .from('profiles')
          .update(updatedProfile.toMap())
          .eq('id', updatedProfile.id);

      setState(() {
        _profile = updatedProfile;
      });
    } catch (e) {
      debugPrint('Error updating profile: $e');
      rethrow;
    }
  }

  @override
  Widget build(BuildContext context) {
    return widget.child;
  }
}
