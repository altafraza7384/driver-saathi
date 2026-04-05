import 'package:intl/intl.dart';

class CurrencyUtils {
  static String formatINR(double amount, {bool showSymbol = true}) {
    final isNegative = amount < 0;
    final abs = amount.abs();
    final symbol = showSymbol ? '₹' : '';

    final formatter = NumberFormat('#,##0.##', 'en_IN');
    final formatted = formatter.format(abs);

    return '${isNegative ? '-' : ''}$symbol$formatted';
  }

  static String formatINRCompact(double amount) {
    final abs = amount.abs();
    final sign = amount < 0 ? '-' : '';

    if (abs >= 10000000) {
      return '${sign}₹${(abs / 10000000).toStringAsFixed(1)}Cr';
    }
    if (abs >= 100000) {
      return '${sign}₹${(abs / 100000).toStringAsFixed(1)}L';
    }
    if (abs >= 1000) {
      return '${sign}₹${(abs / 1000).toStringAsFixed(1)}K';
    }
    return '${sign}₹${abs.toStringAsFixed(0)}';
  }

  static String formatNumber(double number) {
    final formatter = NumberFormat('#,##0.##', 'en_IN');
    return formatter.format(number);
  }

  static double parseAmount(String value) {
    return double.tryParse(value.replaceAll(',', '')) ?? 0;
  }
}
