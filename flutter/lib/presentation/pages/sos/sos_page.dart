import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../domain/entities/emergency_contact.dart';
import '../../../presentation/providers/auth_provider.dart';

class SOSPage extends StatefulWidget {
  const SOSPage({super.key});

  @override
  State<SOSPage> createState() => _SOSPageState();
}

class _SOSPageState extends State<SOSPage> {
  final supabase = Supabase.instance.client;
  List<EmergencyContact> _contacts = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchContacts();
  }

  Future<void> _fetchContacts() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    try {
      final response = await supabase
          .from('emergency_contacts')
          .select()
          .eq('user_id', user.id)
          .order('is_primary', ascending: false);

      setState(() {
        _contacts = (response as List)
            .map((item) => EmergencyContact.fromMap(item))
            .toList();
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Error fetching contacts: $e');
      setState(() => _isLoading = false);
    }
  }

  Future<void> _callContact(String phone) async {
    final uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  Future<void> _sendSMS(String phone) async {
    final uri = Uri.parse('sms:$phone?body=Emergency! I need help. My location: [Location sharing not implemented yet]');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Emergency SOS'),
        backgroundColor: Colors.red,
        foregroundColor: Colors.white,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // Emergency Button
                  Container(
                    width: 200,
                    height: 200,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Colors.red, Colors.redAccent],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(100),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.red.withOpacity(0.4),
                          blurRadius: 20,
                          spreadRadius: 5,
                        ),
                      ],
                    ),
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: () => _showEmergencyOptions(),
                        borderRadius: BorderRadius.circular(100),
                        child: const Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.emergency,
                              size: 64,
                              color: Colors.white,
                            ),
                            SizedBox(height: 8),
                            Text(
                              'SOS',
                              style: TextStyle(
                                fontSize: 32,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 32),

                  // Instructions
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          Icon(
                            Icons.info_outline,
                            color: theme.colorScheme.primary,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'In case of emergency, tap the SOS button to quickly alert your emergency contacts with your location.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium,
                          ),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 24),

                  // Emergency Contacts
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Emergency Contacts',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      TextButton.icon(
                        onPressed: () => _showAddContactDialog(),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('Add'),
                      ),
                    ],
                  ),

                  const SizedBox(height: 12),

                  if (_contacts.isEmpty)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            Icon(
                              Icons.contacts_outlined,
                              size: 48,
                              color: theme.colorScheme.onSurface.withOpacity(0.3),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              'No emergency contacts added',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.onSurface.withOpacity(0.6),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Add contacts to quickly reach them in emergencies',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurface.withOpacity(0.4),
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    ..._contacts.map((contact) => _buildContactCard(contact)),

                  const SizedBox(height: 32),

                  // Emergency Numbers
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Emergency Numbers (India)',
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 12),
                          _buildEmergencyNumber('Police', '100'),
                          _buildEmergencyNumber('Ambulance', '108'),
                          _buildEmergencyNumber('Fire', '101'),
                          _buildEmergencyNumber('Women Helpline', '1091'),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildContactCard(EmergencyContact contact) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: contact.isPrimary
              ? Colors.red.withOpacity(0.1)
              : theme.colorScheme.primary.withOpacity(0.1),
          child: Icon(
            Icons.person,
            color: contact.isPrimary ? Colors.red : theme.colorScheme.primary,
          ),
        ),
        title: Text(
          contact.name,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          '${contact.phone}${contact.relationship != null ? ' • ${contact.relationship}' : ''}',
          style: theme.textTheme.bodySmall,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.call, color: Colors.green),
              onPressed: () => _callContact(contact.phone),
            ),
            IconButton(
              icon: const Icon(Icons.message, color: Colors.blue),
              onPressed: () => _sendSMS(contact.phone),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmergencyNumber(String label, String number) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      subtitle: Text(number),
      trailing: IconButton(
        icon: const Icon(Icons.call, color: Colors.green),
        onPressed: () => _callContact(number),
      ),
    );
  }

  void _showEmergencyOptions() {
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'Emergency Options',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.call, color: Colors.green),
              title: const Text('Call Primary Contact'),
              onTap: () {
                Navigator.pop(context);
                final primary = _contacts.firstWhere(
                  (c) => c.isPrimary,
                  orElse: () => _contacts.first,
                );
                _callContact(primary.phone);
              },
            ),
            ListTile(
              leading: const Icon(Icons.message, color: Colors.blue),
              title: const Text('Send Emergency SMS'),
              onTap: () {
                Navigator.pop(context);
                // Send to all contacts
                for (final contact in _contacts) {
                  _sendSMS(contact.phone);
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.location_on, color: Colors.orange),
              title: const Text('Share Location'),
              subtitle: const Text('Feature coming soon'),
              onTap: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Location sharing will be available soon'),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showAddContactDialog() {
    final nameController = TextEditingController();
    final phoneController = TextEditingController();
    final relationController = TextEditingController();
    bool isPrimary = false;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Add Emergency Contact'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: nameController,
                  decoration: const InputDecoration(
                    labelText: 'Name',
                    hintText: 'Contact name',
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: phoneController,
                  decoration: const InputDecoration(
                    labelText: 'Phone Number',
                    hintText: '10 digit number',
                  ),
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: relationController,
                  decoration: const InputDecoration(
                    labelText: 'Relationship (Optional)',
                    hintText: 'e.g. Brother, Friend',
                  ),
                ),
                const SizedBox(height: 12),
                CheckboxListTile(
                  title: const Text('Primary Contact'),
                  subtitle: const Text('Will be contacted first in emergency'),
                  value: isPrimary,
                  onChanged: (value) => setState(() => isPrimary = value!),
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

                if (nameController.text.isEmpty ||
                    phoneController.text.isEmpty) {
                  return;
                }

                try {
                  await supabase.from('emergency_contacts').insert({
                    'id': DateTime.now().millisecondsSinceEpoch.toString(),
                    'user_id': user.id,
                    'name': nameController.text,
                    'phone': phoneController.text,
                    'relationship': relationController.text.isEmpty
                        ? null
                        : relationController.text,
                    'is_primary': isPrimary,
                    'created_at': DateTime.now().toIso8601String(),
                  });

                  if (mounted) {
                    Navigator.pop(context);
                    _fetchContacts();
                  }
                } catch (e) {
                  debugPrint('Error adding contact: $e');
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
