# Driver Saathi - Flutter App

A comprehensive mobile-first application designed for drivers (primarily ride-sharing drivers) to manage their finances, health, vehicle maintenance, and personal safety.

## Features

### 1. Financial Management
- **Income/Expense Tracking**: Log daily earnings and expenses with categories and platforms (Uber, Ola, etc.)
- **Debt & EMI Management**: Track loans, calculate EMIs, and record payments with progress visualization
- **Savings Goals**: Set financial targets with deadline tracking and progress monitoring
- **Weekly Charts**: Visual representation of weekly income/expense trends

### 2. Health & Wellness
- **Daily Health Logging**: Track sleep hours, water intake, steps, and breaks
- **Weekly Reports**: View averages and trends with visual charts
- **Quick Actions**: One-tap buttons to log common metrics

### 3. Vehicle Management
- **Car Maintenance Checks**: Record maintenance activities with odometer readings and costs
- **Document Tracking**: Monitor vehicle document expiry dates with alerts
- **Service History**: Complete maintenance log

### 4. Personal Organization
- **Notes**: Create text notes with tags and search functionality
- **Reminders**: Set reminders with scheduled notifications
- **Voice Notes**: Support for audio notes (future)

### 5. Safety
- **Emergency SOS**: Quick access to emergency contacts with GPS location sharing

### 6. Additional Features
- **Multi-language Support**: English, Hindi, Marathi, Telugu, Kannada
- **Dark/Light Theme**: Toggle between themes
- **Offline Support**: Local data caching
- **PDF Export**: Export all data as formatted PDF
- **Ad Integration**: Banner ads support

## Tech Stack

- **Framework**: Flutter 3.x
- **Language**: Dart
- **Backend**: Supabase (PostgreSQL, Auth, Real-time)
- **State Management**: Provider + BLoC pattern
- **Database**: SQLite (local), Supabase (remote)
- **Notifications**: flutter_local_notifications
- **Charts**: fl_chart
- **PDF**: pdf, printing
- **Maps**: google_maps_flutter

## Project Structure

```
lib/
├── core/
│   ├── constants/          # App constants, routes
│   ├── theme/              # Light/dark themes
│   ├── utils/              # Currency, date utilities
│   ├── errors/             # Error handling
│   └── services/           # Service locator
├── domain/
│   ├── entities/           # Data models
│   └── repositories/       # Repository interfaces
├── data/
│   ├── datasources/        # Local & remote data sources
│   └── repositories/       # Repository implementations
├── presentation/
│   ├── pages/              # UI screens
│   ├── widgets/            # Reusable widgets
│   ├── providers/          # State providers
│   └── blocs/              # BLoC state management
└── main.dart
```

## Getting Started

### Prerequisites
- Flutter SDK 3.0 or higher
- Dart SDK
- Android Studio / Xcode
- Supabase account

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd driver_saathi/flutter
```

2. **Install dependencies**
```bash
flutter pub get
```

3. **Configure Supabase**
   - Create a new project on [Supabase](https://supabase.com)
   - Copy your project URL and anon key
   - Update `lib/core/constants/app_constants.dart`:
```dart
static const String supabaseUrl = 'YOUR_SUPABASE_URL';
static const String supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';
```

4. **Set up the database**
   - Run the SQL schema in `supabase/schema.sql` in your Supabase SQL editor
   - Enable Row Level Security (RLS) policies

5. **Run the app**
```bash
flutter run
```

### Building for Production

**Android:**
```bash
flutter build apk --release
flutter build appbundle --release
```

**iOS:**
```bash
flutter build ios --release
```

## Database Schema

The app uses the following Supabase tables:

- `profiles` - User profiles
- `transactions` - Income/expense records
- `debts` - Loan information
- `debt_payments` - Payment history
- `goals` - Savings goals
- `health_logs` - Daily health metrics
- `car_checks` - Maintenance records
- `car_documents` - Document tracking
- `notes` - User notes
- `reminders` - Reminder items
- `emergency_contacts` - SOS contacts

## Configuration

### Environment Variables
Create a `.env` file in the project root:
```
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Push Notifications
Configure FCM for Android and APNS for iOS in your Firebase Console.

### Ads
Update the ad unit IDs in `lib/core/constants/app_constants.dart` for AdMob integration.

## Architecture

This app follows **Clean Architecture** principles with:
- **Presentation Layer**: UI components, providers, BLoCs
- **Domain Layer**: Entities and business logic
- **Data Layer**: Data sources and repositories

## Testing

```bash
# Run unit tests
flutter test

# Run integration tests
flutter test integration_test/app_test.dart
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary software. All rights reserved.

## Acknowledgments

- Original React app by Driver Saathi Team
- Flutter community packages and plugins
- Supabase for the backend infrastructure

## Support

For support, email support@driversaathi.com or join our Slack channel.

---

**Note**: This Flutter app is a migration from the original React web application. Some features may differ slightly from the web version.
