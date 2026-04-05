import 'package:equatable/equatable.dart';

class Reminder extends Equatable {
  final String id;
  final String userId;
  final String title;
  final String? description;
  final String category;
  final DateTime reminderDate;
  final DateTime? notifyAt;
  final bool isCompleted;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Reminder({
    required this.id,
    required this.userId,
    required this.title,
    this.description,
    required this.category,
    required this.reminderDate,
    this.notifyAt,
    required this.isCompleted,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isOverdue =>
      !isCompleted && reminderDate.isBefore(DateTime.now());

  Reminder copyWith({
    String? id,
    String? userId,
    String? title,
    String? description,
    String? category,
    DateTime? reminderDate,
    DateTime? notifyAt,
    bool? isCompleted,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Reminder(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      title: title ?? this.title,
      description: description ?? this.description,
      category: category ?? this.category,
      reminderDate: reminderDate ?? this.reminderDate,
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
      'title': title,
      'description': description,
      'category': category,
      'reminder_date': reminderDate.toIso8601String().split('T')[0],
      'notify_at': notifyAt?.toIso8601String(),
      'is_completed': isCompleted,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory Reminder.fromMap(Map<String, dynamic> map) {
    return Reminder(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      title: map['title'] ?? '',
      description: map['description'],
      category: map['category'] ?? 'general',
      reminderDate: DateTime.parse(map['reminder_date']),
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
        title,
        description,
        category,
        reminderDate,
        notifyAt,
        isCompleted,
        createdAt,
        updatedAt,
      ];
}
