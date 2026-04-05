import 'package:equatable/equatable.dart';

class Profile extends Equatable {
  final String id;
  final String userId;
  final String? fullName;
  final String? phone;
  final String? avatarUrl;
  final String? vehicleNumber;
  final String? vehicleType;
  final String? licenseNumber;
  final String? preferredLanguage;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Profile({
    required this.id,
    required this.userId,
    this.fullName,
    this.phone,
    this.avatarUrl,
    this.vehicleNumber,
    this.vehicleType,
    this.licenseNumber,
    this.preferredLanguage,
    required this.createdAt,
    required this.updatedAt,
  });

  Profile copyWith({
    String? id,
    String? userId,
    String? fullName,
    String? phone,
    String? avatarUrl,
    String? vehicleNumber,
    String? vehicleType,
    String? licenseNumber,
    String? preferredLanguage,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Profile(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      fullName: fullName ?? this.fullName,
      phone: phone ?? this.phone,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      vehicleNumber: vehicleNumber ?? this.vehicleNumber,
      vehicleType: vehicleType ?? this.vehicleType,
      licenseNumber: licenseNumber ?? this.licenseNumber,
      preferredLanguage: preferredLanguage ?? this.preferredLanguage,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'user_id': userId,
      'full_name': fullName,
      'phone': phone,
      'avatar_url': avatarUrl,
      'vehicle_number': vehicleNumber,
      'vehicle_type': vehicleType,
      'license_number': licenseNumber,
      'preferred_language': preferredLanguage,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory Profile.fromMap(Map<String, dynamic> map) {
    return Profile(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      fullName: map['full_name'],
      phone: map['phone'],
      avatarUrl: map['avatar_url'],
      vehicleNumber: map['vehicle_number'],
      vehicleType: map['vehicle_type'],
      licenseNumber: map['license_number'],
      preferredLanguage: map['preferred_language'],
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: DateTime.parse(map['updated_at']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        fullName,
        phone,
        avatarUrl,
        vehicleNumber,
        vehicleType,
        licenseNumber,
        preferredLanguage,
        createdAt,
        updatedAt,
      ];
}
