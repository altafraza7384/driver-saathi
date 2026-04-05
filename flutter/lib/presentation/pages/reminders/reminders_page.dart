import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';
import 'package:intl/intl.dart';

import '../../../domain/entities/reminder.dart';
import '../../../presentation/providers/auth_provider.dart';
import '../../../core/utils/date_utils.dart';

class RemindersPage extends StatefulWidget {
  const RemindersPage({super.key});

  @override
  State<RemindersPage> createState() => _RemindersPageState();
}

class _RemindersPageState extends State<RemindersPage> {
  final supabase = Supabase.instance.client;
  final _uuid = const Uuid();
  List<Reminder> _reminders = [];
  bool _isLoading = true;
  String _filter = 'all'; // all, upcoming, completed

  final List<String> _categories = [
    'General',
    'Vehicle',
    'Payment',
    'Health',
    'Personal',
  ];

  @override
  void initState() {
    super.initState();
    _fetchReminders();
  }

  Future<void> _fetchReminders() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    try {
      var query = supabase
          .from('reminders')
          .select()
          .eq('user_id', user.id)
          .order('reminder_date', ascending: true);

      if (_filter == 'completed') {
        query = query.eq('is_completed', true);
      } else if (_filter == 'upcoming') {
        query = query.eq('is_completed', false);
      }

      final response = await query;

      setState(() {
        _reminders = (response as List)
            .map((item) => Reminder.fromMap(item))
            .toList();
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Error fetching reminders: $e');
      setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleComplete(Reminder reminder) async {
    try {
      await supabase.from('reminders').update({
        'is_completed': !reminder.isCompleted,
        'updated_at': DateTime.now().toIso8601String(),
      }).eq('id', reminder.id);

      _fetchReminders();
    } catch (e) {
      debugPrint('Error toggling reminder: $e');
    }
  }

  Future<void> _deleteReminder(String id) async {
    try {
      await supabase.from('reminders').delete().eq('id', id);
      _fetchReminders();
    } catch (e) {
      debugPrint('Error deleting reminder: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reminders'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _buildFilterChip('all', 'All'),
                  const SizedBox(width: 8),
                  _buildFilterChip('upcoming', 'Upcoming'),
                  const SizedBox(width: 8),
                  _buildFilterChip('completed', 'Completed'),
                ],
              ),
            ),
          ),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _reminders.isEmpty
              ? _buildEmptyState()
              : RefreshIndicator(
                  onRefresh: _fetchReminders,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _reminders.length,
                    itemBuilder: (context, index) =>
                        _buildReminderCard(_reminders[index]),
                  ),
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddReminderDialog(),
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.alarm_off_outlined,
            size: 64,
            color: Theme.of(context).colorScheme.onSurface.withOpacity(0.3),
          ),
          const SizedBox(height: 16),
          Text(
            'No reminders yet',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Add a reminder to get started',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurface.withOpacity(0.4),
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String value, String label) {
    final isSelected = _filter == value;

    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (selected) {
        if (selected) {
          setState(() => _filter = value);
          _fetchReminders();
        }
      },
    );
  }

