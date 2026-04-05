import 'package:equatable/equatable.dart';

class EmergencyContact extends Equatable {
  final String id;
  final String userId;
  final String name;
  final String phone;
  final String? relationship;
  final bool isPrimary;
  final DateTime createdAt;

  const EmergencyContact({
    required this.id,
    required this.userId,
    required this.name,
    required this.phone,
    this.relationship,
    required this.isPrimary,
    required this.createdAt,
  });

  EmergencyContact copyWith({
    String? id,
    String? userId,
    String? name,
    String? phone,
    String? relationship,
    bool? isPrimary,
    DateTime? createdAt,
  }) {
    return EmergencyContact(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      name: name ?? this.name,
      phone: phone ?? this.phone,
      relationship: relationship ?? this.relationship,
      isPrimary: isPrimary ?? this.isPrimary,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'user_id': userId,
      'name': name,
      'phone': phone,
      'relationship': relationship,
      'is_primary': isPrimary,
      'created_at': createdAt.toIso8601String(),
    };
  }

  factory EmergencyContact.fromMap(Map<String, dynamic> map) {
    return EmergencyContact(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      name: map['name'] ?? '',
      phone: map['phone'] ?? '',
      relationship: map['relationship'],
      isPrimary: map['is_primary'] ?? false,
      createdAt: DateTime.parse(map['created_at']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        name,
        phone,
        relationship,
        isPrimary,
        createdAt,
      ];
}
