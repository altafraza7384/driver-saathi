import 'package:equatable/equatable.dart';

class CarCheck extends Equatable {
  final String id;
  final String userId;
  final String checkType;
  final String? description;
  final int? odometerReading;
  final double? cost;
  final DateTime checkDate;
  final DateTime? nextDueDate;
  final DateTime? notifyAt;
  final bool isCompleted;
  final DateTime createdAt;
  final DateTime updatedAt;

  const CarCheck({
    required this.id,
    required this.userId,
    required this.checkType,
    this.description,
    this.odometerReading,
    this.cost,
    required this.checkDate,
    this.nextDueDate,
    this.notifyAt,
    required this.isCompleted,
    required this.createdAt,
    required this.updatedAt,
  });

  CarCheck copyWith({
    String? id,
    String? userId,
    String? checkType,
    String? description,
    int? odometerReading,
    double? cost,
    DateTime? checkDate,
    DateTime? nextDueDate,
    DateTime? notifyAt,
    bool? isCompleted,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return CarCheck(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      checkType: checkType ?? this.checkType,
      description: description ?? this.description,
      odometerReading: odometerReading ?? this.odometerReading,
      cost: cost ?? this.cost,
      checkDate: checkDate ?? this.checkDate,
      nextDueDate: nextDueDate ?? this.nextDueDate,
      notifyAt: notifyAt ?? this.notifyAt,
      isCompleted: isCompleted ?? this.isCompleted,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'user_id': userId,
      'check_type': checkType,
      'description': description,
      'odometer_reading': odometerReading,
      'cost': cost,
      'check_date': checkDate.toIso8601String().split('T')[0],
      'next_due_date': nextDueDate?.toIso8601String().split('T')[0],
      'notify_at': notifyAt?.toIso8601String(),
      'is_completed': isCompleted,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory CarCheck.fromMap(Map<String, dynamic> map) {
    return CarCheck(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      checkType: map['check_type'] ?? '',
      description: map['description'],
      odometerReading: map['odometer_reading'],
      cost: map['cost']?.toDouble(),
      checkDate: DateTime.parse(map['check_date']),
      nextDueDate: map['next_due_date'] != null
          ? DateTime.parse(map['next_due_date'])
          : null,
      notifyAt: map['notify_at'] != null
          ? DateTime.parse(map['notify_at'])
          : null,
      isCompleted: map['is_completed'] ?? false,
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: DateTime.parse(map['updated_at']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        checkType,
        description,
        odometerReading,
        cost,
        checkDate,
        nextDueDate,
        notifyAt,
        isCompleted,
        createdAt,
        updatedAt,
      ];
}
