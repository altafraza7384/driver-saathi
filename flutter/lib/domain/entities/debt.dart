import 'package:equatable/equatable.dart';

class Debt extends Equatable {
  final String id;
  final String userId;
  final String name;
  final double principal;
  final double interestRate;
  final int tenureMonths;
  final double? emiAmount;
  final double totalPaid;
  final DateTime startDate;
  final bool isActive;
  final DateTime? notifyAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Debt({
    required this.id,
    required this.userId,
    required this.name,
    required this.principal,
    required this.interestRate,
    required this.tenureMonths,
    this.emiAmount,
    required this.totalPaid,
    required this.startDate,
    required this.isActive,
    this.notifyAt,
    required this.createdAt,
    required this.updatedAt,
  });

  double get remainingAmount => principal - totalPaid;
  double get progressPercent => principal > 0 ? (totalPaid / principal) * 100 : 0;

  double calculateEMI() {
    if (interestRate == 0) return principal / tenureMonths;
    final monthlyRate = interestRate / 12 / 100;
    return (principal * monthlyRate * pow(1 + monthlyRate, tenureMonths)) /
        (pow(1 + monthlyRate, tenureMonths) - 1);
  }

  Debt copyWith({
    String? id,
    String? userId,
    String? name,
    double? principal,
    double? interestRate,
    int? tenureMonths,
    double? emiAmount,
    double? totalPaid,
    DateTime? startDate,
    bool? isActive,
    DateTime? notifyAt,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Debt(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      name: name ?? this.name,
      principal: principal ?? this.principal,
      interestRate: interestRate ?? this.interestRate,
      tenureMonths: tenureMonths ?? this.tenureMonths,
      emiAmount: emiAmount ?? this.emiAmount,
      totalPaid: totalPaid ?? this.totalPaid,
      startDate: startDate ?? this.startDate,
      isActive: isActive ?? this.isActive,
      notifyAt: notifyAt ?? this.notifyAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'user_id': userId,
      'name': name,
      'principal': principal,
      'interest_rate': interestRate,
      'tenure_months': tenureMonths,
      'emi_amount': emiAmount,
      'total_paid': totalPaid,
      'start_date': startDate.toIso8601String(),
      'is_active': isActive,
      'notify_at': notifyAt?.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory Debt.fromMap(Map<String, dynamic> map) {
    return Debt(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      name: map['name'] ?? '',
      principal: (map['principal'] ?? 0).toDouble(),
      interestRate: (map['interest_rate'] ?? 0).toDouble(),
      tenureMonths: map['tenure_months'] ?? 12,
      emiAmount: map['emi_amount']?.toDouble(),
      totalPaid: (map['total_paid'] ?? 0).toDouble(),
      startDate: DateTime.parse(map['start_date']),
      isActive: map['is_active'] ?? true,
      notifyAt: map['notify_at'] != null ? DateTime.parse(map['notify_at']) : null,
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: DateTime.parse(map['updated_at']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        name,
        principal,
        interestRate,
        tenureMonths,
        emiAmount,
        totalPaid,
        startDate,
        isActive,
        notifyAt,
        createdAt,
        updatedAt,
      ];
}

// Helper for pow function
double pow(double x, int n) {
  double result = 1;
  for (int i = 0; i < n; i++) {
    result *= x;
  }
  return result;
}
