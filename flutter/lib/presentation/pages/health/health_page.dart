import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../../domain/entities/health_log.dart';
import '../../../presentation/providers/auth_provider.dart';
import '../../../core/utils/date_utils.dart';

class HealthPage extends StatefulWidget {
  const HealthPage({super.key});

  @override
  State<HealthPage> createState() => _HealthPageState();
}

class _HealthPageState extends State<HealthPage> {
  final supabase = Supabase.instance.client;
  final _uuid = const Uuid();
  HealthLog? _todayLog;
  List<HealthLog> _weeklyLogs = [];
  bool _isLoading = true;

  // Form values
  double _sleepHours = 0;
  int _waterGlasses = 0;
  int _breaksTaken = 0;
  int _steps = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    await Future.wait([
      _fetchTodayLog(),
      _fetchWeeklyLogs(),
    ]);
    setState(() => _isLoading = false);
  }

  Future<void> _fetchTodayLog() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    final today = DateUtils.formatISODate(DateTime.now());

    try {
      final response = await supabase
          .from('health_logs')
          .select()
          .eq('user_id', user.id)
          .eq('log_date', today)
          .maybeSingle();

      if (response != null) {
        final log = HealthLog.fromMap(response);
        setState(() {
          _todayLog = log;
          _sleepHours = log.sleepHours ?? 0;
          _waterGlasses = log.waterGlasses ?? 0;
          _breaksTaken = log.breaksTaken ?? 0;
          _steps = log.steps ?? 0;
        });
      }
    } catch (e) {
      debugPrint('Error fetching today\'s log: $e');
    }
  }

  Future<void> _fetchWeeklyLogs() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    final weekStart = DateUtils.startOfWeek(DateTime.now(), weekStartsOn: 1);
    final weekEnd = DateUtils.endOfWeek(DateTime.now(), weekStartsOn: 1);

    try {
      final response = await supabase
          .from('health_logs')
          .select()
          .eq('user_id', user.id)
          .gte('log_date', DateUtils.formatISODate(weekStart))
          .lte('log_date', DateUtils.formatISODate(weekEnd))
          .order('log_date', ascending: true);

      setState(() {
        _weeklyLogs = (response as List)
            .map((item) => HealthLog.fromMap(item))
            .toList();
      });
    } catch (e) {
      debugPrint('Error fetching weekly logs: $e');
    }
  }

  Future<void> _saveLog() async {
    final user = AuthProvider.of(context).user;
    if (user == null) return;

    final today = DateTime.now();
    final payload = {
      'user_id': user.id,
      'log_date': DateUtils.formatISODate(today),
      'sleep_hours': _sleepHours,
      'water_glasses': _waterGlasses,
      'breaks_taken': _breaksTaken,
      'steps': _steps,
      'updated_at': today.toIso8601String(),
    };

    try {
      if (_todayLog != null) {
        await supabase
            .from('health_logs')
            .update(payload)
            .eq('id', _todayLog!.id);
      } else {
        await supabase.from('health_logs').insert({
          ...payload,
          'id': _uuid.v4(),
          'created_at': today.toIso8601String(),
        });
      }

      _fetchTodayLog();
      _fetchWeeklyLogs();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Health log saved!')),
        );
      }
    } catch (e) {
      debugPrint('Error saving log: $e');
    }
  }

  void _quickMark(String key, int increment) {
    setState(() {
      switch (key) {
        case 'water':
          _waterGlasses += increment;
          break;
        case 'breaks':
          _breaksTaken += increment;
          break;
        case 'steps':
          _steps += increment;
          break;
      }
    });
    _saveLog();
  }

  double get _avgSleep => _weeklyLogs.isEmpty
      ? 0
      : _weeklyLogs.fold<double>(
              0, (sum, log) => sum + (log.sleepHours ?? 0)) /
          _weeklyLogs.length;

  double get _avgWater => _weeklyLogs.isEmpty
      ? 0
      : _weeklyLogs.fold<double>(
              0, (sum, log) => sum + (log.waterGlasses ?? 0)) /
          _weeklyLogs.length;

  int get _totalSteps => _weeklyLogs.fold(
      0, (sum, log) => sum + (log.steps ?? 0));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (_isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Health Tracker'),
      ),
      body: RefreshIndicator(
        onRefresh: _loadData,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          physics: const AlwaysScrollableScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Quick Actions
              Row(
                children: [
                  Expanded(
                    child: _buildQuickActionCard(
                      Icons.water_drop_outlined,
                      'Add Water',
                      Colors.cyan,
                      '$_waterGlasses/8',
                      () => _quickMark('water', 1),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildQuickActionCard(
                      Icons.coffee_outlined,
                      'Add Break',
                      Colors.amber,
                      '$_breaksTaken/4',
                      () => _quickMark('breaks', 1),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildQuickActionCard(
                      Icons.directions_walk_outlined,
                      'Add Steps',
                      Colors.green,
                      _steps.toString(),
                      () => _quickMark('steps', 1000),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 24),

              // Health Metrics
              Text(
                'Today\'s Metrics',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 12),

              _buildMetricCard(
                Icons.bedtime_outlined,
                'Sleep',
                _sleepHours,
                10,
                Colors.blue,
                (value) => setState(() => _sleepHours = value),
              ),
              const SizedBox(height: 8),
              _buildMetricCard(
                Icons.water_drop_outlined,
                'Water',
                _waterGlasses.toDouble(),
                12,
                Colors.cyan,
                (value) => setState(() => _waterGlasses = value.toInt()),
              ),
              const SizedBox(height: 8),
              _buildMetricCard(
                Icons.coffee_outlined,
                'Breaks',
                _breaksTaken.toDouble(),
                8,
                Colors.amber,
                (value) => setState(() => _breaksTaken = value.toInt()),
              ),
              const SizedBox(height: 8),
              _buildMetricCard(
                Icons.directions_walk_outlined,
                'Steps',
                _steps.toDouble(),
                10000,
                Colors.green,
                (value) => setState(() => _steps = value.toInt()),
              ),

              const SizedBox(height: 24),

              ElevatedButton.icon(
                onPressed: _saveLog,
                icon: const Icon(Icons.save_outlined),
                label: const Text('Save Today\'s Log'),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 48),
                ),
              ),

              const SizedBox(height: 24),

              // Weekly Report
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Weekly Report',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: _buildStat('Avg Sleep',
                                '${_avgSleep.toStringAsFixed(1)} hrs'),
                          ),
                          Expanded(
                            child: _buildStat(
                                'Avg Water', _avgWater.toStringAsFixed(1)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: _buildStat(
                                'Days Logged', '${_weeklyLogs.length}/7'),
                          ),
                          Expanded(
                            child: _buildStat('Total Steps',
                                _totalSteps.toString().replaceAllMapped(
                                    RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
                                    (m) => '${m[1]},')),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      _buildWeeklyChart(),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildQuickActionCard(
    IconData icon,
    String label,
    Color color,
    String value,
    VoidCallback onTap,
  ) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
          child: Column(
            children: [
              Icon(icon, color: color, size: 24),
              const SizedBox(height: 8),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: TextStyle(
                  fontSize: 11,
                  color: Colors.grey[600],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricCard(
    IconData icon,
    String label,
    double value,
    double max,
    Color color,
    ValueChanged<double> onChanged,
  ) {
    final theme = Theme.of(context);
    final isGoalMet = label == 'Sleep'
        ? value >= 7
        : label == 'Water'
            ? value >= 8
            : label == 'Breaks'
                ? value >= 4
                : value >= 5000;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Icon(
                  isGoalMet ? Icons.check_circle : icon,
                  color: isGoalMet ? Colors.green : color,
                  size: 24,
                ),
                const SizedBox(width: 12),
                Text(
                  label,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                SizedBox(
                  width: 80,
                  child: TextFormField(
                    initialValue: value.toStringAsFixed(label == 'Sleep' ? 1 : 0),
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.right,
                    decoration: const InputDecoration(
                      contentPadding: EdgeInsets.symmetric(horizontal: 12),
                    ),
                    onChanged: (v) {
                      final newValue = double.tryParse(v) ?? 0;
                      onChanged(newValue);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: (value / max).clamp(0, 1),
                minHeight: 8,
                backgroundColor: theme.colorScheme.surfaceVariant.withOpacity(0.3),
                valueColor: AlwaysStoppedAnimation<Color>(color),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStat(String label, String value) {
    return Column(
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
          value,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  Widget _buildWeeklyChart() {
    final weekStart = DateUtils.startOfWeek(DateTime.now(), weekStartsOn: 1);
    final days = List.generate(7, (i) => weekStart.add(Duration(days: i)));

    final maxSleep = _weeklyLogs.fold<double>(
        1, (max, log) => (log.sleepHours ?? 0) > max ? log.sleepHours! : max);
    final maxWater = _weeklyLogs.fold<int>(
        1, (max, log) => (log.waterGlasses ?? 0) > max ? log.waterGlasses! : max);

    return Column(
      children: [
        Text(
          'Sleep & Water (Daily)',
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 80,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: days.map((day) {
              final dayLog = _weeklyLogs.firstWhere(
                (log) => DateUtils.isSameDay(log.logDate, day),
                orElse: () => HealthLog(
                  id: '',
                  userId: '',
                  logDate: day,
                  createdAt: DateTime.now(),
                  updatedAt: DateTime.now(),
                ),
              );

              final sleep = dayLog.sleepHours ?? 0;
              final water = dayLog.waterGlasses ?? 0;
              final sleepHeight = (sleep / maxSleep * 40).clamp(4.0, 40.0);
              final waterHeight = (water / maxWater * 40).clamp(4.0, 40.0);
              final isToday = DateUtils.isSameDay(day, DateTime.now());

              return Column(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        width: 6,
                        height: sleepHeight,
                        decoration: BoxDecoration(
                          color: Colors.blue.withOpacity(0.7),
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(2),
                          ),
                        ),
                      ),
                      const SizedBox(width: 2),
                      Container(
                        width: 6,
                        height: waterHeight,
                        decoration: BoxDecoration(
                          color: Colors.cyan.withOpacity(0.7),
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
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _buildLegend('Sleep', Colors.blue),
            const SizedBox(width: 16),
            _buildLegend('Water', Colors.cyan),
          ],
        ),
      ],
    );
  }

  Widget _buildLegend(String label, Color color) {
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color.withOpacity(0.7),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 10,
            color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
          ),
        ),
      ],
    );
  }
}
