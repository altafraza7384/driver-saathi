import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../../domain/entities/goal.dart';
import '../../../presentation/providers/auth_provider.dart';
import '../../../core/utils/currency_utils.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class GoalsPage extends StatefulWidget {
  const GoalsPage({super.key});

  @override
  State<GoalsPage> createState() => _GoalsPageState();
}

class _GoalsPageState extends State<GoalsPage> {
  final supabase = Supabase.instance.client;
  final _uuid = const Uuid();
  List<Goal> _goals = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchGoals();
  }

  Future<void> _fetchGoals() async {
    try {
      final response = await supabase
          .from('goals')
          .select()
          .order('created_at', ascending: false);

      setState(() {
        _goals = (response as List)
            .map((item) => Goal.fromMap(item))
            .toList();
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Error fetching goals: $e');
      setState(() => _isLoading = false);
    }
  }

  Future<void> _deleteGoal(String id) async {
    try {
      await supabase.from('goals').delete().eq('id', id);
      _fetchGoals();
    } catch (e) {
      debugPrint('Error deleting goal: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Savings Goals'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => _showAddGoalDialog(),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _fetchGoals,
              child: _goals.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.savings_outlined,
                            size: 64,
                            color: theme.colorScheme.onSurface.withOpacity(0.3),
                          ),
                          const SizedBox(height: 16),
                          Text(
                            'No goals yet. Start saving!',
                            style: theme.textTheme.bodyLarge?.copyWith(
                              color: theme.colorScheme.onSurface.withOpacity(0.6),
                            ),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _goals.length,
                      itemBuilder: (context, index) => _buildGoalCard(_goals[index]),
                    ),
            ),
    );
  }

  Widget _buildGoalCard(Goal goal) {
    final theme = Theme.of(context);
    final progress = goal.progressPercent;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  goal.isCompleted ? Icons.celebration : Icons.track_changes,
                  color: goal.isCompleted ? Colors.green : theme.colorScheme.primary,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        goal.title,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (goal.deadline != null)
                        Text(
                          'By ${goal.deadline!.day}/${goal.deadline!.month}/${goal.deadline!.year}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface.withOpacity(0.6),
                          ),
                        ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _deleteGoal(goal.id),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Saved: ${CurrencyUtils.formatINRCompact(goal.savedAmount)}',
                  style: theme.textTheme.bodySmall,
                ),
                Text(
                  'Target: ${CurrencyUtils.formatINRCompact(goal.targetAmount)}',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: progress / 100,
                minHeight: 8,
                backgroundColor: theme.colorScheme.surfaceVariant.withOpacity(0.3),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${progress.toStringAsFixed(0)}% complete',
              style: theme.textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w500,
              ),
              textAlign: TextAlign.center,
            ),
            if (!goal.isCompleted)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: () => _showAddSavingsDialog(goal),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.add, size: 18),
                      SizedBox(width: 4),
                      Text('Add Savings'),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _showAddGoalDialog() {
    final titleController = TextEditingController();
    final targetController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create Savings Goal'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CustomTextField(
                controller: titleController,
                label: 'Goal Title',
                hint: 'e.g. New Tires',
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: targetController,
                label: 'Target Amount (₹)',
                hint: '50000',
                keyboardType: TextInputType.number,
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

              final target = double.tryParse(targetController.text) ?? 0;

              if (titleController.text.isEmpty || target <= 0) return;

              final goal = Goal(
                id: _uuid.v4(),
                userId: user.id,
                title: titleController.text,
                targetAmount: target,
                savedAmount: 0,
                isCompleted: false,
                createdAt: DateTime.now(),
                updatedAt: DateTime.now(),
              );

              try {
                await supabase.from('goals').insert(goal.toMap());
                if (mounted) {
                  Navigator.pop(context);
                  _fetchGoals();
                }
              } catch (e) {
                debugPrint('Error adding goal: $e');
              }
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }

  void _showAddSavingsDialog(Goal goal) {
    final amountController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add Savings'),
        content: CustomTextField(
          controller: amountController,
          label: 'Amount (₹)',
          keyboardType: TextInputType.number,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              final amount = double.tryParse(amountController.text) ?? 0;
              if (amount <= 0) return;

              final newSaved = goal.savedAmount + amount;
              final isCompleted = newSaved >= goal.targetAmount;

              try {
                await supabase.from('goals').update({
                  'saved_amount': newSaved,
                  'is_completed': isCompleted,
                  'updated_at': DateTime.now().toIso8601String(),
                }).eq('id', goal.id);

                if (mounted) {
                  Navigator.pop(context);
                  _fetchGoals();
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(isCompleted
                          ? '🎉 Goal Completed! You\'ve reached your target for "${goal.title}"!'
                          : '₹$amount added to savings!'),
                    ),
                  );
                }
              } catch (e) {
                debugPrint('Error adding savings: $e');
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
}
