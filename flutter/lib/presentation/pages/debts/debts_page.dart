import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../../domain/entities/debt.dart';
import '../../../presentation/providers/auth_provider.dart';
import '../../../core/utils/currency_utils.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class DebtsPage extends StatefulWidget {
  const DebtsPage({super.key});

  @override
  State<DebtsPage> createState() => _DebtsPageState();
}

class _DebtsPageState extends State<DebtsPage> {
  final supabase = Supabase.instance.client;
  final _uuid = const Uuid();
  List<Debt> _debts = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchDebts();
  }

  Future<void> _fetchDebts() async {
    try {
      final response = await supabase
          .from('debts')
          .select()
          .order('created_at', ascending: false);

      setState(() {
        _debts = (response as List)
            .map((item) => Debt.fromMap(item))
            .toList();
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Error fetching debts: $e');
      setState(() => _isLoading = false);
    }
  }

  Future<void> _deleteDebt(String id) async {
    try {
      await supabase.from('debts').delete().eq('id', id);
      _fetchDebts();
    } catch (e) {
      debugPrint('Error deleting debt: $e');
    }
  }

  double get _totalLiability => _debts.fold(
      0, (sum, d) => sum + (d.principal - d.totalPaid));

  double get _totalEMI => _debts
      .where((d) => d.isActive)
      .fold(0, (sum, d) => sum + (d.emiAmount ?? 0));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Debts & EMI'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => _showAddDebtDialog(),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _fetchDebts,
              child: CustomScrollView(
                slivers: [
                  // Summary
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: _buildSummaryCard(
                              'Total Outstanding',
                              _totalLiability,
                              Colors.red,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _buildSummaryCard(
                              'Monthly EMI',
                              _totalEMI,
                              Colors.orange,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  // Debt List
                  if (_debts.isEmpty)
                    SliverToBoxAdapter(
                      child: Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16),
                        child: Padding(
                          padding: const EdgeInsets.all(32),
                          child: Center(
                            child: Text(
                              'No loans added yet',
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
                          (context, index) => _buildDebtCard(_debts[index]),
                          childCount: _debts.length,
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

  Widget _buildDebtCard(Debt debt) {
    final theme = Theme.of(context);
    final progress = debt.progressPercent;
    final remaining = debt.remainingAmount;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.credit_card, color: theme.colorScheme.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        debt.name,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        '${debt.interestRate}% • ${debt.tenureMonths} months',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurface.withOpacity(0.6),
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _deleteDebt(debt.id),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Paid: ${CurrencyUtils.formatINRCompact(debt.totalPaid)}',
                  style: theme.textTheme.bodySmall,
                ),
                Text(
                  'Remaining: ${CurrencyUtils.formatINRCompact(remaining)}',
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
            const SizedBox(height: 8),
            if (debt.emiAmount != null)
              Text(
                'EMI: ${CurrencyUtils.formatINR(debt.emiAmount!)}/month',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withOpacity(0.6),
                ),
              ),
            if (debt.isActive)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: () => _showPayEMIDialog(debt),
                  child: const Text('Record Payment'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _showAddDebtDialog() {
    final nameController = TextEditingController();
    final principalController = TextEditingController();
    final rateController = TextEditingController(text: '0');
    final tenureController = TextEditingController(text: '12');
    final customEmiController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add New Loan'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CustomTextField(
                controller: nameController,
                label: 'Loan Name',
                hint: 'e.g. Car Loan',
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: principalController,
                label: 'Principal Amount (₹)',
                hint: '500000',
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      controller: rateController,
                      label: 'Interest Rate (%)',
                      hint: '10',
                      keyboardType: TextInputType.number,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: CustomTextField(
                      controller: tenureController,
                      label: 'Tenure (months)',
                      hint: '36',
                      keyboardType: TextInputType.number,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: customEmiController,
                label: 'Custom EMI (optional)',
                hint: 'Leave blank to auto-calculate',
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

              final principal = double.tryParse(principalController.text) ?? 0;
              final rate = double.tryParse(rateController.text) ?? 0;
              final tenure = int.tryParse(tenureController.text) ?? 12;
              final customEmi = double.tryParse(customEmiController.text);

              if (nameController.text.isEmpty || principal <= 0) return;

              final debt = Debt(
                id: _uuid.v4(),
                userId: user.id,
                name: nameController.text,
                principal: principal,
                interestRate: rate,
                tenureMonths: tenure,
                emiAmount: customEmi,
                totalPaid: 0,
                startDate: DateTime.now(),
                isActive: true,
                createdAt: DateTime.now(),
                updatedAt: DateTime.now(),
              );

              try {
                await supabase.from('debts').insert(debt.toMap());
                if (mounted) {
                  Navigator.pop(context);
                  _fetchDebts();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Loan added successfully')),
                  );
                }
              } catch (e) {
                debugPrint('Error adding debt: $e');
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  void _showPayEMIDialog(Debt debt) {
    final amountController = TextEditingController(
      text: debt.emiAmount?.toStringAsFixed(0) ?? '',
    );

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Record Payment'),
        content: CustomTextField(
          controller: amountController,
          label: 'Payment Amount (₹)',
          keyboardType: TextInputType.number,
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

              final amount = double.tryParse(amountController.text) ?? 0;
              if (amount <= 0) return;

              final newTotalPaid = debt.totalPaid + amount;
              final isFullyPaid = newTotalPaid >= debt.principal;

              try {
                // Record payment
                await supabase.from('debt_payments').insert({
                  'id': _uuid.v4(),
                  'user_id': user.id,
                  'debt_id': debt.id,
                  'amount': amount,
                  'payment_date': DateTime.now().toIso8601String(),
                  'created_at': DateTime.now().toIso8601String(),
                });

                // Update debt
                await supabase.from('debts').update({
                  'total_paid': newTotalPaid,
                  'is_active': !isFullyPaid,
                  'updated_at': DateTime.now().toIso8601String(),
                }).eq('id', debt.id);

                if (mounted) {
                  Navigator.pop(context);
                  _fetchDebts();
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(isFullyPaid
                          ? '🎉 Loan fully paid!'
                          : 'Payment recorded successfully'),
                    ),
                  );
                }
              } catch (e) {
                debugPrint('Error recording payment: $e');
              }
            },
            child: const Text('Pay'),
          ),
        ],
      ),
    );
  }
}
