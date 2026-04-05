import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';
import 'package:intl/intl.dart';

import '../../../presentation/providers/auth_provider.dart';
import '../../../core/constants/app_constants.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class AddTransactionPage extends StatefulWidget {
  final String? initialType;

  const AddTransactionPage({super.key, this.initialType});

  @override
  State<AddTransactionPage> createState() => _AddTransactionPageState();
}

class _AddTransactionPageState extends State<AddTransactionPage> {
  final supabase = Supabase.instance.client;
  final _uuid = const Uuid();

  String _type = 'income';
  final _amountController = TextEditingController();
  String _category = '';
  final _descriptionController = TextEditingController();
  final _platformController = TextEditingController();
  DateTime _transactionDate = DateTime.now();

  bool _isLoading = false;

  final List<String> _platforms = [
    'Uber',
    'Ola',
    'Rapido',
    'Namma Yatri',
    'Other',
  ];

  @override
  void initState() {
    super.initState();
    if (widget.initialType != null) {
      _type = widget.initialType!;
    }
    _category = AppConstants.incomeCategories[0];
  }

  List<String> get _categories =>
      _type == 'income'
          ? AppConstants.incomeCategories
          : AppConstants.expenseCategories;

  Future<void> _saveTransaction() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    final amount = double.tryParse(_amountController.text);
    if (amount == null || amount <= 0) {
      _showError('Please enter a valid amount');
      return;
    }

    setState(() => _isLoading = true);

    try {
      await supabase.from('transactions').insert({
        'id': _uuid.v4(),
        'user_id': user.id,
        'type': _type,
        'amount': amount,
        'category': _category,
        'description': _descriptionController.text.isEmpty
            ? null
            : _descriptionController.text,
        'platform': _platformController.text.isEmpty
            ? null
            : _platformController.text,
        'transaction_date': DateFormat('yyyy-MM-dd').format(_transactionDate),
        'created_at': DateTime.now().toIso8601String(),
        'updated_at': DateTime.now().toIso8601String(),
      });

      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Transaction saved successfully')),
        );
      }
    } catch (e) {
      _showError('Failed to save transaction');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_type == 'income' ? 'Add Income' : 'Add Expense'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Type Toggle
            Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceVariant.withOpacity(0.3),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _buildTypeButton('income', 'Income', Colors.green),
                  ),
                  Expanded(
                    child: _buildTypeButton('expense', 'Expense', Colors.red),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            // Amount
            CustomTextField(
              controller: _amountController,
              label: 'Amount (₹)',
              hint: 'Enter amount',
              keyboardType: TextInputType.number,
              prefixIcon: Icons.currency_rupee,
            ),

            const SizedBox(height: 16),

            // Category
            DropdownButtonFormField<String>(
              value: _category.isEmpty ? _categories[0] : _category,
              decoration: const InputDecoration(
                labelText: 'Category',
                prefixIcon: Icon(Icons.category_outlined),
              ),
              items: _categories.map((category) {
                return DropdownMenuItem(
                  value: category,
                  child: Text(category),
                );
              }).toList(),
              onChanged: (value) {
                setState(() => _category = value!);
              },
            ),

            const SizedBox(height: 16),

            // Platform (for income)
            if (_type == 'income') ...[
              DropdownButtonFormField<String>(
                value: _platformController.text.isEmpty
                    ? null
                    : _platformController.text,
                decoration: const InputDecoration(
                  labelText: 'Platform (Optional)',
                  prefixIcon: Icon(Icons.business_outlined),
                ),
                hint: const Text('Select platform'),
                items: [
                  const DropdownMenuItem(
                    value: '',
                    child: Text('None'),
                  ),
                  ..._platforms.map((platform) {
                    return DropdownMenuItem(
                      value: platform,
                      child: Text(platform),
                    );
                  }),
                ],
                onChanged: (value) {
                  setState(() => _platformController.text = value ?? '');
                },
              ),
              const SizedBox(height: 16),
            ],

            // Description
            CustomTextField(
              controller: _descriptionController,
              label: 'Description (Optional)',
              hint: 'Add a note',
              prefixIcon: Icons.notes_outlined,
              maxLines: 3,
            ),

            const SizedBox(height: 16),

            // Date
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.calendar_today),
              title: const Text('Date'),
              subtitle: Text(DateFormat('dd MMM yyyy').format(_transactionDate)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                final date = await showDatePicker(
                  context: context,
                  initialDate: _transactionDate,
                  firstDate: DateTime(2020),
                  lastDate: DateTime.now(),
                );
                if (date != null) {
                  setState(() => _transactionDate = date);
                }
              },
            ),

            const SizedBox(height: 32),

            // Save Button
            CustomButton(
              onPressed: _isLoading ? null : _saveTransaction,
              isLoading: _isLoading,
              text: 'Save Transaction',
              backgroundColor: _type == 'income' ? Colors.green : Colors.red,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTypeButton(String type, String label, Color color) {
    final isSelected = _type == type;

    return GestureDetector(
      onTap: () {
        setState(() {
          _type = type;
          _category = _categories[0];
        });
      },
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: isSelected ? color : null,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              type == 'income' ? Icons.add : Icons.remove,
              size: 18,
              color: isSelected ? Colors.white : color,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: isSelected ? Colors.white : color,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    _platformController.dispose();
    super.dispose();
  }
}
