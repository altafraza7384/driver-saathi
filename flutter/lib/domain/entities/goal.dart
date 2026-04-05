import 'package:equatable/equatable.dart';

class Goal extends Equatable {
  final String id;
  final String userId;
  final String title;
  final double targetAmount;
  final double savedAmount;
  final DateTime? deadline;
  final bool isCompleted;
  final DateTime? notifyAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Goal({
    required this.id,
    required this.userId,
    required this.title,
    required this.targetAmount,
    required this.savedAmount,
    this.deadline,
    required this.isCompleted,
    this.notifyAt,
    required this.createdAt,
    required this.updatedAt,
  });

  double get progressPercent =>
      targetAmount > 0 ? (savedAmount / targetAmount) * 100 : 0;
  double get remainingAmount => targetAmount - savedAmount;

  Goal copyWith({
    String? id,
    String? userId,
    String? title,
    double? targetAmount,
    double? savedAmount,
    DateTime? deadline,
    bool? isCompleted,
    DateTime? notifyAt,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Goal(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      title: title ?? this.title,
      targetAmount: targetAmount ?? this.targetAmount,
      savedAmount: savedAmount ?? this.savedAmount,
      deadline: deadline ?? this.deadline,
      isCompleted: isCompleted ?? this.isCompleted,
      notifyAt: notifyAt ?? this.notifyAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'user_id': userId,
      'title': title,
      'target_amount': targetAmount,
      'saved_amount': savedAmount,
      'deadline': deadline?.toIso8601String(),
      'is_completed': isCompleted,
      'notify_at': notifyAt?.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory Goal.fromMap(Map<String, dynamic> map) {
    return Goal(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      title: map['title'] ?? '',
      targetAmount: (map['target_amount'] ?? 0).toDouble(),
      savedAmount: (map['saved_amount'] ?? 0).toDouble(),
      deadline: map['deadline'] != null ? DateTime.parse(map['deadline']) : null,
      isCompleted: map['is_completed'] ?? false,
      notifyAt: map['notify_at'] != null ? DateTime.parse(map['notify_at']) : null,
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: DateTime.parse(map['updated_at']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        title,
        targetAmount,
        savedAmount,
        deadline,
        isCompleted,
        notifyAt,
        createdAt,
        updatedAt,
      ];
}
