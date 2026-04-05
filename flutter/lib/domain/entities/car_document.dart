import 'package:equatable/equatable.dart';

class CarDocument extends Equatable {
  final String id;
  final String userId;
  final String documentName;
  final DateTime expiryDate;
  final DateTime? notifyAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  const CarDocument({
    required this.id,
    required this.userId,
    required this.documentName,
    required this.expiryDate,
    this.notifyAt,
    required this.createdAt,
    required this.updatedAt,
  });

  int get daysUntilExpiry => expiryDate.difference(DateTime.now()).inDays;
  bool get isExpired => daysUntilExpiry < 0;
  bool get isExpiringSoon => daysUntilExpiry >= 0 && daysUntilExpiry <= 30;

  String get expiryStatus {
    if (isExpired) return 'Expired';
    if (isExpiringSoon) return '$daysUntilExpiry days left';
    return '$daysUntilExpiry days left';
  }

  CarDocument copyWith({
    String? id,
    String? userId,
    String? documentName,
    DateTime? expiryDate,
    DateTime? notifyAt,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return CarDocument(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      documentName: documentName ?? this.documentName,
      expiryDate: expiryDate ?? this.expiryDate,
      notifyAt: notifyAt ?? this.notifyAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'user_id': userId,
      'document_name': documentName,
      'expiry_date': expiryDate.toIso8601String().split('T')[0],
      'notify_at': notifyAt?.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory CarDocument.fromMap(Map<String, dynamic> map) {
    return CarDocument(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      documentName: map['document_name'] ?? '',
      expiryDate: DateTime.parse(map['expiry_date']),
      notifyAt: map['notify_at'] != null
          ? DateTime.parse(map['notify_at'])
          : null,
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: DateTime.parse(map['updated_at']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        documentName,
        expiryDate,
        notifyAt,
        createdAt,
        updatedAt,
      ];
}
