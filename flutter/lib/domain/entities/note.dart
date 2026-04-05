import 'package:equatable/equatable.dart';

class Note extends Equatable {
  final String id;
  final String userId;
  final String title;
  final String content;
  final bool isVoiceNote;
  final String? audioUrl;
  final List<String>? tags;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Note({
    required this.id,
    required this.userId,
    required this.title,
    required this.content,
    required this.isVoiceNote,
    this.audioUrl,
    this.tags,
    required this.createdAt,
    required this.updatedAt,
  });

  Note copyWith({
    String? id,
    String? userId,
    String? title,
    String? content,
    bool? isVoiceNote,
    String? audioUrl,
    List<String>? tags,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Note(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      title: title ?? this.title,
      content: content ?? this.content,
      isVoiceNote: isVoiceNote ?? this.isVoiceNote,
      audioUrl: audioUrl ?? this.audioUrl,
      tags: tags ?? this.tags,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'user_id': userId,
      'title': title,
      'content': content,
      'is_voice_note': isVoiceNote,
      'audio_url': audioUrl,
      'tags': tags,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory Note.fromMap(Map<String, dynamic> map) {
    return Note(
      id: map['id'] ?? '',
      userId: map['user_id'] ?? '',
      title: map['title'] ?? '',
      content: map['content'] ?? '',
      isVoiceNote: map['is_voice_note'] ?? false,
      audioUrl: map['audio_url'],
      tags: map['tags'] != null ? List<String>.from(map['tags']) : null,
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: DateTime.parse(map['updated_at']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        title,
        content,
        isVoiceNote,
        audioUrl,
        tags,
        createdAt,
        updatedAt,
      ];
}
