import 'package:flutter/material.dart';

class MorePage extends StatelessWidget {
  const MorePage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final menuItems = [
      _MenuItem(
        icon: Icons.account_balance_wallet_outlined,
        label: 'Debts & EMI',
        color: Colors.orange,
        route: '/debts',
      ),
      _MenuItem(
        icon: Icons.savings_outlined,
        label: 'Savings Goals',
        color: Colors.green,
        route: '/goals',
      ),
      _MenuItem(
        icon: Icons.health_and_safety_outlined,
        label: 'Health Tracker',
        color: Colors.red,
        route: '/health',
      ),
      _MenuItem(
        icon: Icons.car_repair_outlined,
        label: 'Car Checks',
        color: Colors.blue,
        route: '/car-checks',
      ),
      _MenuItem(
        icon: Icons.note_alt_outlined,
        label: 'Notes',
        color: Colors.purple,
        route: '/notes',
      ),
      _MenuItem(
        icon: Icons.alarm_outlined,
        label: 'Reminders',
        color: Colors.teal,
        route: '/reminders',
      ),
      _MenuItem(
        icon: Icons.support_agent_outlined,
        label: 'AI Assistant',
        color: Colors.indigo,
        route: '/assistant',
      ),
      _MenuItem(
        icon: Icons.backup_outlined,
        label: 'Data Backup',
        color: Colors.cyan,
        route: '/data-backup',
      ),
      _MenuItem(
        icon: Icons.emergency_outlined,
        label: 'Emergency SOS',
        color: Colors.red,
        route: '/sos',
      ),
      _MenuItem(
        icon: Icons.settings_outlined,
        label: 'Settings',
        color: Colors.grey,
        route: '/settings',
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('More'),
      ),
      body: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          childAspectRatio: 1.5,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
        ),
        itemCount: menuItems.length,
        itemBuilder: (context, index) {
          final item = menuItems[index];
          return _buildMenuCard(context, item);
        },
      ),
    );
  }

  Widget _buildMenuCard(BuildContext context, _MenuItem item) {
    final theme = Theme.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.pushNamed(context, item.route),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: item.color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  item.icon,
                  color: item.color,
                  size: 28,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                item.label,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MenuItem {
  final IconData icon;
  final String label;
  final Color color;
  final String route;

  _MenuItem({
    required this.icon,
    required this.label,
    required this.color,
    required this.route,
  });
}