  Widget _buildReminderCard(Reminder reminder) {
    final theme = Theme.of(context);
    final isOverdue = reminder.isOverdue;
    final dateColor = reminder.isCompleted
        ? Colors.grey
        : isOverdue
            ? Colors.red
            : theme.colorScheme.primary;

    return Dismissible(
      key: Key(reminder.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 16),
        decoration: BoxDecoration(
          color: Colors.red,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Icon(Icons.delete, color: Colors.white),
      ),
      onDismissed: (_) => _deleteReminder(reminder.id),
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: ListTile(
          leading: GestureDetector(
            onTap: () => _toggleComplete(reminder),
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: reminder.isCompleted
                    ? Colors.green.withOpacity(0.1)
                    : isOverdue
                        ? Colors.red.withOpacity(0.1)
                        : theme.colorScheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                reminder.isCompleted
                    ? Icons.check_circle
                    : isOverdue
                        ? Icons.warning
                        : Icons.alarm,
                color: reminder.isCompleted
                    ? Colors.green
                    : isOverdue
                        ? Colors.red
                        : theme.colorScheme.primary,
              ),
            ),
          ),
          title: Text(
            reminder.title,
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w500,
              decoration: reminder.isCompleted
                  ? TextDecoration.lineThrough
                  : null,
            ),
          ),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (reminder.description != null &&
                  reminder.description!.isNotEmpty)
                Text(
                  reminder.description!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurface.withOpacity(0.6),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Icon(
                    Icons.calendar_today,
                    size: 12,
                    color: dateColor,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    DateUtils.getRelativeDate(reminder.reminderDate),
                    style: TextStyle(
                      fontSize: 12,
                      color: dateColor,
                      fontWeight: isOverdue ? FontWeight.w600 : null,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceVariant,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      reminder.category,
                      style: TextStyle(
                        fontSize: 10,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          trailing: IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _deleteReminder(reminder.id),
          ),
        ),
      ),
    );
  }

  void _showAddReminderDialog() {
    final titleController = TextEditingController();
    final descriptionController = TextEditingController();
    String selectedCategory = _categories[0];
    DateTime reminderDate = DateTime.now();
    TimeOfDay reminderTime = TimeOfDay.now();

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Add Reminder'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: titleController,
                  decoration: const InputDecoration(
                    labelText: 'Title',
                    hintText: 'What do you need to remember?',
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: descriptionController,
                  decoration: const InputDecoration(
                    labelText: 'Description (Optional)',
                    hintText: 'Add more details',
                  ),
                  maxLines: 2,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: selectedCategory,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: _categories.map((category) {
                    return DropdownMenuItem(
                      value: category,
                      child: Text(category),
                    );
                  }).toList(),
                  onChanged: (value) =>
                      setState(() => selectedCategory = value!),
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Date'),
                  subtitle: Text(DateFormat('dd MMM yyyy').format(reminderDate)),
                  trailing: const Icon(Icons.calendar_today),
                  onTap: () async {
                    final date = await showDatePicker(
                      context: context,
                      initialDate: reminderDate,
                      firstDate: DateTime.now(),
                      lastDate: DateTime(2050),
                    );
                    if (date != null) {
                      setState(() => reminderDate = date);
                    }
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Time'),
                  subtitle: Text(reminderTime.format(context)),
                  trailing: const Icon(Icons.access_time),
                  onTap: () async {
                    final time = await showTimePicker(
                      context: context,
                      initialTime: reminderTime,
                    );
                    if (time != null) {
                      setState(() => reminderTime = time);
                    }
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () async {
                final user = AuthProvider.of(context).user;
                if (user == null) return;

                if (titleController.text.isEmpty) return;

                final notifyAt = DateTime(
                  reminderDate.year,
                  reminderDate.month,
                  reminderDate.day,
                  reminderTime.hour,
                  reminderTime.minute,
                );

                try {
                  await supabase.from('reminders').insert({
                    'id': _uuid.v4(),
                    'user_id': user.id,
                    'title': titleController.text,
                    'description': descriptionController.text.isEmpty
                        ? null
                        : descriptionController.text,
                    'category': selectedCategory.toLowerCase(),
                    'reminder_date': DateFormat('yyyy-MM-dd').format(reminderDate),
                    'notify_at': notifyAt.toIso8601String(),
                    'is_completed': false,
                    'created_at': DateTime.now().toIso8601String(),
                    'updated_at': DateTime.now().toIso8601String(),
                  });

                  if (mounted) {
                    Navigator.pop(context);
                    _fetchReminders();
                  }
                } catch (e) {
                  debugPrint('Error adding reminder: $e');
                }
              },
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
  }
}
