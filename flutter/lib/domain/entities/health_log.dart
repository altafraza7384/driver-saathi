import 'package:equatable/equatable.dart';

class HealthLog extends Equatable {
  final String id;
  final String userId;
  final DateTime logDate;
  final double? sleepHours;
  final int? waterGlasses;
  final int? breaksTaken;
  final int? steps;
  final String? notes;
  final DateTime createdAt;
  final DateTime updatedAt;

  const HealthLog({
    required this.id,
    required this.userId,
    required this.logDate,
    this.sleepHours,
    this.waterGlasses,
    this.breaksTaken,
    this.steps,
    this.notes,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isSleepGoalMet => (sleepHours ?? 0) >= 7;
  bool get isWaterGoalMet => (waterGlasses ?? 0) >= 8;
  bool get isBreaksGoalMet => (breaksTaken ?? 0) >= 4;
  bool get isStepsGoalMet => (steps ?? 0) >= 5000;

  HealthLog copyWith({
    String? id,
    String? userId,
    DateTime? logDate,
    double? sleepHours,
    int? waterGlasses,
    int? breaksTaken,
    int? steps,
    String? notes,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return HealthLog(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      logDate: logDate ?? this.logDate,
      sleepHours: sleepHours ?? this.sleepHours,
      waterGlasses: waterGlasses ?? this.waterGlasses,
      breaksTaken: breaksTaken ?? this.breaksTaken,
      steps: steps ?? this.steps,
      notes: notes ?? this.notes,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'user_id': userId,
      'log_date': logDate.toIso8601String().split('T')[0],
      'sleep_hours': sleepHours,
      'water_glasses': waterGlasses,
      'breaks_taken': breaksTaken,
      'steps': steps,
      'notes': notes,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory HealthLog.fromMap(Map<String, dynamic> map) {
    return HealthLog(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      logDate: DateTime.parse(map['log_date']),
      sleepHours: map['sleep_hours']?.toDouble(),
      waterGlasses: map['water_glasses'],
      breaksTaken: map['breaks_taken'],
      steps: map['steps'],
      notes: map['notes'],
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: DateTime.parse(map['updated_at']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        logDate,
        sleepHours,
        waterGlasses,
        breaksTaken,
        steps,
        notes,
        createdAt,
        updatedAt,
      ];
}
