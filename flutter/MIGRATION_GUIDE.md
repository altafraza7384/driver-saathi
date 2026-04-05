# Migration Guide: React to Flutter

This guide documents the migration of the Driver Saathi application from React to Flutter.

## Overview

The original React app was built with:
- React 18 + TypeScript
- Vite 5
- TailwindCSS
- Supabase
- Capacitor (for mobile)

The new Flutter app provides:
- Native performance
- Single codebase for Android & iOS
- Better offline support
- Native UI components

## Feature Mapping

| React Feature | Flutter Equivalent |
|--------------|-------------------|
| React Router | Flutter Navigator |
| TanStack Query | Direct Supabase calls + FutureBuilder |
| React Hook Form | Flutter Form + TextFormField |
| Framer Motion | Built-in Flutter animations |
| TailwindCSS | Flutter Theme + BoxDecoration |
| shadcn/ui | Material 3 + custom widgets |
| Capacitor | Native Flutter plugins |

## Data Models

All TypeScript interfaces have been converted to Dart classes with:
- `Equatable` for value equality
- `copyWith` methods for immutability
- `toMap`/`fromMap` for JSON serialization
- Factory constructors for easy instantiation

## Navigation

### React (React Router)
```tsx
<Route path="/transactions" element={<TransactionsPage />} />
```

### Flutter
```dart
Navigator.pushNamed(context, '/transactions');
```

Routes are defined in `main.dart` and can be extended with `onGenerateRoute`.

## State Management

### React (TanStack Query)
```tsx
const { data, isLoading } = useQuery({
  queryKey: ['transactions'],
  queryFn: fetchTransactions
});
```

### Flutter
```dart
// Direct Supabase calls with FutureBuilder
FutureBuilder(
  future: supabase.from('transactions').select(),
  builder: (context, snapshot) {
    if (snapshot.connectionState == ConnectionState.waiting) {
      return CircularProgressIndicator();
    }
    // Handle data
  },
)
```

## UI Components

### Card
**React:**
```tsx
<Card>
  <CardContent className="p-4">...</CardContent>
</Card>
```

**Flutter:**
```dart
Card(
  child: Padding(
    padding: EdgeInsets.all(16),
    child: ...,
  ),
)
```

### Button
**React:**
```tsx
<Button onClick={handleClick}>Submit</Button>
```

**Flutter:**
```dart
ElevatedButton(
  onPressed: handleClick,
  child: Text('Submit'),
)
```

### Dialog
**React:**
```tsx
<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent>...</DialogContent>
</Dialog>
```

**Flutter:**
```dart
showDialog(
  context: context,
  builder: (context) => AlertDialog(
    content: ...,
  ),
);
```

## Database Operations

All Supabase operations remain the same - only the syntax changes slightly:

### Fetch
**React:**
```ts
const { data } = await supabase.from('transactions').select('*');
```

**Flutter:**
```dart
final response = await supabase.from('transactions').select();
```

### Insert
**React:**
```ts
await supabase.from('transactions').insert({ ... });
```

**Flutter:**
```dart
await supabase.from('transactions').insert({ ... });
```

## Styling

### Colors
**React (Tailwind):**
```tsx
className="bg-primary text-white"
```

**Flutter:**
```dart
decoration: BoxDecoration(
  color: Theme.of(context).colorScheme.primary,
),
```

### Text Styles
**React:**
```tsx
className="text-lg font-bold"
```

**Flutter:**
```dart
style: TextStyle(
  fontSize: 18,
  fontWeight: FontWeight.bold,
)
```

## Key Differences

1. **Layout System**
   - React: CSS Flexbox/Grid
   - Flutter: Column, Row, Stack, GridView widgets

2. **Responsiveness**
   - React: CSS media queries
   - Flutter: LayoutBuilder, MediaQuery, Flexible, Expanded

3. **Lists**
   - React: Array.map()
   - Flutter: ListView.builder()

4. **Conditional Rendering**
   - React: {condition && <Component />}
   - Flutter: if (condition) Component() or condition ? A : B

5. **Event Handling**
   - React: onClick, onChange
   - Flutter: onPressed, onChanged, onTap

## Testing Strategy

- **Unit Tests**: Test business logic and utilities
- **Widget Tests**: Test UI components
- **Integration Tests**: Test full user flows

## Performance Considerations

1. Use `const` constructors where possible
2. Implement `ListView.builder` for long lists
3. Use `RepaintBoundary` for complex widgets
4. Cache expensive computations
5. Use `Image.network` with caching

## Not Yet Implemented

These features from the React app are planned for future releases:

- AI Assistant page
- Finance AI insights
- Push notifications
- Speech-to-text notes
- PDF export
- Admin panel
- Marketplace
- Data backup
- SOS with location sharing
- Google AdMob integration

## Next Steps

1. Set up Supabase project and configure URL/keys
2. Run database migrations
3. Configure push notifications
4. Add AdMob for monetization
5. Implement remaining features
6. Add comprehensive tests
7. Deploy to app stores

## Resources

- [Flutter Documentation](https://docs.flutter.dev)
- [Supabase Flutter](https://supabase.com/docs/reference/dart/introduction)
- [Material 3 Design](https://m3.material.io/)

---

For questions or issues, please refer to the main README.md or contact the development team.
