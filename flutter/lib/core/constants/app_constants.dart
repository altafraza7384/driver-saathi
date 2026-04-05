class AppConstants {
  // Supabase Configuration
  static const String supabaseUrl = 'YOUR_SUPABASE_URL';
  static const String supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';

  // App Info
  static const String appName = 'Driver Saathi';
  static const String appVersion = '1.0.0';

  // Routes
  static const String routeHome = '/';
  static const String routeTransactions = '/transactions';
  static const String routeAddTransaction = '/transactions/add';
  static const String routeDebts = '/debts';
  static const String routeGoals = '/goals';
  static const String routeHealth = '/health';
  static const String routeAssistant = '/assistant';
  static const String routeMore = '/more';
  static const String routeCarChecks = '/car-checks';
  static const String routeReminders = '/reminders';
  static const String routeNotes = '/notes';
  static const String routeSOS = '/sos';
  static const String routeSettings = '/settings';
  static const String routeDataBackup = '/data-backup';
  static const String routeFinanceAI = '/finance-ai';
  static const String routeAuth = '/auth';

  // Transaction Categories
  static const List<String> incomeCategories = [
    'Ride Earnings',
    'Tips',
    'Incentives',
    'Bonus',
    'Other',
  ];

  static const List<String> expenseCategories = [
    'Fuel',
    'Maintenance',
    'Food',
    'Tolls',
    'Insurance',
    'EMI',
    'Phone',
    'Other',
  ];

  // Car Check Types
  static const List<String> defaultCheckTypes = [
    'Oil Change',
    'Tire Rotation',
    'Brake Check',
    'Battery',
    'Air Filter',
    'Coolant',
    'PUC',
    'Insurance',
    'Fitness Certificate',
    'General Service',
  ];

  // Languages
  static const Map<String, String> languages = {
    'en': 'English',
    'hi': 'Hindi',
    'mr': 'Marathi',
    'te': 'Telugu',
    'kn': 'Kannada',
  };

  // Health Metrics
  static const int maxSleepHours = 10;
  static const int maxWaterGlasses = 12;
  static const int maxBreaks = 8;
  static const int maxSteps = 10000;

  // Cache Keys
  static const String cacheKeyProfile = 'cached_profile';
  static const String cacheKeyTransactions = 'cached_transactions';
  static const String cacheKeyDebts = 'cached_debts';
  static const String cacheKeyGoals = 'cached_goals';
  static const String cacheKeyHealthLogs = 'cached_health_logs';
  static const String cacheKeyTheme = 'app_theme_mode';
  static const String cacheKeyLanguage = 'app_language';

  // Notification Channels
  static const String channelIdReminders = 'reminders_channel';
  static const String channelNameReminders = 'Reminders';
  static const String channelDescReminders = 'Reminder notifications';

  static const String channelIdSOS = 'sos_channel';
  static const String channelNameSOS = 'Emergency SOS';
  static const String channelDescSOS = 'Emergency notifications';
}
