import 'package:intl/intl.dart';

class DateUtils {
  static final DateFormat _dateFormat = DateFormat('dd MMM yyyy');
  static final DateFormat _dateTimeFormat = DateFormat('dd MMM yyyy, hh:mm a');
  static final DateFormat _timeFormat = DateFormat('hh:mm a');
  static final DateFormat _isoFormat = DateFormat('yyyy-MM-dd');
  static final DateFormat _dayFormat = DateFormat('EEE');

  static String formatDate(DateTime date) {
    return _dateFormat.format(date);
  }

  static String formatDateTime(DateTime date) {
    return _dateTimeFormat.format(date);
  }

  static String formatTime(DateTime date) {
    return _timeFormat.format(date);
  }

  static String formatISODate(DateTime date) {
    return _isoFormat.format(date);
  }

  static String formatDay(DateTime date) {
    return _dayFormat.format(date);
  }

  static String getRelativeDate(DateTime date) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final dateToCheck = DateTime(date.year, date.month, date.day);

    final difference = dateToCheck.difference(today).inDays;

    if (difference == 0) return 'Today';
    if (difference == 1) return 'Tomorrow';
    if (difference == -1) return 'Yesterday';
    if (difference > 0 && difference < 7) {
      return DateFormat('EEEE').format(date);
    }

    return formatDate(date);
  }

  static DateTime startOfWeek(DateTime date, {int weekStartsOn = 1}) {
    final day = date.weekday;
    final diff = day - weekStartsOn;
    return DateTime(date.year, date.month, date.day - diff);
  }

  static DateTime endOfWeek(DateTime date, {int weekStartsOn = 1}) {
    final start = startOfWeek(date, weekStartsOn: weekStartsOn);
    return start.add(const Duration(days: 6));
  }

  static List<DateTime> daysInRange(DateTime start, DateTime end) {
    final days = <DateTime>[];
    var current = start;
    while (current.isBefore(end) || current.isAtSameMomentAs(end)) {
      days.add(current);
      current = current.add(const Duration(days: 1));
    }
    return days;
  }

  static bool isSameDay(DateTime a, DateTime b) {
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }

  static int daysUntil(DateTime date) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(date.year, date.month, date.day);
    return target.difference(today).inDays;
  }

  static String getGreeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }
}
