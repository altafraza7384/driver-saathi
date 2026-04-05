import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../domain/entities/transaction.dart';
import '../../../presentation/providers/auth_provider.dart';
import '../../../core/utils/currency_utils.dart';
import '../../../core/utils/date_utils.dart';

class TransactionsPage extends StatefulWidget {
  const TransactionsPage({super.key});

  @override
  State<TransactionsPage> createState() => _TransactionsPageState();
}

class _TransactionsPageState extends State<TransactionsPage> {
  final supabase = Supabase.instance.client;
  List<Transaction> _transactions = [];
  List<Transaction> _weeklyTransactions = [];
  String _filter = 'all';
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    await Future.wait([
      _fetchTransactions(),
      _fetchWeeklyData(),
    ]);
    setState(() => _isLoading = false);
  }

  Future<void> _fetchTransactions() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    try {
      var query = supabase
          .from('transactions')
          .select()
          .eq('user_id', user.id)
          .order('transaction_date', ascending: false)
          .limit(50);

      if (_filter != 'all') {
        query = query.eq('type', _filter);
      }

      final response = await query;

      setState(() {
        _transactions = (response as List)
            .map((item) => Transaction.fromMap(item))
            .toList();
      });
    } catch (e) {
      debugPrint('Error fetching transactions: $e');
    }
  }

  Future<void> _fetchWeeklyData() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    final weekStart = DateUtils.startOfWeek(DateTime.now(), weekStartsOn: 1);
    final weekEnd = DateUtils.endOfWeek(DateTime.now(), weekStartsOn: 1);

    try {
      final response = await supabase
          .from('transactions')
          .select()
          .eq('user_id', user.id)
          .gte('transaction_date', DateUtils.formatISODate(weekStart))
          .lte('transaction_date', DateUtils.formatISODate(weekEnd));

      setState(() {
        _weeklyTransactions = (response as List)
            .map((item) => Transaction.fromMap(item))
            .toList();
      });
    } catch (e) {
      debugPrint('Error fetching weekly data: $e');
    }
  }

  Future<void> _deleteTransaction(String id) async {
    try {
      await supabase.from('transactions').delete().eq('id', id);
      _loadData();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Transaction deleted')),
        );
      }
    } catch (e) {
      debugPrint('Error deleting transaction: $e');
    }
  }

  double get _totalIncome => _transactions
      .where((t) => t.isIncome)
      .fold(0, (sum, t) => sum + t.amount);

  double get _totalExpense => _transactions
      .where((t) => t.isExpense)
      .fold(0, (sum, t) => sum + t.amount);

  double get _weekIncome => _weeklyTransactions
      .where((t) => t.isIncome)
      .fold(0, (sum, t) => sum + t.amount);

  double get _weekExpense => _weeklyTransactions
      .where((t) => t.isExpense)
      .fold(0, (sum, t) => sum + t.amount);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Transactions'),
        actions: [
          TextButton.icon(
            onPressed: () => Navigator.pushNamed(context, '/transactions/add',
                arguments: {'type': 'income'}),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Income'),
            style: TextButton.styleFrom(
              foregroundColor: Colors.green,
            ),
          ),
          TextButton.icon(
            onPressed: () => Navigator.pushNamed(context, '/transactions/add',
                arguments: {'type': 'expense'}),
            icon: const Icon(Icons.remove, size: 18),
            label: const Text('Expense'),
            style: TextButton.styleFrom(
              foregroundColor: Colors.red,
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadData,
              child: CustomScrollView(
                slivers: [
                  // Summary Cards
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: _buildSummaryCard(
                              'Total Income',
                              _totalIncome,
                              Colors.green,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _buildSummaryCard(
                              'Total Expenses',
                              _totalExpense,
                              Colors.red,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  // Weekly Stats
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'This Week',
                                style: theme.textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 16),
                              Row(
                                children: [
                                  _buildWeekStat(
                                    'Income',
                                    _weekIncome,
                                    Colors.green,
                                    Icons.trending_up,
                                  ),
                                  _buildWeekStat(
                                    'Expense',
                                    _weekExpense,
                                    Colors.red,
                                    Icons.trending_down,
                                  ),
                                  _buildWeekStat(
                                    'Net',
                                    _weekIncome - _weekExpense,
                                    _weekIncome - _weekExpense >= 0
                                        ? Colors.green
                                        : Colors.red,
                                    Icons.account_balance_wallet,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              _buildWeekChart(),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),

                  const SliverToBoxAdapter(child: SizedBox(height: 16)),

                  // Filter Chips
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Row(
                        children: [
                          _buildFilterChip('all', 'All'),
                          const SizedBox(width: 8),
                          _buildFilterChip('income', 'Income'),
                          const SizedBox(width: 8),
                          _buildFilterChip('expense', 'Expense'),
                        ],
                      ),
                    ),
                  ),

                  const SliverToBoxAdapter(child: SizedBox(height: 16)),

                  // Transactions List
                  if (_transactions.isEmpty)
                    SliverToBoxAdapter(
                      child: Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16),
                        child: Padding(
                          padding: const EdgeInsets.all(32),
                          child: Center(
                            child: Text(
                              'No transactions yet',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.onSurface
                                    .withOpacity(0.6),
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
                            final tx = _transactions[index];
                            return _buildTransactionItem(tx);
                          },
                          childCount: _transactions.length,
                        ),
                      ),
                    ),

                  const SliverToBoxAdapter(child: SizedBox(height: 32)),
                ],
              ),
            ),
    );
  }

  Widget _buildSummaryCard(String label, double amount, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            CurrencyUtils.formatINR(amount),
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeekStat(String label, double amount, Color color, IconData icon) {
    return Expanded(
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
            ),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 4),
              Text(
                CurrencyUtils.formatINRCompact(amount),
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildWeekChart() {
    final weekStart = DateUtils.startOfWeek(DateTime.now(), weekStartsOn: 1);
    final days = List.generate(7, (i) => weekStart.add(Duration(days: i)));
    
    final maxDayAmount = days.map((day) {
      return _weeklyTransactions
          .where((t) => DateUtils.isSameDay(t.transactionDate, day))
          .fold(0.0, (sum, t) => sum + t.amount);
    }).fold(0.0, (max, sum) => sum > max ? sum : max);

    final chartMax = maxDayAmount > 0 ? maxDayAmount : 1;

    return SizedBox(
      height: 80,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: days.map((day) {
          final dayIncome = _weeklyTransactions
              .where((t) =>
                  t.isIncome && DateUtils.isSameDay(t.transactionDate, day))
              .fold(0.0, (sum, t) => sum + t.amount);
          final dayExpense = _weeklyTransactions
              .where((t) =>
                  t.isExpense && DateUtils.isSameDay(t.transactionDate, day))
              .fold(0.0, (sum, t) => sum + t.amount);

          final incomeHeight = (dayIncome / chartMax * 40).clamp(4.0, 40.0);
          final expenseHeight = (dayExpense / chartMax * 40).clamp(4.0, 40.0);
          final isToday = DateUtils.isSameDay(day, DateTime.now());

          return Column(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Container(
                    width: 6,
                    height: incomeHeight,
                    decoration: BoxDecoration(
                      color: Colors.green.withOpacity(0.7),
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(width: 2),
                  Container(
                    width: 6,
                    height: expenseHeight,
                    decoration: BoxDecoration(
                      color: Colors.red.withOpacity(0.7),
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(2),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                DateUtils.formatDay(day)[0],
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: isToday ? FontWeight.bold : FontWeight.normal,
                  color: isToday
                      ? Theme.of(context).colorScheme.primary
                      : Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withOpacity(0.5),
                ),
              ),
            ],
          );
        }).toList(),
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
          setState(() {
            _filter = value;
          });
          _fetchTransactions();
        }
      },
    );
  }

  Widget _buildTransactionItem(Transaction tx) {
    final theme = Theme.of(context);
    final isIncome = tx.isIncome;
    final color = isIncome ? Colors.green : Colors.red;
    final icon = isIncome ? Icons.add : Icons.remove;

    return Dismissible(
      key: Key(tx.id),
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
      onDismissed: (_) => _deleteTransaction(tx.id),
      child: Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          leading: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          title: Text(
            '${tx.category}${tx.platform != null ? ' • ${tx.platform}' : ''}',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w500,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
            '${DateUtils.formatDate(tx.transactionDate)}${tx.description != null ? ' • ${tx.description}' : ''}',
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
              color: color,
            ),
          ),
        ),
      ),
    );
  }
}
