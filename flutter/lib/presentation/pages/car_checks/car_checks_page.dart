import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';
import 'package:intl/intl.dart';

import '../../../domain/entities/car_check.dart';
import '../../../domain/entities/car_document.dart';
import '../../../presentation/providers/auth_provider.dart';
import '../../../core/utils/currency_utils.dart';
import '../../../core/utils/date_utils.dart';

class CarChecksPage extends StatefulWidget {
  const CarChecksPage({super.key});

  @override
  State<CarChecksPage> createState() => _CarChecksPageState();
}

class _CarChecksPageState extends State<CarChecksPage> {
  final supabase = Supabase.instance.client;
  final _uuid = const Uuid();
  int _currentTab = 0;

  List<CarCheck> _checks = [];
  List<CarDocument> _documents = [];
  bool _isLoading = true;

  final List<String> _checkTypes = [
    'Oil Change',
    'Tire Rotation',
    'Brake Check',
    'Battery',
    'Air Filter',
    'Coolant',
    'PUC',
    'Insurance',
    'Fitness Certificate',
    'General Service',
  ];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    await Future.wait([
      _fetchChecks(),
      _fetchDocuments(),
    ]);
    setState(() => _isLoading = false);
  }

  Future<void> _fetchChecks() async {
    try {
      final response = await supabase
          .from('car_checks')
          .select()
          .order('check_date', ascending: false);

      setState(() {
        _checks = (response as List)
            .map((item) => CarCheck.fromMap(item))
            .toList();
      });
    } catch (e) {
      debugPrint('Error fetching checks: $e');
    }
  }

  Future<void> _fetchDocuments() async {
    try {
      final response = await supabase
          .from('car_documents')
          .select()
          .order('expiry_date', ascending: true);

      setState(() {
        _documents = (response as List)
            .map((item) => CarDocument.fromMap(item))
            .toList();
      });
    } catch (e) {
      debugPrint('Error fetching documents: $e');
    }
  }

  Future<void> _deleteCheck(String id) async {
    try {
      await supabase.from('car_checks').delete().eq('id', id);
      _fetchChecks();
    } catch (e) {
      debugPrint('Error deleting check: $e');
    }
  }

  Future<void> _deleteDocument(String id) async {
    try {
      await supabase.from('car_documents').delete().eq('id', id);
      _fetchDocuments();
    } catch (e) {
      debugPrint('Error deleting document: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Car Maintenance'),
      ),
      body: Column(
        children: [
          // Tab Switcher
          Padding(
            padding: const EdgeInsets.all(16),
            child: Container(
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.3),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _buildTabButton(0, 'Checks', Icons.car_repair),
                  ),
                  Expanded(
                    child: _buildTabButton(1, 'Documents', Icons.description_outlined),
                  ),
                ],
              ),
            ),
          ),

          // Content
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _currentTab == 0
                    ? _buildChecksTab()
                    : _buildDocumentsTab(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _currentTab == 0
            ? () => _showAddCheckDialog()
            : () => _showAddDocumentDialog(),
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildTabButton(int index, String label, IconData icon) {
    final isSelected = _currentTab == index;
    final theme = Theme.of(context);

    return GestureDetector(
      onTap: () => setState(() => _currentTab = index),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: isSelected ? theme.colorScheme.primary : null,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 16,
              color: isSelected
                  ? theme.colorScheme.onPrimary
                  : theme.colorScheme.onSurface.withOpacity(0.6),
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: isSelected
                    ? theme.colorScheme.onPrimary
                    : theme.colorScheme.onSurface.withOpacity(0.6),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChecksTab() {
    if (_checks.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.car_repair_outlined,
              size: 64,
              color: Theme.of(context).colorScheme.onSurface.withOpacity(0.3),
            ),
            const SizedBox(height: 16),
            Text(
              'No car checks yet',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withOpacity(0.6),
                  ),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: _checks.length,
      itemBuilder: (context, index) => _buildCheckCard(_checks[index]),
    );
  }

  Widget _buildDocumentsTab() {
    if (_documents.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.description_outlined,
              size: 64,
              color: Theme.of(context).colorScheme.onSurface.withOpacity(0.3),
            ),
            const SizedBox(height: 16),
            Text(
              'No documents added yet',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withOpacity(0.6),
                  ),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: _documents.length,
      itemBuilder: (context, index) => _buildDocumentCard(_documents[index]),
    );
  }

  Widget _buildCheckCard(CarCheck check) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: Colors.orange.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Icon(Icons.car_repair, color: Colors.orange),
        ),
        title: Text(
          check.checkType,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          '${DateUtils.formatDate(check.checkDate)}${check.cost != null ? ' • ${CurrencyUtils.formatINR(check.cost!)}' : ''}',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurface.withOpacity(0.6),
          ),
        ),
        trailing: IconButton(
          icon: const Icon(Icons.delete_outline),
          onPressed: () => _deleteCheck(check.id),
        ),
      ),
    );
  }

  Widget _buildDocumentCard(CarDocument doc) {
    final theme = Theme.of(context);
    final daysLeft = doc.daysUntilExpiry;
    final isExpired = doc.isExpired;
    final isExpiringSoon = doc.isExpiringSoon;

    Color statusColor = Colors.green;
    if (isExpired) statusColor = Colors.red;
    else if (isExpiringSoon) statusColor = Colors.orange;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: statusColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(
            isExpired ? Icons.warning : Icons.description,
            color: statusColor,
          ),
        ),
        title: Text(
          doc.documentName,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          'Expires: ${DateUtils.formatDate(doc.expiryDate)} • ${doc.expiryStatus}',
          style: TextStyle(
            fontSize: 12,
            color: statusColor,
            fontWeight: isExpired || isExpiringSoon ? FontWeight.w500 : null,
          ),
        ),
        trailing: IconButton(
          icon: const Icon(Icons.delete_outline),
          onPressed: () => _deleteDocument(doc.id),
        ),
      ),
    );
  }

  void _showAddCheckDialog() {
    String selectedType = _checkTypes[0];
    final descriptionController = TextEditingController();
    final odometerController = TextEditingController();
    final costController = TextEditingController();
    DateTime checkDate = DateTime.now();
    DateTime? nextDueDate;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Add Car Check'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: selectedType,
                  decoration: const InputDecoration(labelText: 'Check Type'),
                  items: _checkTypes.map((type) {
                    return DropdownMenuItem(
                      value: type,
                      child: Text(type),
                    );
                  }).toList(),
                  onChanged: (value) => setState(() => selectedType = value!),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: descriptionController,
                  decoration: const InputDecoration(labelText: 'Description'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: odometerController,
                  decoration: const InputDecoration(labelText: 'Odometer Reading'),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: costController,
                  decoration: const InputDecoration(labelText: 'Cost (₹)'),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Check Date'),
                  subtitle: Text(DateUtils.formatDate(checkDate)),
                  trailing: const Icon(Icons.calendar_today),
                  onTap: () async {
                    final date = await showDatePicker(
                      context: context,
                      initialDate: checkDate,
                      firstDate: DateTime(2020),
                      lastDate: DateTime.now(),
                    );
                    if (date != null) {
                      setState(() => checkDate = date);
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

                final check = CarCheck(
                  id: _uuid.v4(),
                  userId: user.id,
                  checkType: selectedType,
                  description: descriptionController.text.isEmpty
                      ? null
                      : descriptionController.text,
                  odometerReading: int.tryParse(odometerController.text),
                  cost: double.tryParse(costController.text),
                  checkDate: checkDate,
                  nextDueDate: nextDueDate,
                  isCompleted: true,
                  createdAt: DateTime.now(),
                  updatedAt: DateTime.now(),
                );

                try {
                  await supabase.from('car_checks').insert(check.toMap());
                  if (mounted) {
                    Navigator.pop(context);
                    _fetchChecks();
                  }
                } catch (e) {
                  debugPrint('Error adding check: $e');
                }
              },
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
  }

  void _showAddDocumentDialog() {
    final nameController = TextEditingController();
    DateTime expiryDate = DateTime.now().add(const Duration(days: 365));

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Add Document'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: nameController,
                  decoration: const InputDecoration(
                    labelText: 'Document Name',
                    hintText: 'e.g. PUC Certificate, Insurance',
                  ),
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Expiry Date'),
                  subtitle: Text(DateUtils.formatDate(expiryDate)),
                  trailing: const Icon(Icons.calendar_today),
                  onTap: () async {
                    final date = await showDatePicker(
                      context: context,
                      initialDate: expiryDate,
                      firstDate: DateTime.now(),
                      lastDate: DateTime(2050),
                    );
                    if (date != null) {
                      setState(() => expiryDate = date);
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

                if (nameController.text.isEmpty) return;

                final doc = CarDocument(
                  id: _uuid.v4(),
                  userId: user.id,
                  documentName: nameController.text,
                  expiryDate: expiryDate,
                  createdAt: DateTime.now(),
                  updatedAt: DateTime.now(),
                );

                try {
                  await supabase.from('car_documents').insert(doc.toMap());
                  if (mounted) {
                    Navigator.pop(context);
                    _fetchDocuments();
                  }
                } catch (e) {
                  debugPrint('Error adding document: $e');
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
