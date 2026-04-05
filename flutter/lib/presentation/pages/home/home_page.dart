import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../domain/entities/profile.dart';
import '../../../domain/entities/transaction.dart';
import '../../../domain/entities/debt.dart';
import '../../../domain/entities/goal.dart';
import '../../../presentation/providers/auth_provider.dart';
import '../../../core/utils/currency_utils.dart';
import '../../../core/utils/date_utils.dart';
import '../../widgets/gradient_card.dart';
import '../../widgets/quick_action_button.dart';
import '../../widgets/progress_card.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final supabase = Supabase.instance.client;
  Profile? _profile;
  List<Transaction> _todayTransactions = [];
  List<Debt> _debts = [];
  List<Goal> _goals = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    await Future.wait([
      _fetchProfile(),
      _fetchTodayTransactions(),
      _fetchDebts(),
      _fetchGoals(),
    ]);
    setState(() => _isLoading = false);
  }

  Future<void> _fetchProfile() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    try {
      final response = await supabase
          .from('profiles')
          .select()
          .eq('user_id', user.id)
          .single();

      setState(() {
        _profile = Profile.fromMap(response);
      });
    } catch (e) {
      debugPrint('Error fetching profile: $e');
    }
  }

  Future<void> _fetchTodayTransactions() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    final today = DateUtils.formatISODate(DateTime.now());

    try {
      final response = await supabase
          .from('transactions')
          .select()
          .eq('user_id', user.id)
          .eq('transaction_date', today)
          .order('created_at', ascending: false);

      setState(() {
        _todayTransactions = (response as List)
            .map((item) => Transaction.fromMap(item))
            .toList();
      });
    } catch (e) {
      debugPrint('Error fetching transactions: $e');
    }
  }

  Future<void> _fetchDebts() async {
    try {
      final response = await supabase
          .from('debts')
          .select()
          .eq('is_active', true)
          .order('created_at', ascending: false);

      setState(() {
        _debts = (response as List)
            .map((item) => Debt.fromMap(item))
            .toList();
      });
    } catch (e) {
      debugPrint('Error fetching debts: $e');
    }
  }

  Future<void> _fetchGoals() async {
    try {
      final response = await supabase
          .from('goals')
          .select()
          .eq('is_completed', false)
          .order('created_at', ascending: false);

      setState(() {
        _goals = (response as List)
            .map((item) => Goal.fromMap(item))
            .toList();
      });
    } catch (e) {
      debugPrint('Error fetching goals: $e');
    }
  }

  double get _todayIncome => _todayTransactions
      .where((t) => t.isIncome)
      .fold(0, (sum, t) => sum + t.amount);

  double get _todayExpense => _todayTransactions
      .where((t) => t.isExpense)
      .fold(0, (sum, t) => sum + t.amount);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (_isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _loadData,
          child: CustomScrollView(
            slivers: [
              // Header
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${DateUtils.getGreeting()} 👋',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface.withOpacity(0.6),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _profile?.fullName ?? 'Driver',
                            style: theme.textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                      IconButton(
                        onPressed: () {
                          Navigator.pushNamed(context, '/settings');
                        },
                        icon: const Icon(Icons.settings_outlined),
                      ),
                    ],
                  ),
                ),
              ),

              // Today's Earnings Card
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: GradientCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Today\'s Earnings',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onPrimary.withOpacity(0.9),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          CurrencyUtils.formatINR(
                              _todayIncome - _todayExpense),
                          style: theme.textTheme.headlineLarge?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: theme.colorScheme.onPrimary,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            _buildIncomeExpenseChip(
                              'Income',
                              _todayIncome,
                              theme.colorScheme.onPrimary,
                            ),
                            const SizedBox(width: 16),
                            _buildIncomeExpenseChip(
                              'Expense',
                              _todayExpense,
                              theme.colorScheme.onPrimary.withOpacity(0.8),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              const SliverToBoxAdapter(child: SizedBox(height: 24)),

              // Quick Actions
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Quick Actions',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          QuickActionButton(
                            icon: Icons.add,
                            label: 'Add\nTransaction',
                            color: theme.colorScheme.primary,
                            onTap: () => Navigator.pushNamed(
                                context, '/transactions/add'),
                          ),
                          QuickActionButton(
                            icon: Icons.car_repair,
                            label: 'Car\nCheck',
                            color: Colors.orange,
                            onTap: () =>
                                Navigator.pushNamed(context, '/car-checks'),
                          ),
                          QuickActionButton(
                            icon: Icons.note_alt_outlined,
                            label: 'Notes',
                            color: Colors.green,
                            onTap: () =>
                                Navigator.pushNamed(context, '/notes'),
                          ),
                          QuickActionButton(
                            icon: Icons.health_and_safety_outlined,
                            label: 'Health',
                            color: Colors.red,
                            onTap: () =>
                                Navigator.pushNamed(context, '/health'),
                          ),
                          QuickActionButton(
                            icon: Icons.emergency_outlined,
                            label: 'SOS',
                            color: theme.colorScheme.primary,
                            onTap: () =>
                                Navigator.pushNamed(context, '/sos'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              const SliverToBoxAdapter(child: SizedBox(height: 24)),

              // Debt Progress
              if (_debts.isNotEmpty) ...[
                SliverToBoxAdapter(
                  child: _buildSectionHeader('Debt Progress', '/debts'),
                ),
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) {
                        final debt = _debts[index];
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: ProgressCard(
                            icon: Icons.credit_card,
                            title: debt.name,
                            progress: debt.progressPercent,
                            leftLabel: 'Paid: ${CurrencyUtils.formatINRCompact(debt.totalPaid)}',
                            rightLabel: 'Remaining: ${CurrencyUtils.formatINRCompact(debt.remainingAmount)}',
                          ),
                        );
                      },
                      childCount: _debts.take(3).length,
                    ),
                  ),
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 24)),
              ],

              // Goals Progress
              if (_goals.isNotEmpty) ...[
                SliverToBoxAdapter(
                  child: _buildSectionHeader('Savings Goals', '/goals'),
                ),
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) {
                        final goal = _goals[index];
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: ProgressCard(
                            icon: Icons.track_changes,
                            title: goal.title,
                            progress: goal.progressPercent,
                            leftLabel:
                                'Saved: ${CurrencyUtils.formatINRCompact(goal.savedAmount)}',
                            rightLabel:
                                'Target: ${CurrencyUtils.formatINRCompact(goal.targetAmount)}',
                          ),
                        );
                      },
                      childCount: _goals.take(3).length,
                    ),
                  ),
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 24)),
              ],

              // Recent Transactions
              SliverToBoxAdapter(
                child: _buildSectionHeader('Recent Transactions', '/transactions'),
              ),

              if (_todayTransactions.isEmpty)
                SliverToBoxAdapter(
                  child: Card(
                    margin: const EdgeInsets.symmetric(horizontal: 16),
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Center(
                        child: Text(
                          'No transactions today',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurface.withOpacity(0.6),
                          ),
                        ),
                      ),
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) {
                        final tx = _todayTransactions[index];
                        return _buildTransactionItem(tx, theme);
                      },
                      childCount: _todayTransactions.length,
                    ),
                  ),
                ),

              const SliverToBoxAdapter(child: SizedBox(height: 32)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildIncomeExpenseChip(String label, double amount, Color color) {
    return Row(
      children: [
        Text(
          '$label: ',
          style: TextStyle(
            fontSize: 12,
            color: color.withOpacity(0.8),
          ),
        ),
        Text(
          CurrencyUtils.formatINR(amount, showSymbol: false),
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
      ],
    );
  }

  Widget _buildSectionHeader(String title, String route) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          TextButton(
            onPressed: () => Navigator.pushNamed(context, route),
            child: const Row(
              children: [
                Text('View All'),
                SizedBox(width: 4),
                Icon(Icons.chevron_right, size: 16),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionItem(Transaction tx, ThemeData theme) {
    final isIncome = tx.isIncome;
    final amountColor = isIncome ? Colors.green : Colors.red;
    final icon = isIncome ? Icons.add : Icons.remove;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: amountColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: amountColor, size: 20),
        ),
        title: Text(
          '${tx.category}${tx.platform != null ? ' • ${tx.platform}' : ''}',
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          tx.description ?? tx.category,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurface.withOpacity(0.6),
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Text(
          '${isIncome ? '+' : '-'}${CurrencyUtils.formatINR(tx.amount)}',
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.bold,
            color: amountColor,
          ),
        ),
      ),
    );
  }
}
